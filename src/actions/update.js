/* global ListStore, program, util, cfg, stores, modules, yt */
let dp = require('despair')
let tempus = require('../tempus')

program
  .command('update')
  .description('update databases')
  .argument('[types...]', 'database types to update (players/records/uploads)')
  .option('-f, --full', 'full update')
  .option('-v, --verbose', 'verbose output')
  .action(async (types, opts) => {
    if (!types.length) types = ['players', 'records', 'uploads']

    types = types.reduce((obj, item) => {
      obj[item] = true
      return obj
    }, {})

    await update(types, opts)
  })

async function update (types = { players: true, records: true, uploads: true }, opts) {
  if (types.players) await players()
  if (types.records) await records(opts.full)
  if (types.uploads) await uploads(opts.verbose)
}

async function players () {
  let num = 0
  util.log('[Players] Fetching data...')
  let nicknames = await dp(cfg.nickdata).json()
  for (let nick of nicknames) {
    let id = util.formatSteamID(nick.steamId)
    if (!stores.players[id]) {
      stores.players[id] = { [nick.name]: true }
      num++
    }
  }
  util.log(`[Players] Added ${num} additional nickname${util.s(num)}! (${Object.keys(stores.players).length} total)\n`)

  stores.players.export(cfg.players)
}

async function records (full) {
  if (full) {
    let records = new ListStore()

    let maps = await tempus.getMapList()

    let count = 0

    for (let i = 0; i < maps.length; i++) {
      let map = maps[i]
      for (let zone of cfg.zones) {
        let zones = map.zone_counts[zone]
        for (let j = 0; j < zones; j++) {
          let rec = await tempus.getMapRecords(map.id, zone, j + 1, 1)
          let s = rec.results.soldier[0]
          let d = rec.results.demoman[0]
          if (s) {
            let z = `S_${rec.zone_info.id}`
            delete records[z]
            records.add(z, s.id, !!s.demo_info?.url)
            count++
          }
          if (d) {
            let z = `D_${rec.zone_info.id}`
            delete records[z]
            records.add(z, d.id, !!d.demo_info?.url)
            count++
          }

          util.log(`[Records] ${i + 1}/${maps.length} - ${map.name} [${zone} ${j + 1}] (${j + 1}/${zones})`)
        }
      }
    }
    util.log(`[Records] Fetched ${count} record${util.s(count)}!\n`)

    records.export(cfg.records)
    stores.records = records
  } else {
    let activity = await tempus.getActivity()

    let updated = 0
    let demoless = 0
    let wrs = [...activity.map_wrs, ...activity.course_wrs, ...activity.bonus_wrs, ...activity.trick_wrs]
    for (let i = 0; i < wrs.length; i++) {
      let rec = wrs[i]
      let tfclass = tempus.formatClass(rec.record_info.class)
      let id = rec.record_info.id
      let key = `${tfclass}_${rec.zone_info.id}`

      if (!stores.records[key] || !stores.records[key][id]) { // only update if record is missing / has no demo
        util.log(`[Records] ${i + 1}/${wrs.length} - ${rec.map_info.name} [${rec.zone_info.type} ${rec.zone_info.zoneindex}]`)
        let r = await modules.fetch(id, { minimal: true }).catch(() => null)
        if (!r) {
          demoless++
          continue
        }

        delete stores.records[key]
        stores.records.add(key, id, !!r.demo)

        updated++
      }
    }
    util.log(`[Records] Updated ${updated}/${wrs.length} records! (${demoless} without demo)\n`)
    if (updated + demoless === wrs.length) util.log('[Records] <!> All records new, might need to update database fully <!>\n')

    stores.records.export(cfg.records)
  }
}

async function uploads (verbose) {
  let uploads = new ListStore()
  let status = { pending: [], hidden: [], wipes: [], dupes: [], privacy: { public: [], unlisted: [] }, update: {} }
  let info = {}

  util.log('[Uploads] Fetching videos...')

  let total = 0
  let next = null

  do {
    let res = await yt.listVideos(null, null, next)
    next = res.next

    total += res.items.length
    util.log(`[Uploads] Fetching videos... ${total}`)

    for (let item of res.items) {
      if (item.title[0] === cfg.prefix.hidden) {
        status.hidden.push(item.videoId)
        continue
      }

      if (item.title[0] === cfg.prefix.wiped) {
        status.wipes.push(item.videoId)
        continue
      }

      if (item.title[0] === cfg.prefix.pending) {
        status.pending.push(item.videoId)
        item.title = item.title.slice(1).trim()
        item.videoId = '#' + item.videoId
      }

      let tfclass = item.title.match(/^\[(\w)\]/)
      if (!tfclass) throw Error(`Video ${item.videoId} has invalid title: ${item.title}`)

      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/)
      if (!record || !zone) throw Error(`Video ${item.videoId} has invalid description: ${item.title}`)

      let key = `${tfclass[1]}_${zone}`

      if (uploads[key]?.[record]) status.dupes.push(item.videoId)
      else {
        uploads.add(key, record, item.videoId)
        info[item.videoId] = item
      }
    }
  } while (next)

  util.log('[Uploads] Parsing videos...')

  for (let key in uploads) {
    let ups = Object.values(uploads[key]).filter(x => !x.startsWith('#'))
    for (let i = 0; i < ups.length; i++) {
      let vid = ups[i]
      let { title, privacy, description } = info[vid]

      // verify privacy status
      if (['Bonus', 'Trick', 'Course'].some(x => title.indexOf(` ${x} `) !== -1)) {
        if (i === ups.length - 1) {
          if (privacy !== 'VIDEO_PRIVACY_PUBLIC') status.privacy.public.push(vid)
        } else {
          if (privacy !== 'VIDEO_PRIVACY_UNLISTED') status.privacy.unlisted.push(vid)
        }
      } else {
        if (privacy !== 'VIDEO_PRIVACY_UNLISTED') status.privacy.unlisted.push(vid)
      }

      // verify description link chain
      if (ups.length > 1 && i !== 0) {
        let pwr = ups[i - 1]
        let match = description.match('https://youtu.be/' + pwr)
        if (!match) status.update[vid] = pwr
      } else if (ups.length === 1) {
        if (description.match('https://youtu.be/')) status.update[vid] = ''
      }
    }
  }

  util.removeEmpty(status)

  util.log('')
  if (status.dupes) console.log('Delete Duplicate Videos:', status.dupes)
  if (status.privacy) console.log('Change Video Privacy:', status.privacy)
  if (status.update) console.log('Change Description Chain Id:', status.update)
  if (verbose) {
    if (status.pending) console.log('Pending Records:', status.pending)
    if (status.hidden) console.log('Hidden Records:', status.hidden)
    if (status.wipes) console.log('Wiped Records:', status.wipes)
  }

  util.log(`[Uploads] Processed ${Object.keys(uploads).length} videos! (Pending ${status.pending?.length || 0}, Hidden ${status.hidden?.length || 0}, Wiped ${status.wipes?.length || 0})\n`)

  if (Object.keys(status).length) util.write(cfg.report, JSON.stringify(status, null, 2))

  uploads.export(cfg.uploads)
  stores.uploads = uploads
}

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

  await stores.players.export(cfg.players)
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
          let rec = await tempus.getMapRecords(map.id, zone, j + 1, 100)
          for (let tfclass of ['soldier', 'demoman']) {
            let wr = rec.results[tfclass][0]

            if (wr) {
              // return oldest wr if tie
              for (let i = 1; i < rec.results[tfclass].length; i++) {
                let result = rec.results[tfclass][i]
                if (result.duration === wr.duration && result.date < wr.date) {
                  wr = result
                }
              }

              let z = `${tfclass[0].toUpperCase()}_${rec.zone_info.id}`
              delete records[z]
              records.add(z, wr.id, !!wr.demo_info?.url)
              count++
            }
          }

          util.log(`[Records] ${i + 1}/${maps.length} - ${map.name} [${zone} ${j + 1}] (${j + 1}/${zones})`)
        }
      }
    }
    util.log(`[Records] Fetched ${count} record${util.s(count)}!\n`)

    await records.export(cfg.records)
    stores.records = records
  } else {
    let activity = await tempus.getActivity()

    let updated = 0
    let demoless = 0
    let ties = 0
    let wrs = [...activity.map_wrs, ...activity.course_wrs, ...activity.bonus_wrs, ...activity.trick_wrs]

    let items = []
    let vids = new Set()

    for (let i = 0; i < wrs.length; i++) {
      let rec = wrs[i]
      let tfclass = tempus.formatClass(rec.record_info.class)
      let id = rec.record_info.id
      let key = `${tfclass}_${rec.zone_info.id}`

      if (!stores.records[key] || !stores.records[key][id]) { // only update if record is not already added
        let lastId = null

        if (stores.uploads[key]) { // add video id of latest wr in archive to compare duration to
          lastId = Object.values(stores.uploads[key]).at(-1)
          if (lastId) {
            if (lastId.startsWith('#')) lastId = lastId.slice(1) // also consider pending videos in this
            vids.add(lastId)
          }
        }

        items.push({ key, id, rec, lastId })
      }
    }

    let list = await yt.listVideos(Array.from(vids), null, null)
    list = list.items.reduce((cur, prev) => {
      cur[prev.videoId] = util.msFromTime(prev.title.match(/([\d.:]+)$/)[1])
      return cur
    }, {})

    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      let rec = item.rec

      if (item.lastId) {
        let dur = item.rec.record_info.duration * 1000
        if (list[item.lastId] <= dur) {
          ties++
          continue
        }
      }

      let r = await modules.fetch(item.id, { minimal: true }).catch(() => null)
      if (!r) {
        demoless++
        continue
      }

      delete stores.records[item.key]
      stores.records.add(item.key, item.id, !!r.demo)
      updated++

      util.log(`[Records] ${i + 1}/${items.length} - ${rec.map_info.name} [${rec.zone_info.type} ${rec.zone_info.zoneindex}]`)
    }

    util.log(`[Records] Updated ${updated}/${wrs.length} records! (No Demo: ${demoless}, Ties: ${ties})\n`)
    if (updated + demoless + ties === wrs.length) util.log('[Records] <!> All records new, might need to update database fully <!>\n')

    await stores.records.export(cfg.records)
  }
}

async function uploads (verbose) {
  let uploads = new ListStore()
  let status = { pending: [], hidden: [], wipes: [], dupes: [], unnamed: [], privacy: { public: [], unlisted: [] }, update: {}, nicks: {} }
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

      if (item.privacy === 'VIDEO_PRIVACY_PRIVATE' && item.description === '') continue // probably in the middle of an upload

      let [, tfclass] = item.title.match(/^\[(\w)\]/)
      if (!tfclass) throw Error(`Video ${item.videoId} has invalid title (could not find tfclass): ${item.title}`)

      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/)
      if (!record || !zone) throw Error(`Video ${item.videoId} has invalid description (could not find record or zone id): ${item.title}`)
      item.record = record

      let [, time] = item.title.match(/([\d.:]+)$/)
      if (!time) throw Error(`Video ${item.videoId} has invalid title (could not find time): ${item.title}`)
      item.time = util.msFromTime(time)

      let key = `${tfclass}_${zone}`

      if (uploads[key]?.[record]) status.dupes.push(item.videoId)
      else {
        uploads.add(key, record, item.videoId)
        info[item.videoId] = item
      }
    }
  } while (next)

  // legacy zones
  for (let key in uploads) {
    let altKey = key + 'X'
    let ups = Object.values(uploads[key])
    for (let i = 0; i < ups.length; i++) {
      let vid = ups[i]
      let { title, record, videoId } = info[vid]

      let map = title.match(/on (.*?) /)[1]
      if (cfg.legacy_maps.includes(map)) {
        uploads.add(altKey, record, videoId)
        delete uploads[key][record]
      }
    }
  }

  // sort upload key values by time
  for (let key in uploads) {
    let ups = Object.values(uploads[key])
    if (ups.length <= 1) continue
    let list = []
    for (let up of ups) list.push({ time: info[up].time, vid: up, id: info[up].record })
    list = list.sort((a, b) => {
      let t = b.time - a.time // shortest time
      if (t === 0) return b.id - a.id // otherwise lower record id / earlier date
      return t
    })

    uploads[key] = util.createOrderedObject()
    for (let item of list) uploads[key][item.id] = item.vid
  }

  util.log('[Uploads] Parsing videos...')

  for (let key in uploads) {
    if (key.endsWith('X')) continue // skip legacy zones

    let ups = Object.values(uploads[key]).filter(x => !x.startsWith('#'))
    for (let i = 0; i < ups.length; i++) {
      let vid = ups[i]
      let { privacy, description, title } = info[vid]

      // verify player nick
      if (cfg.check_nicks) {
        let name = title.match(/] (.*?) on/)[1]
        let steam = util.formatSteamID(description.match(/profiles\/(.*?)\s/)[1])
        let nick = Object.keys(stores.players[steam] || {})[0]

        if (!nick) status.unnamed.push([steam, name])
        else if (name !== nick) status.nicks[vid] = [name, nick]
      }

      // verify privacy status
      if (i === ups.length - 1) {
        if (privacy !== 'VIDEO_PRIVACY_PUBLIC') status.privacy.public.push(vid)
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
  if (status.nicks) console.log('Change Title Nicks:', status.nicks)

  if (verbose) {
    if (status.pending) console.log('Pending Records:', status.pending)
    if (status.hidden) console.log('Hidden Records:', status.hidden)
    if (status.wipes) console.log('Wiped Records:', status.wipes)
    if (status.unnamed) console.log('Unnamed Players:', status.unnamed)
  }

  util.log(`[Uploads] Processed ${Object.keys(uploads).length} videos! (Pending ${status.pending?.length || 0}, Hidden ${status.hidden?.length || 0}, Wiped ${status.wipes?.length || 0})\n`)

  if (Object.keys(status).length) util.write(cfg.report, JSON.stringify(status, null, 2))

  uploads.export(cfg.uploads)
  stores.uploads = uploads
}

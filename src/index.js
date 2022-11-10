let dp = require('despair')
let util = require('./util')
let tempus = require('./tempus')
let boxticks = require('./boxticks')
let YouTube = require('./youtube')
let TemRec = require('temrec')
let ListStore = require('./liststore')
ListStore.setValueSwaps([undefined, true], ['X', false])

class TempusArchive {
  constructor (config) {
    this.cfg = require(config)
    this.overrides = require(util.join('..', this.cfg.overrides))
    this.levelzones = require(util.join('..', this.cfg.levelzones))
    this.tmp = this.cfg.tmp
    this.out = this.cfg.output

    this.yt = new YouTube(this.cfg.youtube)
    this.tr = new TemRec(this.cfg.temrec, true)
    this.tr.tmp = this.tmp

    this.players = new ListStore(this.cfg.players)
    this.records = new ListStore(this.cfg.records)
    this.uploads = new ListStore(this.cfg.uploads)

    this.launch = x => this.tr.launch(x)
    this.exit = x => this.tr.exit(x)
  }

  pending () {
    let pending = []
    for (let zone in this.records) {
      let record = this.records[zone]
      for (let id in record) {
        if (!record[id]) break // skip if demo not available
        if (this.uploads[zone]?.[id]) break // skip if record already uploaded
        pending.push(id)
      }
    }
    return pending
  }

  async fetch (id) {
    let rec = await TemRec.fetch(id)
    rec.key = `${rec.class}_${rec.zone}`
    rec.improvement = await tempus.getImprovementFromRecord(rec)

    let nick = this.players[rec.player]
    if (nick) nick = Object.keys(nick)[0]

    rec.display = await tempus.formatDisplay(rec, nick)
    return rec
  }

  async record (rec, type = 'default') {
    util.mkdir(this.tmp)

    let end = await this.#ending(rec.time, rec.improvement, type, this.tmp)

    let cmds = ['r_cleardecals']

    let ovr = this.overrides.filter(x => x.zones?.includes(rec.zone) || x.maps?.includes(rec.map) || x.records?.includes(rec.id))
    ovr.forEach(obj => obj.override && obj.override.cmd && cmds.push(obj.override.cmd))
    ovr = ovr.reduce((obj, item) => item.override ? Object.assign(obj, item.override) : obj, {})
    ovr.cmd = cmds.join(';')

    if (ovr.skip) return null

    let opts = util.merge({
      padding: this.cfg.padding,
      output: this.out,
      pre: this.cfg.pre,
      timed: true,
      cubemaps: true,
      ffmpeg: {
        '!sfx': end.sfx,
        subs: end.subs,
        curves: this.cfg.curves
      }
    }, ovr)

    for (let key in opts.ffmpeg) {
      opts.ffmpeg[key] = util.resolve(opts.ffmpeg[key]).replaceAll('\\', '/')

      // we need to escape colons in filter params but NOT in input params
      // ugly workaround for now
      if (key[0] !== '!') opts.ffmpeg[key] = opts.ffmpeg[key].replaceAll(':', '\\:')
    }

    let file = await this.tr.record(rec, opts)

    util.remove(this.tmp)

    return file
  }

  async upload (rec, file, progress) {
    util.mkdir(this.tmp)

    await this.yt.updateSession()

    let override = this.uploads[rec.key]
    if (override) override = Object.values(override).at(-1) // assuming the last key is the latest record

    let desc = `https://tempus.xyz/records/${rec.id}/${rec.zone}`
    if (override) desc += `\nPrevious Record: https://youtu.be/${override}`
    desc += `\n\n\nPlayer: https://steamcommunity.com/profiles/${util.formatSteamProfile(rec.player)}`
    desc += `\nDate: ${new Date(rec.date * 1000).toUTCString()}`

    let chapters = await this.#chapters(rec)
    if (chapters) desc += chapters

    let vid = await this.yt.uploadVideo(file, {
      title: rec.display,
      description: desc,
      visibility: this.cfg.unlisted.includes(rec.z.type) ? 'UNLISTED' : 'PUBLIC',
      category: this.cfg.meta.category,
      tags: [...this.cfg.meta.tags, `ta${rec.id}`, rec.map.split('_', 2).join('_'), rec.z.type[0] + rec.z.index]
    }, progress)

    let thumbnail = this.#thumb(file, (this.cfg.padding / (200 / 3)) + (rec.time / 2))

    await this.yt.updateVideo(vid, {
      videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: thumbnail } },
      gameTitle: { newKgEntityId: this.cfg.meta.game }
    })

    if (override) await this.yt.updateVideo(override, { privacyState: { newPrivacy: 'UNLISTED' } })

    this.uploads.add(rec.key, rec.id, vid)
    this.uploads.export(this.cfg.uploads)

    util.remove(this.tmp)

    return vid
  }

  async update (opts = { players: true, records: true, uploads: true }) {
    if (opts.players) {
      let num = 0
      let nicknames = await dp(this.cfg.nickdata).json()
      for (let nick of nicknames) {
        let id = util.formatSteamID(nick.steamId)
        if (!this.players[id]) {
          this.players[id] = { [nick.name]: true }

          util.log(`[Players] ${this.players.name}`)
          num++
        }
      }
      util.log(`[Players] Added ${num} additional nicknames! (${Object.keys(this.players).length} total)\n`)

      this.players.export(this.cfg.players)
    }

    if (opts.records) {
      let records = new ListStore()

      let max = this.cfg.max_maps
      for (let i = 0; i < max; i++) {
        let map = await tempus.getMap(i)
        if (map) {
          if ((Date.now() - map.map_info.date_added * 1000) < this.cfg.new_map_wait) continue // skip new maps
          for (let zone of this.cfg.zones) {
            let count = map.zone_counts[zone]
            for (let j = 0; j < count; j++) {
              let rec = await tempus.getMapRecords(map.map_info.id, zone, j + 1, 1)
              let s = rec.results.soldier[0]
              let d = rec.results.demoman[0]
              if (s) records.add(`S_${rec.zone_info.id}`, s.id, !!s.demo_info?.url)
              if (d) records.add(`D_${rec.zone_info.id}`, d.id, !!d.demo_info?.url)

              util.log(`[Records] ${i + 1}/${max} - ${map.map_info.name} [${zone} ${j + 1}] (${j + 1}/${count})`)
            }
          }
        }
      }
      util.log(`[Records] Fetched ${Object.keys(records).length} records!\n`)

      records.export(this.cfg.records)
      this.records = records
    }

    if (opts.uploads) {
      let uploads = new ListStore()
      let status = { dupes: [], privacy: { public: [], unlisted: [] }, update: {} }
      let info = {}

      util.log('[Uploads] Fetching videos...')

      let total = 0

      let loopVids = async next => {
        let res = await this.yt.listVideos(next)

        total += res.items.length
        util.log(`[Uploads] Fetching videos... ${total}`)

        for (let item of res.items) {
          let tfclass = item.title.match(/^\[(\w)\]/)[1]
          let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/)

          let key = `${tfclass}_${zone}`

          if (uploads[key]?.[record]) status.dupes.push(item.videoId)
          else {
            uploads.add(key, record, item.videoId)
            info[item.videoId] = item
          }
        }

        if (res.next) await loopVids(res.next)
      }
      await loopVids()

      util.log('[Uploads] Parsing videos...')

      for (let key in uploads) {
        let ups = Object.values(uploads[key])
        for (let i = 0; i < ups.length; i++) {
          let vid = ups[i]
          if (!info[vid]) console.log({ vid })
          let { privacy, description } = info[vid]

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
          }
        }
      }

      util.removeEmpty(status)

      if (status.dupes) console.log('Delete Duplicate Videos:', status.dupes)
      if (status.privacy) console.log('Change Video Privacy:', status.privacy)
      if (status.update) console.log('Change Description Chain Id:', status.update)

      util.log(`[Uploads] Processed ${Object.keys(uploads).length} videos!\n`)

      if (Object.keys(status).length) util.write(this.cfg.report, JSON.stringify(status, null, 2))

      uploads.export(this.cfg.uploads)
      this.uploads = uploads
    }
  }

  async #ending (time, improvement, type, out) {
    let dir = util.join(this.cfg.endings, type)

    let subs = util.read(util.join(dir, this.cfg.subs), 'utf-8')

    let pad = this.cfg.padding / (200 / 3)

    let t = x => new Date(x * 1000).toISOString().slice(11, -2)

    let primary = util.formatTime(time * 1000)
    let secondary = util.formatTime(improvement * 1000, improvement < 0.001 ? 4 : 3) || ''
    let [pri, mary] = primary.split('.')
    let [secon, dary] = secondary.split('.')

    if (!secondary) subs = subs.replace(/^.*?(?:%SECON%|%DARY%|%SECONDARY%).*?(?:\n|$)/gm, '')

    subs = subs
      .replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
      .replaceAll('%PRIMARY%', primary).replaceAll('%PRI%', pri).replaceAll('%MARY%', mary)
      .replaceAll('%SECONDARY%', secondary).replaceAll('%SECON%', secon).replaceAll('%DARY%', dary)

    let files = {
      subs: util.join(out, this.cfg.subs),
      sfx: util.join(dir, this.cfg.sfx)
    }

    util.write(files.subs, subs)

    return files
  }

  async #chapters (rec) {
    let zones = this.levelzones[rec.map]

    if (zones) {
      let demo = await TemRec.prototype.demo.call({ tmp: this.tmp, emit: () => {} }, rec.demo)
      let boxes = boxticks(demo, rec.player, zones, [rec.start, rec.end])

      if (boxes.length) {
        let desc = '\n\n0:00 Start'

        if (!boxes[0].ticks.length) boxes[0].ticks = [[rec.start]]

        for (let i = 0; i < boxes.length; i++) {
          let tick = boxes[i].ticks[0]?.[0]
          if (!tick) continue
          tick -= (rec.start - this.cfg.padding)
          let time = util.formatTime((tick / (200 / 3)) * 1000, 0)
          desc += `\n${time} Level ${i + 1}`
        }

        desc += `\n${util.formatTime((rec.end / (200 / 3)) * 1000, 0)} Finish`

        return desc
      }
    }

    return null
  }

  #thumb (file, seconds) {
    let path = util.join(this.tmp, this.cfg.thumb)
    util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" "${path}"`)
    return 'data:image/png;base64,' + util.read(path, 'base64')
  }
}

module.exports = TempusArchive

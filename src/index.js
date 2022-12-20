let dp = require('despair')
let util = require('./util')
let tempus = require('./tempus')
let boxticks = require('./tools/boxticks')
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
    rec.end = rec.start + (rec.time * (200 / 3))
    rec.key = `${rec.class}_${rec.zone}`
    rec.diff = await tempus.getDiffFromRecord(rec)

    if (rec.rank === 1 && rec.z.type === 'map') {
      let wrs = await tempus.getMapWRS(rec.map)
      rec.splits = Object.values(wrs).find(x => x && x.wr.id === rec.id)?.wr?.splits
    }

    let nick = this.players[rec.player]
    if (nick) nick = Object.keys(nick)[0]

    rec.display = tempus.formatDisplay(rec, nick)
    return rec
  }

  async record (rec, endingStyle = 'default', splitStyle = 'default') {
    util.mkdir(this.tmp)

    let end = await this.#ending(rec.time, rec.diff, endingStyle, this.tmp)

    if (rec.splits) {
      let splits = await this.#splits(rec.splits, splitStyle, this.tmp)
      end.subs = this.#merge(end.subs, splits)
    }

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
      cubemaps: false,
      vis: true,
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

  async upload (rec, file, progress, single = false) {
    util.mkdir(this.tmp)

    await this.yt.updateSession()

    let override = this.uploads[rec.key]
    if (override) override = Object.values(override).at(-1) // assuming the last key is the latest record

    if (single) override = null

    let tier = null
    if (rec.z.type !== 'trick') tier = rec.tier

    let desc = [
      `https://tempus.xyz/records/${rec.id}/${rec.zone}`,
      override ? `Previous Record: https://youtu.be/${override}` : '',
      '',
      tier ? `Tier: ${tier} (${tempus.formatTier(tier)})` : null,
      `Demo: https://tempus.xyz/demos/${rec.z.demo}`,
      `Player: https://steamcommunity.com/profiles/${util.formatSteamProfile(rec.player)}`,
      `Date: ${new Date(rec.date * 1000).toUTCString()}`
    ].filter(x => x !== null).join('\n')

    let chapters = await this.#chapters(rec)
    if (chapters) desc += chapters

    let vid = await this.yt.uploadVideo(file, {
      title: (single ? '! ' : '') + rec.display,
      description: desc,
      visibility: single ? 'UNLISTED' : (this.cfg.unlisted.includes(rec.z.type) ? 'UNLISTED' : 'PUBLIC'),
      category: this.cfg.meta.category,
      tags: [...this.cfg.meta.tags, `ta${rec.id}`, rec.map.split('_', 2).join('_'), rec.z.type[0] + rec.z.index]
    }, progress)

    let time = (this.cfg.padding / (200 / 3)) + (rec.time / 2)
    if (rec.splits) time = rec.splits[0].duration - 0.1
    let thumbnail = await this.#thumb(file, time)

    await this.yt.updateVideo(vid, {
      videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: thumbnail } },
      gameTitle: { newKgEntityId: this.cfg.meta.game }
    })

    if (override) await this.yt.updateVideo(override, { privacyState: { newPrivacy: 'UNLISTED' } })

    if (!single) {
      this.uploads.add(rec.key, rec.id, vid)
      this.uploads.export(this.cfg.uploads)
    }

    if (util.exists(this.cfg.velo)) {
      // captions over 13min~ wont have styling
      // captions over 1h50min~ break, so we half their fps
      // captions over 3h40min~ turned completely off
      if (rec.time <= this.cfg.caption_limit_max) {
        await this.yt.addCaptions(vid, [
          this.#captions(this.cfg.velo, rec, 0, 'Run Timer'),
          this.#captions(this.cfg.velo, rec, 1, 'Speedo (Horizontal)'),
          this.#captions(this.cfg.velo, rec, 2, 'Speedo (Vertical)'),
          this.#captions(this.cfg.velo, rec, 3, 'Speedo (Absolute)'),
          this.#captions(this.cfg.velo, rec, 4, 'Tick of Demo')
        ])
      }
    }

    util.remove([this.tmp, this.cfg.velo])

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

      let maps = await tempus.getMapList()

      for (let i = 0; i < maps.length; i++) {
        let map = maps[i]
        // if ((Date.now() - map.map_info.date_added * 1000) < this.cfg.new_map_wait) continue // skip new maps
        for (let zone of this.cfg.zones) {
          let count = map.zone_counts[zone]
          for (let j = 0; j < count; j++) {
            let rec = await tempus.getMapRecords(map.id, zone, j + 1, 1)
            let s = rec.results.soldier[0]
            let d = rec.results.demoman[0]
            if (s) records.add(`S_${rec.zone_info.id}`, s.id, !!s.demo_info?.url)
            if (d) records.add(`D_${rec.zone_info.id}`, d.id, !!d.demo_info?.url)

            util.log(`[Records] ${i + 1}/${maps.length} - ${map.name} [${zone} ${j + 1}] (${j + 1}/${count})`)
          }
        }
      }
      util.log(`[Records] Fetched ${Object.keys(records).length} records!\n`)

      records.export(this.cfg.records)
      this.records = records
    }

    if (opts.uploads) {
      let uploads = new ListStore()
      let status = { skips: [], dupes: [], privacy: { public: [], unlisted: [] }, update: {} }
      let info = {}

      util.log('[Uploads] Fetching videos...')

      let total = 0

      let loopVids = async next => {
        let res = await this.yt.listVideos(next)

        total += res.items.length
        util.log(`[Uploads] Fetching videos... ${total}`)

        for (let item of res.items) {
          if (item.title[0] === '!') {
            status.skips.push(item.videoId)
            continue
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

      util.log('')
      if (status.dupes) console.log('Delete Duplicate Videos:', status.dupes)
      if (status.privacy) console.log('Change Video Privacy:', status.privacy)
      if (status.update) console.log('Change Description Chain Id:', status.update)
      if (status.skips) console.log('Skipped records:', status.skips)

      util.log(`[Uploads] Processed ${Object.keys(uploads).length} videos! (Skipped ${status.skips?.length || 0})\n`)

      if (Object.keys(status).length) util.write(this.cfg.report, JSON.stringify(status, null, 2))

      uploads.export(this.cfg.uploads)
      this.uploads = uploads
    }
  }

  async #ending (time, diff, style, out) {
    let dir = util.join(this.cfg.endings, style)
    let subs = util.read(util.join(dir, this.cfg.subs), 'utf-8')

    let pad = this.cfg.padding / (200 / 3)

    let t = x => new Date(x * 1000).toISOString().slice(11, -2)

    let primary = util.formatTime(time * 1000)
    let secondary = util.formatTime(diff * 1000, Math.abs(diff) < 0.001 ? 4 : 3) || ''
    if (secondary && diff >= 0) secondary = '+' + secondary

    let [pri, mary] = primary.split('.')
    let [secon, dary] = secondary.split('.')

    if (!secondary) subs = subs.replace(/^.*?(?:%SECON%|%DARY%|%SECONDARY%).*?(?:\n|$)/gm, '')

    subs = subs
      .replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
      .replaceAll('%PRIMARY%', primary).replaceAll('%PRI%', pri).replaceAll('%MARY%', mary)
      .replaceAll('%SECONDARY%', secondary).replaceAll('%SECON%', secon).replaceAll('%DARY%', dary)

    let files = {
      subs: util.join(out, 'ending-' + this.cfg.subs),
      sfx: util.join(dir, this.cfg.sfx)
    }

    util.write(files.subs, subs)

    return files
  }

  async #splits (splits, style, out) {
    let dir = util.join(this.cfg.splits, style)
    let subs = util.read(util.join(dir, this.cfg.subs), 'utf-8').replaceAll('\r\n', '\n')

    let template = (subs.match(/^Dialogue:.*/gm) || []).join('\n')

    let pad = this.cfg.padding / (200 / 3)
    let t = x => new Date(x * 1000).toISOString().slice(11, -2)

    let points = []

    for (let split of splits) {
      let name = split.type[0].toUpperCase() + split.type.slice(1) + ' ' + split.zoneindex
      let time = split.duration
      let diff = (split.duration - split.compared_duration)

      let primary = util.formatTime(time * 1000)
      let secondary = util.formatTime(diff * 1000, Math.abs(diff) < 0.001 ? 4 : 3) || ''
      if (secondary && diff >= 0) secondary = '+' + secondary

      let [pri, mary] = primary.split('.')
      let [secon, dary] = secondary.split('.')

      if (!secondary) subs = subs.replace(/^.*?(?:%SECON%|%DARY%|%SECONDARY%).*?(?:\n|$)/gm, '')

      points.push(
        template.replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
          .replaceAll('%NAME%', name)
          .replaceAll('%PRIMARY%', primary).replaceAll('%PRI%', pri).replaceAll('%MARY%', mary)
          .replaceAll('%SECONDARY%', secondary).replaceAll('%SECON%', secon).replaceAll('%DARY%', dary)
      )
    }

    subs = subs.replace(template, points.join('\n'))

    let dest = util.join(out, 'splits-' + this.cfg.subs)

    util.write(dest, subs)

    return dest
  }

  async #chapters (rec) {
    let zones = this.levelzones[rec.map]

    if (zones && !['bonus', 'trick'].includes(rec.z.type)) {
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

  #captions (file, rec, method, name) {
    let lines = util.read(file, 'utf-8').split(/\r?\n/)
    let caps = util.read(util.join(this.cfg.captions, 'default', 'subs.ytt'), 'utf-8')

    let template = caps.match(/<p .*<\/p>/)[0]

    let parts = []

    let range = [rec.start - this.cfg.padding, rec.end + this.cfg.padding]

    let ms = x => ((x - range[0]) / (200 / 3)) * 1000

    let act = {
      0: (tick) => {
        let t = tick - rec.start
        if (tick > rec.end) t = rec.end - rec.start
        return util.formatTime((t / (200 / 3)) * 1000, 2)
      },
      1: (tick, x, y, z) => {
        let vel = Math.sqrt(x * x + y * y) + 0.5
        return vel > 3500 ? 3500 : Math.floor(vel)
      },
      2: (tick, x, y, z) => {
        let vel = Math.abs(z) + 0.5
        return vel > 3500 ? 3500 : Math.floor(vel)
      },
      3: (tick, x, y, z) => {
        let vel = Math.sqrt(x * x + y * y + z * z) + 0.5
        return Math.floor(vel)
      },
      4: (tick) => {
        return tick
      }
    }

    let styled = lines.length <= this.cfg.caption_limit_style
    let reduced = rec.time > this.cfg.caption_limit_reduced

    for (let i = 0; i < lines.length; i++) {
      let [tick, x, y, z] = lines[i].split(' ').map(Number)

      if (tick < range[0] || tick > range[1]) continue

      let start = ms(tick)
      let n = lines[i + (reduced ? 2 : 1)]
      let next = n ? ms(Number(n.split(' ')[0])) : null

      let [a, b, c] = [Math.floor(start), next ? Math.ceil(next - start) : 100, act[method](tick, x, y, z)]

      if (!styled) parts.push({ startTimeMs: a, durationMs: b, text: c.toString() })
      else parts.push(template.replace('%START%', a).replace('%TIME%', b).replace('%TEXT%', c))

      if (reduced) i++
    }

    let res = { name, lang: 'en' }
    if (styled) res.buffer = Buffer.from(caps.replace(template, parts.join('\n')))
    else res.segments = parts

    return res
  }

  async #thumb (file, seconds) {
    let path = util.join(this.tmp, this.cfg.thumb)
    await util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" "${path}"`)
    return 'data:image/png;base64,' + util.read(path, 'base64')
  }

  #merge (source, target) {
    let o = {
      s: util.read(source, 'utf-8').replaceAll('\r\n', '\n'),
      t: util.read(target, 'utf-8').replaceAll('\r\n', '\n')
    }

    for (let part in o) {
      let styles = (o[part].match(/^Style: (.*?),/gm) || []).map(x => x.slice(7, -1))
      for (let style of styles) {
        let regex = new RegExp(`(?<=(,| ))${style},`, 'g')
        o[part] = o[part].replace(regex, `${part}-$&`)
      }
    }

    for (let part of ['Style', 'Dialogue']) {
      let regex = new RegExp(`^${part}:.*`, 'gm')

      let pointer = o.s.indexOf('\n', o.s.lastIndexOf(part + ':'))
      if (!o.s.match(regex)) {
        if (part === 'Style') pointer = o.s.indexOf('[V4+ Styles]')
        else if (part === 'Dialogue') pointer = o.s.indexOf('[Events]')

        pointer = o.s.indexOf('\n', o.s.indexOf('\n', pointer) + 1)
      }

      let match = o.t.match(regex)
      if (match) o.s = o.s.slice(0, pointer + 1) + match.join('\n') + o.s.slice(pointer)
    }

    let out = util.join(source, '..', 'merged-subs.ass')

    util.write(out, o.s)
    return out
  }
}

module.exports = TempusArchive

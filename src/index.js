process.chdir(require('path').dirname(__dirname))

let util = require('./util')
let tempus = require('./tempus')
let YouTube = require('./youtube')
let TemRec = require('temrec')
let ListStore = require('./liststore')
ListStore.setValueSwaps([undefined, true], ['X', false])

class TempusArchive {
  constructor (config) {
    this.cfg = require(config)
    this.overrides = require(util.join('..', this.cfg.overrides))
    this.tmp = this.cfg.tmp

    this.yt = new YouTube(this.cfg.youtube)
    this.tr = new TemRec(this.cfg.temrec, true)

    this.records = new ListStore(this.cfg.records)
    this.uploads = new ListStore(this.cfg.uploads)

    this.launch = this.tr.launch
    this.exit = this.tr.exit
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
    rec.display = await tempus.formatDisplay(rec)
    return rec
  }

  async record (rec) {
    util.mkdir(this.tmp)

    let end = await this.#ending(rec.time, rec.improvement, 'default', this.tmp)

    let ovr = this.overrides.filter(x => x?.zones.includes(rec.zone) || x?.maps.includes(rec.map))
    ovr = ovr.reduce((obj, item) => item.override ? Object.assign(obj, item.override) : obj, {})

    let file = await this.tr.record(rec, util.merge({
      padding: this.cfg.padding,
      output: this.cfg.output,
      pre: this.cfg.pre,
      timed: true,
      ffmpeg: {
        sfx: end.sfx,
        subs: end.subs,
        curves: this.cfg.curves
      }
    }, ovr))

    util.remove(this.tmp)

    return file
  }

  async upload (rec, file) {
    util.mkdir(this.tmp)

    let override = this.uploads[rec.key]
    if (override) override = Object.values(override).at(-1) // assuming the last key is the latest record

    let desc = `https://tempus.xyz/records/${rec.id}/${rec.zone}`
    if (override) desc += `\n\nPrevious WR: https://youtu.be/${override}`

    let vid = await this.yt.uploadVideo(file, {
      title: rec.display,
      description: desc,
      visibility: 'UNLISTED', // change to PUBLIC on release
      category: this.cfg.meta.category,
      tags: [...this.cfg.meta.tags, `https://tempus.xyz/records/${rec.id}`]
    })

    let thumbnail = this.#thumb(file, (this.cfg.padding / (200 / 3)) + (rec.time / 2))

    await this.yt.updateVideo(vid, {
      videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: thumbnail } },
      gameTitle: { newKgEntityId: this.cfg.meta.game }
    })

    if (override) await this.yt.updateVideo(override, { privacyState: { newPrivacy: 'UNLISTED' } })

    this.uploads.add(rec.key, rec.id, vid)
    this.uploads.export()

    util.remove(this.tmp)

    return vid
  }

  async update (opts = { records: true, uploads: true }) {
    if (opts.records) {
      let records = new ListStore()
      for (let i = 0; i < this.cfg.max_maps; i++) {
        let map = await tempus.getMap(i)
        if (map) {
          if ((Date.now() - map.map_info.date_added * 1000) < this.cfg.new_map_wait) continue // skip new maps
          for (let zone of this.cfg.zones) {
            for (let i = 0; i < map.zone_counts[zone]; i++) {
              let rec = await tempus.getMapRecords(map.map_info.id, zone, i + 1, 1)
              let s = rec.results.soldier[0]
              let d = rec.results.demoman[0]
              if (s) records.add(`S_${rec.zone_info.id}`, s.id, !!s.demo_info?.url)
              if (d) records.add(`D_${rec.zone_info.id}`, d.id, !!d.demo_info?.url)
            }
          }
        }
      }

      records.export(this.cfg.records)
      this.records = records
    }
    if (opts.uploads) {
      let uploads = new ListStore()
      let status = { dupes: [], privacy: { public: [], unlisted: [] }, update: {} }
      let info = {}

      let loopVids = async next => {
        let res = await this.yt.listVideos(next)

        for (let item of res.items) {
          let tfclass = item.title.match(/^\[(\w)\]/)[1]
          let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/).map(x => Number(x))

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

      for (let key in uploads) {
        let uploads = Object.values(this.uploads[key])
        for (let i = 0; i < uploads.length; i++) {
          let vid = uploads[i]
          let { privacy, description } = info[vid]

          // verify privacy status
          if (i === uploads.length - 1) {
            if (privacy !== 'VIDEO_PRIVACY_PUBLIC') status.privacy.public.push(vid)
          } else {
            if (privacy !== 'VIDEO_PRIVACY_UNLISTED') status.privacy.unlisted.push(vid)
          }

          // verify description link chain
          if (uploads.length > 1 && i !== 0) {
            let pwr = uploads[i - 1]
            let match = description.match('https://youtu.be/' + pwr)
            if (!match) status.update[vid] = pwr
          }
        }
      }

      if (!status.privacy.public.length) delete status.privacy.public
      if (!status.privacy.unlisted.length) delete status.privacy.unlisted

      if (status.dupes.length) console.log('Delete Duplicate Videos:', status.dupes)
      if (Object.keys(status.privacy).length) console.log('Change Video Privacy:', status.privacy)
      if (Object.keys(status.update).length) console.log('Change Description Chain Id:', status.update)

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
    let secondary = improvement ? util.formatTime(improvement * 1000, improvement < 0.001 ? 4 : 3) : ''
    let [pri, mary] = primary.split('.')
    let [secon, dary] = secondary.split('.')

    subs = subs
      .replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
      .replaceAll('%PRIMARY%', primary || '')
      .replaceAll('%PRI%', pri || '')
      .replaceAll('%MARY%', mary || '')
      .replaceAll('%SECONDARY%', secondary || '')
      .replaceAll('%SECON%', secon || '')
      .replaceAll('%DARY%', dary || '')

    let files = {
      subs: util.join(out, this.cfg.subs).replaceAll('\\', '/'),
      sfx: util.join(dir, this.cfg.sfx).replaceAll('\\', '/')
    }

    util.write(files.subs, subs)

    return files
  }

  #thumb (file, seconds) {
    let path = util.join(this.tmp, this.cfg.thumb)
    util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" "${path}"`)
    return 'data:image/png;base64,' + util.read(path, 'base64')
  }
}

module.exports = TempusArchive

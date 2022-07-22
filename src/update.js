process.chdir(require('path').dirname(__dirname))

let cfg = require('../data/config.json')
let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube(cfg.youtube)
let tempus = require('./tempus')

ListStore.setValueSwaps([undefined, true], ['X', false])

let MAX_MAPS = cfg.max_maps
let NEWMAP_WAIT = cfg.new_map_wait
let ZONES = cfg.zones

async function updateRecordsFile (file) {
  let RECORDS = new ListStore()
  for (let i = 0; i < MAX_MAPS; i++) {
    let map = await tempus.getMap(i)
    if (map) {
      if ((Date.now() - map.map_info.date_added * 1000) < NEWMAP_WAIT) continue // skip new maps
      for (let zone of ZONES) {
        for (let i = 0; i < map.zone_counts[zone]; i++) {
          let rec = await tempus.getMapRecords(map.map_info.id, zone, i + 1, 1)
          let s = rec.results.soldier[0]
          let d = rec.results.demoman[0]
          if (s) RECORDS.add(`S_${rec.zone_info.id}`, s.id, !!s.demo_info?.url)
          if (d) RECORDS.add(`D_${rec.zone_info.id}`, d.id, !!d.demo_info?.url)
        }
      }
    }
  }

  RECORDS.export(file)
}

async function updateUploadsFile (file) {
  let UPLOADS = new ListStore()
  let status = { dupes: [], privacy: { public: [], unlisted: [] }, update: {} }
  let info = {}

  let loopVids = async next => {
    let res = await yt.listVideos(next)

    for (let item of res.items) {
      let tfclass = item.title.match(/^\[(\w)\]/)[1]
      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/).map(x => Number(x))

      let key = `${tfclass}_${zone}`

      if (UPLOADS[key]?.[record]) status.dupes.push(item.videoId)
      else {
        UPLOADS.add(key, record, item.videoId)
        info[item.videoId] = item
      }
    }

    if (res.next) await loopVids(res.next)
  }
  await loopVids()

  for (let key in UPLOADS) {
    let uploads = Object.values(UPLOADS[key])
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

  UPLOADS.export(file)
}

async function main () {
  await updateRecordsFile(cfg.records)
  await updateUploadsFile(cfg.uploads)
}
main()

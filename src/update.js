process.chdir(require('path').dirname(__dirname))

let cfg = require('../data/config.json')
let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube(cfg.youtube)
let tempus = require('./tempus')

ListStore.setValueSwaps([undefined, true], ['X', false])

let MAX_MAPS = cfg.max_maps
let ZONES = cfg.zones

async function updateRecordsFile (file) {
  let RECORDS = new ListStore()
  for (let i = 0; i < MAX_MAPS; i++) {
    let map = await tempus.getMap(i)
    if (map) {
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
  let dupes = []
  let privacies = {}

  let loopVids = async next => {
    let res = await yt.listVideos(next)

    for (let item of res.items) {
      let tfclass = item.title.match(/^\[(\w)\]/)[1]
      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/).map(x => Number(x))

      let key = `${tfclass}_${zone}`

      if (UPLOADS[key]?.[record]) dupes.push(item.videoId)
      else {
        UPLOADS.add(key, record, item.videoId)
        privacies[item.videoId] = item.privacy
      }
    }

    if (res.next) await loopVids(res.next)
  }
  await loopVids()

  // verify privacy status for each upload
  let status = { public: [], unlisted: [] }
  for (let key in UPLOADS) {
    let records = UPLOADS[key]
    let i = Object.keys(records).length
    for (let record in records) {
      let vid = records[record]
      let privacy = privacies[vid]

      if (--i === 0) { // latest record should be public
        if (privacy !== 'VIDEO_PRIVACY_PUBLIC') status.public.push(vid)
      } else { // rest should be unlisted
        if (privacy !== 'VIDEO_PRIVACY_UNLISTED') status.unlisted.push(vid)
      }
    }
  }

  if (dupes.length) console.log('Duplicate Records:', dupes)
  if (status.public.length) console.log('Should be PUBLIC:', status.public)
  if (status.unlisted.length) console.log('Should be UNLISTED:', status.unlisted)

  UPLOADS.export(file)
}

async function main () {
  await updateRecordsFile(cfg.records)
  await updateUploadsFile(cfg.uploads)
}
main()

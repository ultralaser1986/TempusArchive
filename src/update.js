let ph = require('path')

let cfg = require('./config.json')
let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube('./data/keys.json')
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

  let loopVids = async next => {
    let res = await yt.listVideos(next)

    for (let item of res.items) {
      let tfclass = item.title.match(/^\[(\w)\]/)[1]
      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/).map(x => Number(x))

      UPLOADS.add(`${tfclass}_${zone}`, record, item.videoId)
    }

    if (res.next) await loopVids(res.next)
  }
  await loopVids()

  UPLOADS.export(file)
}

async function main () {
  await updateRecordsFile(ph.resolve(__dirname, 'data', 'records.list'))
  await updateUploadsFile(ph.resolve(__dirname, 'data', 'uploads.list'))
}
main()

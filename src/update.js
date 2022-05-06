let fs = require('fs')
let ph = require('path')
let dp = require('despair')

let YouTube = require('./youtube')
let yt = new YouTube('./data/keys.json')

let base = 'https://tempus.xyz/api'
let MAX_MAPS = 800
let ZONES = ['bonus', 'trick']

let TempusAPI = {
  async getMap (id) {
    return await dp(base + `/maps/id/${id}/fullOverview`).json().catch(() => null)
  },
  async getRecords (id, zone, index, limit = 1) {
    return await dp(base + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  }
}

async function updateRecordsFile (file) {
  let RECORDS = []
  for (let i = 0; i < MAX_MAPS; i++) {
    let map = await TempusAPI.getMap(i)
    if (map) {
      for (let zone of ZONES) {
        for (let i = 0; i < map.zone_counts[zone]; i++) {
          let rec = await TempusAPI.getRecords(map.map_info.id, zone, i + 1, 1)
          let s = rec.results.soldier[0]?.id
          let d = rec.results.demoman[0]?.id
          if(s) RECORDS.push(`S_${rec.zone_info.id} ${s}`)
          if(d) RECORDS.push(`D_${rec.zone_info.id} ${d}`)
        }
      }
    }
  }
  fs.writeFileSync(file, RECORDS.join("\n"))
}

async function updateUploadsFile (file) {
  let UPLOADS = []

  let loopVids = async next => {
    let res = await yt.listVideos(next)
    
    for(let item of res.items) {
      let tfclass = item.title.match(/^\[(\w)\]/)[1]
      let [,record, zone] = item.description.match(/records\/(\d+)\/(\d+)/).map(x => Number(x))
      
      UPLOADS.push(`${tfclass}_${zone} ${record} ${item.videoId}`)
    }

    if(res.next) await loopVids(next)
  }
  await loopVids()

  fs.writeFileSync(file, UPLOADS.join("\n"))
}

async function main() {
  //await updateRecordsFile(ph.resolve(__dirname, 'data', 'records.list'))
  await updateUploadsFile(ph.resolve(__dirname, 'data', 'uploads.list'))
}
main()
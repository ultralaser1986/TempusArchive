let fs = require("fs")
let ph = require("path")
let dp = require("despair")

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

async function updateRecordsFile(file) {
    let RECORDS = {}
    for(let i = 0; i < MAX_MAPS; i++) {
        let map = await TempusAPI.getMap(i)
        if(map) {
            for(let zone of ZONES) {
                for(let i = 0; i < map.zone_counts[zone]; i++) {
                    let rec = await TempusAPI.getRecords(map.map_info.id, zone, i + 1, 1)
                    RECORDS[rec.zone_info.id] = {
                        3: rec.results.soldier[0]?.id || null,
                        4: rec.results.demoman[0]?.id || null
                    }
                }
            }
        }
    }
    fs.writeFileSync(file, JSON.stringify(RECORDS))
}

updateRecordsFile(ph.resolve(__dirname, 'data', 'records.json'))

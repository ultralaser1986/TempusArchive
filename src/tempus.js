let dp = require('despair')

let base = 'https://tempus.xyz/api'
let nicknames = 'https://raw.githubusercontent.com/laurirasanen/TempusRecords/master/src/data/nicknames.json'

module.exports = {
  async getMap (id) {
    return await dp(base + `/maps/id/${id}/fullOverview`).json().catch(() => null)
  },
  async getRecord (id) {
    return await dp(base + `/records/id/${id}/overview`).json().catch(() => null)
  },
  async getMapRecords (id, zone, index, limit = 1) {
    return await dp(base + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  },
  async formatNickname (steamId) {
    let names = await dp(nicknames).json().catch(() => null)
    if (!names) throw Error('Invalid nicknames.json')
    let nick = names.find(x => x.steamId === steamId)
    if (nick) return nick.name || null
  },
  async getImprovementFromRecord (rec) {
    let z = rec.zone_info
    let d = rec.record_info.duration
    let c = rec.record_info.class === 3 ? 'soldier' : 'demoman'
    let m = await this.getMapRecords(z.map_id, z.type, z.zoneindex, 100)
    let w = m.results[c].slice(1).find(x => x.duration > d)
    return w ? (w.duration - d) : 0
  }
}

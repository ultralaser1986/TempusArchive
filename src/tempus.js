let dp = require('despair')
let util = require('./util')

let base = 'https://tempus.xyz/api'

module.exports = {
  async getMapList () {
    return await dp(base + '/maps/detailedList').json().catch(() => null)
  },
  async getMapRecords (id, zone, index, limit = 1) {
    return await dp(base + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  },
  async getDiffFromRecord (rec) {
    let c = rec.class === 'S' ? 'soldier' : 'demoman'
    let m = await this.getMapRecords(rec.z.map, rec.z.type, rec.z.index, 100)
    let w = rec.rank !== 1 ? m.results[c][0] : m.results[c].slice(1).find(x => x.duration > rec.time)
    return w ? (rec.time - w.duration) : 0
  },
  formatDisplay (rec, nick) {
    let type = rec.z.type
    if (type === 'map') type = ''
    else type = `${type[0].toUpperCase()}${type.slice(1)} ${rec.z.index}`
    let custom = rec.z.custom

    let time = util.formatTime(rec.time * 1000)

    let title = `[${rec.class}] ${nick || rec.nick} on ${rec.map} ${type}`.trim()
    if (custom) title += ` (${util.maxLen(custom, 30)})`
    title += ` - ${time}`

    return title
  },
  formatTier (tier) {
    switch (tier) {
      case 1: return 'Very Easy'
      case 2: return 'Easy'
      case 3: return 'Medium'
      case 4: return 'Hard'
      case 5: return 'Very Hard'
      case 6: return 'Insane'
    }
    return 'Unknown'
  },
  async getMapWRS (map) {
    return await dp(base + `/maps/name/${map}/wrs`).json().catch(() => null)
  }
}

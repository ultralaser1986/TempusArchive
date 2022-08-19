let dp = require('despair')
let util = require('./util')

let base = 'https://tempus.xyz/api'

module.exports = {
  async getMap (id) {
    return await dp(base + `/maps/id/${id}/fullOverview`).json().catch(() => null)
  },
  async getMapRecords (id, zone, index, limit = 1) {
    return await dp(base + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  },
  async getImprovementFromRecord (rec) {
    let c = rec.class === 'S' ? 'soldier' : 'demoman'
    let m = await this.getMapRecords(rec.z.map, rec.z.type, rec.z.index, 100)
    let w = m.results[c].slice(1).find(x => x.duration > rec.time)
    return w ? (w.duration - rec.time) : 0
  },
  async formatDisplay (rec, nick) {
    let type = rec.z.type
    if (type === 'map') type = ''
    else type = `${type[0].toUpperCase()}${type.slice(1)} ${rec.z.index}`
    let custom = rec.z.custom

    let time = util.formatTime(rec.time * 1000)

    let title = `[${rec.class}] ${nick || rec.nick} on ${rec.map} ${type}`.trim()
    if (custom) title += ` (${util.maxLen(custom, 30)})`
    title += ` - ${time}`

    return title
  }
}

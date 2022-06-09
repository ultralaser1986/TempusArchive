let dp = require('despair')

let base = 'https://tempus.xyz/api'

module.exports = {
  async getMap (id) {
    return await dp(base + `/maps/id/${id}/fullOverview`).json().catch(() => null)
  },
  async getRecord (id) {
    return await dp(base + `/records/id/${id}/overview`).json().catch(() => null)
  },
  async getMapRecords (id, zone, index, limit = 1) {
    return await dp(base + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  }
}

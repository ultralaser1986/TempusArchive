let dp = require('despair')

let API_URL = 'https://tempus2.xyz/api/v0'
let TFCLASS = { 3: 'soldier', 4: 'demoman' }

module.exports = {
  async getRecordOverview (id) {
    return await dp(API_URL + `/records/id/${id}/overview`).json().catch(() => null)
  },
  async getActivity () {
    return await dp(API_URL + '/activity').json().catch(() => null)
  },
  async getMapList () {
    return await dp(API_URL + '/maps/detailedList').json().catch(() => null)
  },
  async getMapRecords (id, zone, index, limit = 1) {
    return await dp(API_URL + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`).json().catch(() => null)
  },
  async getZoneRecords (id, limit = 1) {
    return await dp(API_URL + `/zones/id/${id}/records/list?limit=${limit}`).json().catch(() => null)
  },
  async getDiffFromRecord (rec) {
    let c = TFCLASS[rec.record_info.class]
    let m = await this.getZoneRecords(rec.record_info.zone_id, 100)
    let w = rec.record_info.rank !== 1 ? m.results[c][0] : m.results[c][1]
    return w ? (rec.record_info.duration - w.duration) : null
  },
  async getMapWRS (map) {
    return await dp(API_URL + `/maps/name/${map}/wrs`).json().catch(() => null)
  },
  formatTier (tier) {
    switch (Number(tier)) {
      case 0: return 'Impossible'
      case 1: return 'Very Easy'
      case 2: return 'Easy'
      case 3: return 'Medium'
      case 4: return 'Hard'
      case 5: return 'Very Hard'
      case 6: return 'Insane'
    }
    return 'Unknown'
  },
  formatClass (num) {
    switch (num) {
      case 3: return 'S'
      case 4: return 'D'
    }
  }
}

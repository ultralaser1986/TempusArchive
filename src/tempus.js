let API_URL = 'https://tempus2.xyz/api/v0'
let TFCLASS = { 3: 'soldier', 4: 'demoman' }

async function retry (url) {
  let res = await fetch(url).catch(async e => {
    console.error(e)
    console.error('Error fetching tempus API! Retrying...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    return null
  })

  if (!res) return await retry(url)

  if (res.status === 429) {
    let delaySeconds = Number(res.headers.get('retry-after'))
    await new Promise(resolve => setTimeout(resolve, 1000 * delaySeconds))
    return await retry(url)
  }

  if (res.status === 404) {
    return null
  }

  return await res.json()
}

module.exports = {
  async getRecordOverview (id) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + `/records/id/${id}/overview`)
  },
  async getActivity () {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + '/activity')
  },
  async getMapList () {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + '/maps/detailedList')
  },
  async getMapRecords (id, zone, index, limit = 1) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + `/maps/id/${id}/zones/typeindex/${zone}/${index}/records/list?limit=${limit}`)
  },
  async getZoneRecords (id, limit = 1) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + `/zones/id/${id}/records/list?limit=${limit}`)
  },
  async getDiffFromRecord (rec) {
    let c = TFCLASS[rec.record_info.class]
    let m = await this.getZoneRecords(rec.record_info.zone_id, 100)
    let w = rec.record_info.rank !== 1 ? m.results[c][0] : m.results[c][1]
    return w ? (rec.record_info.duration - w.duration) : null
  },
  async getMapWRS (map) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    return await retry(API_URL + `/maps/name/${map}/wrs`)
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
      case 7: return 'Merciless'
      case 8: return 'Ultra-Violence'
      case 9: return 'Nightmare'
      case 10: return 'Extra Crispy'
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

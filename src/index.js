let cfg = require('./config.json')
let util = require('./util')
let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube('./data/keys.json')
let TemRec = require('temrec')
let tr = new TemRec('./config.ini')
let tempus = require('./tempus')

async function upload (rec, file) {
  let override = uploads[rec.zone]
  if (override) override = Object.values(override)[0] // assuming the first key is the latest record

  let tfclass = cfg.class[rec.record_info.class]
  let nick = (await tempus.formatNickname(rec.player_info.steamid)) || rec.player_info.name
  let map = rec.demo_info.mapname

  let type = rec.zone_info.type
  if (type === 'map') type = ''
  else type = `${type[0].toUpperCase()}${type.slice(1)} ${rec.zone_info.zoneindex}`
  let custom = rec.zone_info.custom_name

  let time = util.formatTime(rec.record_info.duration * 1000)

  let title = `[${tfclass}] ${nick} on ${map} ${type}`.trim()
  if (custom) title += ` (${util.maxLen(custom, 30)})`
  title += ` - ${time}`

  let desc = `https://tempus.xyz/records/${rec.record_info.id}/${rec.zone_info.id}`
  if (override) desc += `\n\nPrevious WR: https://youtu.be/${override}`

  let vid = await yt.uploadVideo(file, {
    title,
    description: desc,
    visibility: 'unlisted', // change to PUBLIC on release
    category: cfg.meta.category,
    tags: [...cfg.meta.tags, `https://tempus.xyz/records/${rec.record_info.id}`]
  })

  if (override) await yt.setVideoPrivacy(override, 'UNLISTED')

  return vid
}

ListStore.setValueSwaps([undefined, true], ['X', false])

let records = new ListStore('./data/records.list')
let uploads = new ListStore('./data/uploads.list')

let pending = []

for (let zone in records) {
  let record = records[zone]
  for (let id in record) {
    if (!record[id]) break // skip if demo not available
    if (uploads[zone]?.[id]) break // skip if record already uploaded
    pending.push(id)
  }
}

async function main () {
  await tr.launch()

  for (let i = 0; i < pending.length; i++) {
    console.log(`${i + 1}/${pending.length}`)

    let id = pending[i]
    let rec = await tempus.getRecord(id)
    rec.zone = `${cfg.class[rec.record_info.class]}_${rec.record_info.zone_id}`

    let file = await tr.record(id, { padding: cfg.padding, output: cfg.output })
    let vid = await upload(rec, file)

    uploads.add(rec.zone, id, vid)
    uploads.export()

    console.log('https://youtu.be/' + vid)

    util.remove(file)
  }

  await tr.exit()
}

main()

let kill = () => { try { tr.exit() } catch (e) {} }
process.on('SIGINT', kill)
process.on('exit', kill)

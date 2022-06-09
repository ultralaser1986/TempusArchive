let fs = require('fs')
let ph = require('path')

let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube('./data/keys.json')
let TemRec = require('temrec')
let tr = new TemRec('./config.ini')
let tempus = require('./tempus')
let util = require('./util')

let TFCLASS = { 3: 'S', 4: 'D' }
let CFG = { padding: 200, output: 'src/output' }
let META = { tags: ['tf2', 'jump', 'team fortress 2', 'rocket jumping', 'sticky jumping', 'tempus network', 'soldier', 'demoman'], category: 20 }

async function renderAndUpload (zone, id) {
  let override = uploads[zone]
  if (override) override = Object.values(override)[0] // assuming the first key is the latest record
  let rec = await tempus.getRecord(id)

  let tfclass = TFCLASS[rec.record_info.class]
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

  let desc = `https://tempus.xyz/records/${id}/${rec.zone_info.id}`
  if (override) desc += `\n\nPrevious WR: https://youtu.be/${override}`

  let file = ph.resolve(CFG.output, id + '.mp4')

  await tr.record([id], CFG)

  let vid = await yt.uploadVideo(file, {
    title,
    description: desc,
    visibility: 'unlisted',
    ...META
  })

  if (override) await yt.setVideoPrivacy(override, 'UNLISTED')

  console.log('https://youtu.be/' + vid)

  await new Promise(resolve => setTimeout(resolve, 3000))
  if (fs.existsSync(file)) fs.unlinkSync(file)

  return vid
}

ListStore.setValueSwaps([undefined, true], ['X', false])

let records = new ListStore('./data/records.list')
let uploads = new ListStore('./data/uploads.list')

let pending = {}

for (let zone in records) {
  let record = records[zone]
  for (let id in record) {
    if (!record[id]) break // skip if demo not available
    if (uploads[zone]?.[id]) break // skip if record already uploaded
    pending[zone] = id
  }
}

async function main () {
  await tr.launch()

  let total = Object.keys(pending).length
  let i = 1

  for (let zone in pending) {
    console.log(`${i++}/${total}`)
    let id = pending[zone]
    let vid = await renderAndUpload(zone, id)
    uploads.add(zone, id, vid)
  }

  await tr.exit()
}

main()

function kill () {
  uploads.export(ph.resolve(__dirname, 'data', 'uploads.list'))
  try { tr.exit() } catch (e) {}
}

process.on('SIGINT', kill)
process.on('exit', kill)

process.chdir(require('path').dirname(__dirname))
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
  if (override) override = Object.values(override).at(-1) // assuming the last key is the latest record

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
    visibility: 'UNLISTED', // change to PUBLIC on release
    category: cfg.meta.category,
    tags: [...cfg.meta.tags, `https://tempus.xyz/records/${rec.record_info.id}`]
  })

  await yt.updateVideo(vid, {
    videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: getThumb64(file, cfg.padding / (200 / 3)) } },
    gameTitle: { newKgEntityId: cfg.meta.game }
  })

  if (override) await yt.updateVideo(override, { privacyState: { newPrivacy: 'UNLISTED' } })

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

async function generateSubs (rec) {
  let subs = util.read(cfg.subs.in, 'utf-8')

  let pad = cfg.padding / (200 / 3)
  let time = rec.record_info.duration

  let t = x => new Date(x * 1000).toISOString().slice(11, -2)

  subs = subs
    .replace('%BOX_TIME%', t(pad + time) + ',' + t(pad + time + 1))
    .replace('%PRIMARY_TIME%', t(pad + time) + ',' + t(pad + time + 3))
    .replace('%SECONDARY_TIME%', t(pad + time + 0.05) + ',' + t(pad + time + 3))
    .replace('%PRIMARY_TEXT%', util.formatTime(time * 1000))
    .replace('%SECONDARY_TEXT%', rec.improvement ? '-' + util.formatTime(rec.improvement * 1000) : '')

  util.write(cfg.subs.out, subs)
}

function getThumb64 (file, seconds) {
  util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" "${cfg.thumb}"`)
  let thumb = 'data:image/png;base64,' + util.read(cfg.thumb, 'base64')
  util.remove(cfg.thumb)
  return thumb
}

async function main () {
  await tr.launch()

  for (let i = 0; i < pending.length; i++) {
    console.log(`${i + 1}/${pending.length}`)

    let id = pending[i]
    let rec = await tempus.getRecord(id)
    rec.zone = `${cfg.class[rec.record_info.class]}_${rec.record_info.zone_id}`
    rec.improvement = await tempus.getImprovementFromRecord(rec)

    await generateSubs(rec)

    let file = await tr.record(id, { padding: cfg.padding, output: cfg.output, pre: cfg.pre, timed: true })
    let vid = await upload(rec, file)

    uploads.add(rec.zone, id, vid)
    uploads.export()

    console.log('https://youtu.be/' + vid)

    util.remove([file, cfg.subs.out])
  }

  await tr.exit()
}

main()

let kill = () => {
  try {
    util.remove([cfg.subs.out, cfg.thumb])
    tr.exit()
  } catch (e) {}
}
process.on('SIGINT', kill)
process.on('exit', kill)

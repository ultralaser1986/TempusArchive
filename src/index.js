process.chdir(require('path').dirname(__dirname))

let cfg = require('../data/config.json')
let util = require('./util')
let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube(cfg.youtube)
let TemRec = require('temrec')
let tr = new TemRec(cfg.temrec, true)
let tempus = require('./tempus')

ListStore.setValueSwaps([undefined, true], ['X', false])

let records = new ListStore(cfg.records)
let uploads = new ListStore(cfg.uploads)

function merge (records, uploads) {
  let pending = []
  for (let zone in records) {
    let record = records[zone]
    for (let id in record) {
      if (!record[id]) break // skip if demo not available
      if (uploads[zone]?.[id]) break // skip if record already uploaded
      pending.push(id)
    }
  }
  return pending
}

async function upload (rec, file) {
  let override = uploads[rec.key]
  if (override) override = Object.values(override).at(-1) // assuming the last key is the latest record

  let desc = `https://tempus.xyz/records/${rec.id}/${rec.zone}`
  if (override) desc += `\n\nPrevious WR: https://youtu.be/${override}`

  let vid = await yt.uploadVideo(file, {
    title: rec.display,
    description: desc,
    visibility: 'UNLISTED', // change to PUBLIC on release
    category: cfg.meta.category,
    tags: [...cfg.meta.tags, `https://tempus.xyz/records/${rec.id}`]
  })

  let thumbnail = thumb(file, (cfg.padding / (200 / 3)) + (rec.time / 2))

  await yt.updateVideo(vid, {
    videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: thumbnail } },
    gameTitle: { newKgEntityId: cfg.meta.game }
  })

  if (override) await yt.updateVideo(override, { privacyState: { newPrivacy: 'UNLISTED' } })

  return vid
}

async function ending (time, improvement, type, out) {
  let dir = util.join(cfg.endings, type)

  let subs = util.read(util.join(dir, cfg.subs), 'utf-8')

  let pad = cfg.padding / (200 / 3)

  let t = x => new Date(x * 1000).toISOString().slice(11, -2)

  let primary = util.formatTime(time * 1000)
  let secondary = improvement ? util.formatTime(improvement * 1000, improvement < 0.001 ? 4 : 3) : ''
  let [pri, mary] = primary.split('.')
  let [secon, dary] = secondary.split('.')

  subs = subs
    .replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
    .replaceAll('%PRIMARY%', primary || '')
    .replaceAll('%PRI%', pri || '')
    .replaceAll('%MARY%', mary || '')
    .replaceAll('%SECONDARY%', secondary || '')
    .replaceAll('%SECON%', secon || '')
    .replaceAll('%DARY%', dary || '')

  util.write(util.join(out, cfg.subs), subs)

  util.copy(util.join(dir, cfg.sfx), util.join(out, cfg.sfx))
}

function thumb (file, seconds) {
  let path = util.join(cfg.tmp, cfg.thumb)
  util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" "${path}"`)
  return 'data:image/png;base64,' + util.read(path, 'base64')
}

async function main (ids) {
  let pending = ids.length ? ids : merge(records, uploads)

  await tr.launch()

  for (let i = 0; i < pending.length; i++) {
    console.log(`${i + 1}/${pending.length}`)

    util.mkdir(cfg.tmp)

    let id = pending[i]

    let rec = await TemRec.fetch(id)
    rec.key = `${rec.class}_${rec.zone}`
    rec.improvement = await tempus.getImprovementFromRecord(rec)
    rec.display = await tempus.formatDisplay(rec)

    // record
    console.log(id + ' << ' + rec.display)

    if (uploads[rec.key]?.[id]) {
      console.log('Already Uploaded:', uploads[rec.key][id])
      break
    }

    await ending(rec.time, rec.improvement, 'default', cfg.tmp)

    let file = await tr.record(rec, { padding: cfg.padding, output: cfg.output, pre: cfg.pre, timed: true })

    console.log(id + ' >> ' + file)

    // upload
    let vid = await upload(rec, file)
    uploads.add(rec.key, id, vid)
    uploads.export()
    console.log(`[${util.size(file)}]`, 'https://youtu.be/' + vid)

    util.remove([file, cfg.tmp])
  }

  await tr.exit()
}

main(process.argv.slice(2))

let KILLERS = ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2']
KILLERS.forEach(killer => process.on(killer, () => {
  try {
    util.remove(cfg.tmp)
    if (tr.app) tr.exit(true)
  } catch (e) {}
}))

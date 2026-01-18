/* global program, cfg, util, modules, stores, tr, overrides */
let MEDAL = '[Record]'

let ERROR = {
  SKIP: 0,
  BROKEN: 1
}

program
  .command('remaining')
  .description('view remaining records yet to be recorded')
  .action(async () => {
    let rem = await remaining()
    console.log(`${rem.items.length} records remaining! ${rem.skips} skipped!`)
    for (let i = 0; i < rem.items.length; i++) {
      let id = rem.items[i]
      let rec = await modules.fetch(id).catch(e => null)
      if (!rec) console.log(`[${id}] Record not found.`)
      else console.log(`[${id}] ${i + 1}/${rem.items.length} ${modules.display(rec)}`)
    }
  })

program
  .command('record')
  .description('render records')
  .argument('[ids...]', 'list of record ids to be rendered, otherwise renders all remaining ones')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-nt, --ntime <seconds>', 'limit amount of records rendered by seconds', 0)
  .option('-ns, --nsize <bytes>', 'limit amount of records rendered by bytes', 0)
  .option('-p, --pack', 'pack output files', false)
  .option('-s, --standalone', 'dont add record to upload queue', false)
  .option('-c, --continue', 'continue from previous state if exists', false)
  .action(main)

async function main (ids, opts) {
  let skips = 0
  let manual = !!ids.length

  if (opts.continue) {
    console.log('Continuing from previous state...')
    if (!util.exists(cfg.state)) {
      console.log('Could not continue. State file does not exist.')
      return
    } else {
      let state = JSON.parse(util.read(cfg.state))
      ids = state.ids
      opts = state.opts
    }
  } else {
    if (!ids.length) {
      let rem = await remaining()
      ids = rem.items
      skips = rem.skips
    }

    if (Number(opts.max) && ids.length > opts.max) ids.length = opts.max
  }

  let start = opts.index ?? 0
  let time = opts.time ?? 0
  let size = opts.size ?? 0

  let left = ids.length - start
  console.log(`Queued ${left} record${util.s(left)} for render! ${skips ? `(Skipped ${skips})` : ''}`.trim())

  for (let i = start; i < ids.length; i++) {
    if (time && Number(opts.ntime) && time > opts.ntime) {
      console.log(`ntime limit reached (${time.toFixed(1)}s > ${opts.ntime.toFixed(1)}s)! Quitting...`)
      break
    }

    if (size && Number(opts.nsize) && size > opts.nsize) {
      console.log(`nsize limit reached (${size}B > ${opts.nsize}B)! Quitting...`)
      break
    }

    util.write(cfg.state, JSON.stringify({ ids, opts: { ...opts, index: i, time, size } }))

    let id = ids[i]

    let rec = await modules.fetch(id).catch(e => null)

    if (!rec) {
      console.log(`Record ${id} not found! Skipping...`)
      continue
    }

    id = rec.id // incase we loaded a json file

    console.log(`${MEDAL} ${i + 1}/${ids.length} ${((i + 1) / ids.length * 100).toFixed(2)}% << (${id}): "${modules.display(rec)}"`)

    if (!rec.demo.url) {
      console.log(`Record ${id} does not have a demo! Skipping...`)
      continue
    }

    let video = util.join(cfg.output, id + '.mp4')
    if (await modules.read(video, null, { check: true })) {
      console.log('Record found on disk!')
      video = null
    } else {
      video = await record(rec).catch(e => { return { error: e } })
      if (video.error !== undefined) {
        switch (video.error) {
          case ERROR.SKIP: {
            console.log('Skipping record.')
            continue
          }
          case ERROR.BROKEN: throw Error(`Video output of ${video} is broken!`)
          default: throw video.error
        }
      }
    }

    if (video) {
      time += rec.time.duration
      size += util.size(video, true)

      if (opts.pack) {
        let files = Object.values(rec.files).map(x => util.join(cfg.output, x))
        let out = util.join(cfg.output, rec.id.toString())
        await modules.pack(files, out, { delete: true })

        console.log(`${MEDAL} (${id}) >> ${id}.rec`)
      } else console.log(`${MEDAL} (${id}) >> ${Object.values(rec.files).join(' ')}`)
    }

    if (opts.run) await modules.upload([id], opts)
    else if (!opts.standalone) await modules.queue.add(id)
  }

  // only clean files if we executed this file with specific ids or run mode is enabled
  if (manual || opts.run) modules.clean()

  if (tr.app) await tr.exit()
}

async function remaining () {
  let remaining = []
  let skips = 0
  for (let zone in stores.records) {
    let record = stores.records[zone]
    for (let id in record) {
      if (!record[id]) break // skip if demo not available
      if (stores.uploads[zone]?.[id]) break // skip if record already uploaded
      if (stores.uploads[zone]?.['#' + id]) break // skip if record already uploaded as pending
      // if (await modules.read(util.join(cfg.output, id), null, { check: true, json: true })) break // skip if record exists on disk
      if (options({ id }).skip && ++skips) break // skip if record is marked skip in overrides
      remaining.push(id)
    }
  }
  return {
    items: remaining.sort((a, b) => a - b),
    skips
  }
}

async function record (rec, endingStyle = 'default', splitStyle = 'default') {
  util.mkdir(cfg.tmp)

  let end = ending(util.fixTickDuration(rec.time.duration), util.fixTickDuration(rec.time.diff), endingStyle, cfg.tmp)
  if (rec.splits) end.subs = merge(end.subs, splits(rec.splits, splitStyle, cfg.tmp))

  // video
  let opts = options(rec, {
    padding: cfg.padding,
    output: cfg.output,
    pre: cfg.pre,
    timed: true,
    cubemaps: false,
    vis: false,
    reload: true,
    ffmpeg: {
      '!sfx': end.sfx,
      subs: end.subs,
      curves: cfg.curves
    }
  })

  if (opts.skip) throw ERROR.SKIP

  if (!tr.app) await tr.launch()

  let video = await tr.record({
    display: true,
    id: rec.id,
    map: rec.map,
    start: rec.time.start,
    end: rec.time.end,
    time: rec.time.duration,
    player: rec.player.steam,
    demo: rec.demo.url
  }, opts)

  // velo
  util.rename(cfg.velo, util.join(cfg.output, rec.files.velo))

  // thumb
  let time = (cfg.padding / (200 / 3)) + (rec.time.duration / 2)
  if (rec.splits) time = rec.splits[0].time.duration - 0.1
  await thumb(video, time, util.join(cfg.output, rec.files.thumb))

  // meta
  util.write(util.join(cfg.output, rec.files.meta), JSON.stringify(rec, null, 2))

  if (await test(video)) throw Error(ERROR.BROKEN)

  return video
}

function ending (time, diff, style, out) {
  let dir = util.join(this.cfg.endings, style)
  let subs = util.read(util.join(dir, this.cfg.subs), 'utf-8')

  let pad = this.cfg.padding / (200 / 3)

  let t = x => new Date(x * 1000).toISOString().slice(11, -2)

  let primary = util.formatTime(time * 1000)
  let secondary = diff !== null ? util.formatTime(diff * 1000, Math.abs(diff) < 0.001 ? 4 : 3) : ''
  if (secondary) {
    if (diff > 0) secondary = '+' + secondary
    else if (secondary[0] !== '-') secondary = '-' + secondary
  } else {
    subs = subs.replace(/^.*?(?:%SECON%|%DARY%|%SECONDARY%).*?(?:\n|$)/gm, '')
  }

  let [pri, mary] = primary.split('.')
  let [secon, dary] = secondary.split('.')

  subs = subs
    .replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => t(pad + time + (Number(b) || 0)))
    .replaceAll('%PRIMARY%', primary).replaceAll('%PRI%', pri).replaceAll('%MARY%', mary)
    .replaceAll('%SECONDARY%', secondary).replaceAll('%SECON%', secon).replaceAll('%DARY%', dary)

  let files = {
    subs: util.join(out, 'ending-' + this.cfg.subs),
    sfx: util.join(dir, this.cfg.sfx)
  }

  util.write(files.subs, subs)

  return files
}

function splits (splits, style, out) {
  let dir = util.join(this.cfg.splits, style)
  let subs = util.read(util.join(dir, this.cfg.subs), 'utf-8').replaceAll('\r\n', '\n')

  let template = (subs.match(/^Dialogue:.*/gm) || []).join('\n')

  let pad = this.cfg.padding / (200 / 3)
  let t = x => new Date(x * 1000).toISOString().slice(11, -2)

  let points = []

  for (let i = 0; i < splits.length; i++) {
    let split = splits[i]
    let name = split.zone.type[0].toUpperCase() + split.zone.type.slice(1) + ' ' + split.zone.index
    let time = util.fixTickDuration(split.time.duration)
    let diff = util.fixTickDuration(split.time.diff)

    let primary = util.formatTime(time * 1000)
    let secondary = util.formatTime(diff * 1000, Math.abs(diff) < 0.001 ? 4 : 3) || ''
    if (secondary && diff >= 0) secondary = '+' + secondary

    let [pri, mary] = primary.split('.')
    let [secon, dary] = secondary.split('.')

    if (!secondary) subs = subs.replace(/^.*?(?:%SECON%|%DARY%|%SECONDARY%).*?(?:\n|$)/gm, '')

    let next = splits[i + 1]
    if (next) next = next.time.duration - split.time.duration

    points.push(
      template.replace(/%TIME(?:\[(.*?)\])?%/g, (_, b) => {
        let dur = Number(b) || 0
        if (next && dur > next) dur = next
        return t(pad + time + dur)
      })
        .replaceAll('%LAYER%', i + 1)
        .replaceAll('%NAME%', name)
        .replaceAll('%PRIMARY%', primary).replaceAll('%PRI%', pri).replaceAll('%MARY%', mary)
        .replaceAll('%SECONDARY%', secondary).replaceAll('%SECON%', secon).replaceAll('%DARY%', dary)
    )
  }

  subs = subs.replace(template, points.join('\n'))

  let dest = util.join(out, 'splits-' + this.cfg.subs)

  util.write(dest, subs)

  return dest
}

function merge (source, target) {
  let o = {
    s: util.read(source, 'utf-8').replaceAll('\r\n', '\n'),
    t: util.read(target, 'utf-8').replaceAll('\r\n', '\n')
  }

  for (let part in o) {
    let styles = (o[part].match(/^Style: (.*?),/gm) || []).map(x => x.slice(7, -1))
    for (let style of styles) {
      let regex = new RegExp(`(?<=(,| ))${style},`, 'g')
      o[part] = o[part].replace(regex, `${part}-$&`)
    }
  }

  for (let part of ['Style', 'Dialogue']) {
    let regex = new RegExp(`^${part}:.*`, 'gm')

    let pointer = o.s.indexOf('\n', o.s.lastIndexOf(part + ':'))
    if (!o.s.match(regex)) {
      if (part === 'Style') pointer = o.s.indexOf('[V4+ Styles]')
      else if (part === 'Dialogue') pointer = o.s.indexOf('[Events]')

      pointer = o.s.indexOf('\n', o.s.indexOf('\n', pointer) + 1)
    }

    let match = o.t.match(regex)
    if (match) o.s = o.s.slice(0, pointer + 1) + match.join('\n') + o.s.slice(pointer)
  }

  let out = util.join(source, '..', 'merged-subs.ass')

  util.write(out, o.s)
  return out
}

function options (rec, opts = {}) {
  let cmds = ['r_cleardecals']

  let ovr = overrides.filter(x => x.zones?.includes(rec.zone?.id) || x.maps?.includes(rec.map) || x.records?.includes(Number(rec.id)))
  ovr.forEach(obj => obj.override && obj.override.cmd && cmds.push(obj.override.cmd))
  ovr = ovr.reduce((obj, item) => item.override ? Object.assign(obj, item.override) : obj, {})
  ovr.cmd = cmds.join(';')

  opts = util.merge(opts, ovr)

  for (let key in opts.ffmpeg) {
    opts.ffmpeg[key] = util.resolve(opts.ffmpeg[key]).replaceAll('\\', '/')
    // we need to escape colons in filter params but NOT in input params
    if (key[0] !== '!') opts.ffmpeg[key] = opts.ffmpeg[key].replaceAll(':', '\\:')
  }

  return opts
}

async function thumb (file, seconds, path) {
  if (!util.exists(path)) await util.exec(`ffmpeg -ss ${seconds}s -i "${file}" -frames:v 1 -vf "scale=1280x720" -y "${path}"`)
  let thumb = 'data:image/png;base64,' + util.read(path, 'base64')
  if (thumb.length > 2000000) { // use jpg if thumbnail is bigger than 2MB
    let jpg = path.replace('.png', '.jpg')
    thumb = await util.exec(`ffmpeg -i "${path}" -q:v 1 -qmin 1 -y "${jpg}"`)
    thumb = 'data:image/jpeg;base64,' + util.read(jpg, 'base64')
    util.remove(jpg)
  }
  return thumb
}

async function test (file) {
  let res = await util.exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${file}"`)
  return res.stdout.trim() === '1024x1024'
}

module.exports = { thumb, record: main, recordRaw: record }

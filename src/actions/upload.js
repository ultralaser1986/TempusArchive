/* global program, cfg, util, stores, modules, yt, tr */
let MEDAL = '[Upload]'

let RETRY = {
  fail: x => {
    return async (i, r, t) => {
      await yt.updateSession()
      console.log(`[Retry] Failed ${x}, retrying (${i + 1}/${r})... (${t / 1000}s)`)
    }
  },
  del: vid => {
    return async e => {
      console.log('[Retry] Failed too many times! Deleting video...')
      await util.retry(() => yt.deleteVideo(vid), RETRY.fail('deleting video'), e => { throw e })
      throw e
    }
  }
}

program
  .command('upload')
  .description('upload records')
  .argument('[ids...]', 'list of record ids to be uploaded, otherwise checks queue if exists')
  .option('-h, --hidden', 'upload records as hidden', false)
  .option('-k, --keep', 'keep files after upload', false)
  .action(main)

async function main (ids, opts) {
  let queue = false

  if (!ids.length) {
    queue = !!(await modules.queue.take(true))
    if (!queue) return console.info('No items in queue!')
  }

  let i = 0
  let max = ids.length

  while (true) {
    let id = ids[i]

    if (queue) {
      let list = await modules.queue.list()
      if (!list.length) break // break if done with queue list
      id = list[0]
      max = list.length + i
    } else if (i >= ids.length) break // break if done with id list

    id = id.toString()

    let rec = await modules.read(util.join(cfg.output, id), cfg.tmp, { json: true })
    if (!rec) return console.error(`Record ${id} not found on disk!`)

    if (!opts.run) console.log(`${MEDAL} ${i + 1}/${max} ${((i + 1) / max * 100).toFixed(2)}% << (${id}): "${modules.display(rec)}"`)

    if (!opts.hidden && stores.uploads[rec.key]?.[id]) console.log(`Already Uploaded: ${stores.uploads[rec.key][id]}`)
    else {
      util.log('Preparing video upload...')
      let vid = await upload(rec, 'default', opts.hidden)
      util.log(`${MEDAL} (${rec.id}) >> https://youtu.be/${vid}\n`)
    }

    if (queue) await modules.queue.take()

    if (!opts.keep) {
      let { count, bytes } = await modules.sweep(rec)
      if (count) console.log(`Cleaned ${count} file${util.s(count)} (${util.formatBytes(bytes)}) from disk.`)
    }

    i++
  }

  // only clean files if we executed this file with specific ids or run mode is enabled
  if (!queue || opts.run) util.remove(cfg.tmp)
}

async function upload (rec, captionStyle = 'default', hidden = false) {
  await yt.updateSession()

  let override = stores.uploads[rec.key]
  if (override) {
    override = Object.values(override).at(-1) // assuming the last key is the latest record
    if (override[0] === '#') override = override.slice(1)
  }
  if (hidden) override = null

  // upload video as draft
  let vid = await util.retry(() => yt.uploadVideo(util.join(rec.dir, rec.files.video), {
    title: String(rec.id),
    draftState: { isDraft: true }
  }, progress => {
    util.log(`Uploading video... ${(progress * 100).toFixed(2)}%`)
  }), RETRY.fail('uploading video'), e => { throw e })

  // set playlist
  let pl = !hidden ? cfg.playlist[rec.zone.type] || null : null

  // set tags
  let tags = [...cfg.meta.tags, `ta${rec.id}`, rec.map.split('_', 2).join('_'), rec.zone.type[0] + rec.zone.index]

  // set data tags
  if (!hidden) {
    tags.push(`v:${cfg.unlisted.includes(rec.zone.type) ? 'UNLISTED' : 'PUBLIC'}`)
    if (override) tags.push(`o:${override}`)
    if (pl) tags.push(`pl:${pl}`)
  }

  tags.push('rid:' + rec.id)
  tags.push('zid:' + rec.zone.id)
  tags.push('did:' + rec.demo.id)
  tags.push('tfc:' + rec.class)
  tags.push('ts:' + rec.time.start)
  tags.push('te:' + rec.time.end)
  tags.push('td:' + rec.time.duration)

  // load thumbnail
  util.log('Loading thumbnail...')
  let thumbnail = await util.retry(() => modules.thumb(null, null, util.join(rec.dir, rec.files.thumb)), RETRY.fail('making thumbnail'), RETRY.del(vid))

  // update video metadata
  util.log('Updating video metadata...')
  await util.retry(() => yt.updateVideo(vid, {
    draftState: { operation: 'MDE_DRAFT_STATE_UPDATE_OPERATION_REMOVE_DRAFT_STATE' },
    privacyState: { newPrivacy: hidden ? 'UNLISTED' : 'PRIVATE' },
    title: { newTitle: (hidden ? cfg.prefix.hidden : cfg.prefix.pending) + ' ' + title(rec) },
    description: { newDescription: desc(rec, override) },
    category: { newCategoryId: cfg.meta.category },
    tags: { newTags: tags },
    videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: thumbnail } },
    gameTitle: { newKgEntityId: cfg.meta.game }
  }), RETRY.fail('updating metadata'), RETRY.del(vid))

  // add captions to video
  let velo = util.join(rec.dir, rec.files.velo)

  if (util.exists(velo)) {
    // captions over 13min~ wont have styling
    // captions over 1h50min~ break, so we half their fps
    // captions over 3h40min~ turned completely off
    if (rec.time.duration <= cfg.caption_limit_max) {
      util.log('Generating captions...')
      await util.retry(() => yt.addCaptions(vid, [
        captions(velo, rec, 0, 'Run Timer', captionStyle),
        captions(velo, rec, 1, 'Speedo (Horizontal)', captionStyle),
        captions(velo, rec, 2, 'Speedo (Vertical)', captionStyle),
        captions(velo, rec, 3, 'Speedo (Absolute)', captionStyle),
        captions(velo, rec, 4, 'Tick of Demo', captionStyle)
      ]), RETRY.fail('adding captions'), RETRY.del(vid))
    }
  }

  // update uploads.list
  if (!hidden) {
    util.log('Adding to database...')
    stores.uploads.add(rec.key, rec.id, '#' + vid)
    await stores.uploads.export(cfg.uploads)
  }

  return vid
}

function title (rec) {
  return modules.display(rec)
}

function desc (rec, override) {
  let tier = null
  if (rec.zone.type !== 'trick') tier = rec.tier.number

  return [
    `https://tempus2.xyz/records/${rec.id}/${rec.zone.id}`,
    override ? `Previous Record: https://youtu.be/${override}` : '',
    '',
    (tier !== null && tier !== undefined) ? `Tier: ${tier} (${rec.tier.name})` : null,
    `Map: https://tempus2.xyz/maps/${rec.map}`,
    `Demo: https://tempus2.xyz/demos/${rec.demo.id}`,
    `Player: https://steamcommunity.com/profiles/${util.formatSteamProfile(rec.player.steam)}`,
    `Date: ${new Date(rec.date * 1000).toUTCString()}`,
    '',
    'Play On Tempus Here: https://tempus2.xyz',
    'Tempus Network Discord: https://discord.gg/5c7eSKUMkf'
  ].filter(x => x !== null).join('\n')
}

function captions (file, rec, method, name, style) {
  let lines = util.read(file, 'utf-8').split(/\r?\n/)
  let caps = util.read(util.join(cfg.captions, style, cfg.caps), 'utf-8')

  let template = caps.match(/<p .*<\/p>/)[0]

  let parts = []

  let range = [rec.time.start - cfg.padding, rec.time.end + cfg.padding]

  let ms = x => ((x - range[0]) / (200 / 3)) * 1000

  let act = {
    0: (tick) => {
      let t = tick - rec.time.start
      if (tick > rec.time.end) t = rec.time.end - rec.time.start
      return util.formatTime((t / (200 / 3)) * 1000, 2)
    },
    1: (tick, x, y, z) => {
      let vel = Math.sqrt(x * x + y * y) + 0.5
      return vel > 3500 ? 3500 : Math.floor(vel)
    },
    2: (tick, x, y, z) => {
      let vel = Math.abs(z) + 0.5
      return vel > 3500 ? 3500 : Math.floor(vel)
    },
    3: (tick, x, y, z) => {
      let vel = Math.sqrt(x * x + y * y + z * z) + 0.5
      return Math.floor(vel)
    },
    4: (tick) => {
      return tick
    }
  }

  let styled = false // lines.length <= cfg.caption_limit_style
  // yt does not support styled subtitles anymore

  let reduced = rec.time.duration > cfg.caption_limit_reduced

  for (let i = 0; i < lines.length; i++) {
    let [tick, x, y, z] = lines[i].split(' ').map(Number)

    if (tick < range[0] || tick > range[1]) continue

    let start = ms(tick)
    let n = lines[i + (reduced ? 2 : 1)]
    let next = n ? ms(Number(n.split(' ')[0])) : null

    let [a, b, c] = [Math.floor(start), next ? Math.ceil(next - start) : 100, act[method](tick, x, y, z)]

    if (!styled) parts.push({ startTimeMs: a, durationMs: b, text: c.toString() })
    else parts.push(template.replace('%START%', a).replace('%TIME%', b).replace('%TEXT%', c))

    if (reduced) i++
  }

  let res = { name, lang: 'en' }
  if (styled) res.buffer = Buffer.from(caps.replace(template, parts.join('\n')))
  else res.segments = parts

  return res
}

module.exports = { upload: main }

program
  .command('fixcaptions')
  .action(async () => {
    let filter = { privacyIs: { value: 'VIDEO_PRIVACY_PUBLIC' } }
    let mask = { tags: { all: true } }

    let items = []
    let next = null

    do {
      let res = await yt.listVideos(null, { filter, mask }, next)
      next = res.next
      util.log(`Fetching Videos: +${res.items.length}\n`)
      for (let item of res.items) {
        item.tags = item.tags.map(x => x.value)
        if (!item.tags.find(x => x.startsWith('rid:'))) {
          let id = item.tags.find(x => x.startsWith('ta'))
          if (!id) {
            util.log(`[TA_ID NOT FOUND] (${item.videoId}) ${item.title}\n`)
            continue
          }
          item.tags.splice(item.tags.indexOf(id), 1)
          id = id.slice(2)
          let rec = null
          try {
            rec = await modules.fetch(id, { minimal: true })
          } catch(e) {
            util.log(`[RECORD NOT FOUND] (${item.videoId}) ${item.title}\n`)
            continue
          }
         
          item.tags.push('rid:' + rec.id)
          item.tags.push('zid:' + rec.zone.id)
          item.tags.push('did:' + rec.demo.id)
          item.tags.push('tfc:' + rec.class)
          item.tags.push('ts:' + rec.time.start)
          item.tags.push('te:' + rec.time.end)
          item.tags.push('td:' + rec.time.duration)

          console.log(modules.display(rec))
          let mp4 = await modules.recordRaw(rec)
          let velo = mp4.replace('.mp4', '.velo')

          let captionStyle = 'default'

          util.log('Generating captions...')
          await util.retry(() => yt.addCaptions(item.videoId, [
            captions(velo, rec, 0, 'Run Timer', captionStyle),
            captions(velo, rec, 1, 'Speedo (Horizontal)', captionStyle),
            captions(velo, rec, 2, 'Speedo (Vertical)', captionStyle),
            captions(velo, rec, 3, 'Speedo (Absolute)', captionStyle),
            captions(velo, rec, 4, 'Tick of Demo', captionStyle)
          ]), RETRY.fail('adding captions'), e => { throw e })

          util.log('Updating video metadata...')
          await util.retry(() => yt.updateVideo(item.videoId, {
            tags: { newTags: item.tags }
          }), RETRY.fail('updating metadata'), e => { throw e })

          util.log('Deleting recording files...')
          util.remove([mp4.replace('.mp4', '.json'), mp4.replace('.mp4', '.png'), velo, mp4])

          util.log('Done!\n')
        } else {
          util.log(`Already applied on (${item.videoId}) ${item.title}\n`)
        }
      }
      items.push(res.items.map(x => x.videoId))
    } while (next)

    if (tr.app) await tr.exit()
  })

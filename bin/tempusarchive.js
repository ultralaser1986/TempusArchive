#!/usr/bin/env node
process.chdir(require('path').dirname(__dirname))

let util = require('../src/util')

let TempusArchive = require('../src')
let ta = new TempusArchive('../data/config.json')

let { program } = require('commander')

let MEDAL = '[TempusArchive]'
let MEDAL_OPEN = '╔════════╗'
let MEDAL_CLOSE = '╚════════╝'

let start = Date.now()

let once = false
let KILLERS = ['error', 'exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'unhandledRejection']
KILLERS.forEach(killer => process.on(killer, e => {
  try {
    if (!once) {
      once = true

      console.log(`\n[TIMELOG] Start: ${start}, End: ${Date.now()}, Elapsed: ${util.formatTime(Date.now() - start, 0)}`)

      util.remove(ta.tmp)

      if (ta.tr.app) {
        ta.tr.app.send('quit')
        ta.tr.app.exit()
      }

      ta.exit(true)
    }
  } catch (e) {}
  if (['uncaughtException', 'unhandledRejection'].includes(killer)) console.error(e)
  if (killer !== 'exit') process.exit()
}))

let re = {
  fail: x => {
    return async (i, r, t) => {
      await ta.yt.updateSession()
      if (ta.cfg.DEBUG) console.log(`[DEBUGLOG] Failed ${x}, retrying (${i + 1}/${r})... (${t / 1000}s)`)
    }
  },
  del: async (e, vid) => {
    if (ta.cfg.DEBUG) console.log('[DEBUGLOG] Failed too many times! Deleting video...')

    await util.retry(() => ta.yt.deleteVideo(vid), re.fail('deleting video'), e => { throw e })
    throw e
  }
}

program
  .command('run')
  .description('start rendering')
  .argument('[ids...]', 'list of specific record ids to be rendered, otherwise renders all pending ones')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-nt, --ntime <seconds>', 'limit amount of records rendered by seconds', 0)
  .option('-ns, --nsize <bytes>', 'limit amount of records rendered by bytes', 0)
  .option('-s, --shuffle', 'randomize the order of the records', false)
  .option('-l, --no-upload', 'skip uploading and don\'t delete output files', true)
  .option('-k, --keep', 'don\'t delete output files', false)
  .option('-u, --unlisted', 'upload records unlisted without adding to database', false)
  .option('-c, --continue', 'continue from previous state if exists', false)
  .action((ids, opts) => run(ids, opts))

program
  .command('check')
  .option('-k, --keep', 'don\'t delete output files', false)
  .description('check and process videos that are ready')
  .action(async opts => {
    let filter = { privacyIs: { value: 'VIDEO_PRIVACY_PRIVATE' } }
    let mask = { videoResolutions: { all: true }, tags: { all: true } }

    let items = []
    let next = null

    do {
      let res = await ta.yt.listVideos(null, { filter, mask }, next)

      let vids = res.items.filter(x => x.videoResolutions?.statusSd === 'RESOLUTION_STATUS_DONE' && x.title.startsWith(ta.cfg.prefix.pending))
      items.push(...vids)
      util.log(`Fetching videos... ${items.length}`)

      next = res.next
    } while (next)

    util.log(`Fetched ${items.length} videos!\n`)

    items = items.reverse() // important, avoids having to check overrides recursively

    for (let i = 0; i < items.length; i++) {
      let item = items[i]

      // TODO: check for corruption here

      let vid = item.videoId

      util.log(`[${i + 1}/${items.length} ] Checking ${vid}`)

      let tags = item.tags.map(x => x.value)

      let take = pre => {
        let r = tags.findIndex(x => x.startsWith(pre + ':'))
        return r !== -1 ? tags.splice(r, 1)[0].slice(pre.length + 1) : null
      }

      let visibility = take('v')
      if (!visibility) throw Error(`Video '${vid}' with unknown visibility!`)
      let override = take('o')
      let playlist = take('pl')

      let title = item.title.replace(/^(. )?/, '')

      if (ta.cfg.DEBUG) console.log(`[DEBUGLOG] Updating metadata of video... (${vid})`)
      await util.retry(() => ta.yt.updateVideo(vid, {
        title: { newTitle: title },
        tags: { newTags: tags },
        privacyState: { newPrivacy: visibility },
        addToPlaylist: { addToPlaylistIds: [playlist] }
      }), re.fail('updating metadata'), e => { throw e }) // can also re.del(e, vid) here but for now we just throw error

      if (override) {
        if (ta.cfg.DEBUG) console.log(`[DEBUGLOG] Updating metadata of old video... (${override})`)

        await util.retry(() => ta.yt.updateVideo(override, {
          privacyState: { newPrivacy: 'UNLISTED' },
          addToPlaylist: { deleteFromPlaylistIds: [playlist] }
        }), re.fail(`updating metadata of old record (${override})`), e => { throw e })
      }

      if (!opts.keep) {
        util.remove([
          util.join(ta.cfg.output, vid + '.mp4'),
          util.join(ta.cfg.output, vid + '.velo'),
          util.join(ta.cfg.output, vid + '.png')
        ])
      }
    }
    util.log(`[${items.length}/${items.length}] Done!\n`)
  })

program
  .command('update')
  .description('update databases')
  .argument('[types...]', 'database types to update (players/records/uploads)')
  .option('-f, --full', 'full update')
  .option('-v, --verbose', 'display wiped and skipped video ids')
  .action((types, opts) => {
    if (!types.length) types = ['players', 'records', 'uploads']

    types = types.reduce((obj, item) => {
      obj[item] = true
      return obj
    }, {})

    ta.update(types, opts.full, opts.verbose)
  })

program
  .command('cleanup')
  .description('delete leftover temporary files')
  .option('-f, --full', 'delete output folder as well')
  .action(opts => {
    util.remove([ta.cfg.state, ta.cfg.bulk, ta.cfg.report])
    if (opts.full) {
      util.remove(ta.cfg.output)
      util.mkdir(ta.cfg.output)
    }
  })

program
  .command('cubemaps')
  .description('build cubemaps for specific map')
  .argument('<map>', 'map name to build cubemaps for')
  .argument('[hdr level]', 'set hdr level', 0)
  .action(async (map, hdr) => {
    ta.tr.cfg.General.game_cmds += `; mat_hdr_level ${isNaN(hdr) ? 0 : hdr}; mat_specular 0; map "${map}"`
    ta.tr.cfg.General.game_args += ' -buildcubemaps -nosound'

    await ta.launch()

    console.log(MEDAL, `Building cubemaps for ${map}...`)
  })

program
  .command('keys')
  .description('check if keys.json is valid')
  .action(async () => {
    console.log(await ta.yt.updateSession())
  })

program
  .command('wipe')
  .description('unlist a youtube video and mark it as wiped')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(ta.cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(ta.cfg.bulk))
    }

    let ans = await util.question(`Are you sure you want to [wipe] ${ids.length} videos? y/n `)
    if (ans !== 'y') return

    await ta.yt.updateSession()

    let res = await ta.yt.listVideos(ids)

    for (let item of res.items) {
      let vid = item.videoId
      let title = item.title.replace(/^(. )?/, ta.cfg.prefix.wiped + ' ')

      let pls = Object.values(ta.cfg.playlist)
      pls = pls.splice(pls.indexOf(ta.cfg.playlist.wiped), 1)

      await util.retry(() => ta.yt.updateVideo(vid, {
        privacyState: { newPrivacy: 'UNLISTED' },
        addToPlaylist: { deleteFromPlaylistIds: pls, addToPlaylistIds: [ta.cfg.playlist.wiped] },
        title: { newTitle: title }
      }), re.fail('wiping video'), e => { throw e })

      for (let zone in ta.uploads) {
        for (let id in ta.uploads[zone]) {
          if (vid === ta.uploads[zone][id]) {
            delete ta.uploads[zone][id]
            if (!Object.keys(ta.uploads[zone]).length) delete ta.uploads[zone]
            ta.uploads.export()
            break
          }
        }
      }

      console.log(`Wiped: ${title} (${vid})`)
    }
  })

program
  .command('info')
  .description('view info about a youtube video')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(ta.cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(ta.cfg.bulk))
    }

    let res = await ta.yt.listVideos(ids)

    for (let item of res.items) console.log(`${item.title} (${item.videoId})`)
  })

program
  .command('delete')
  .description('delete youtube videos')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(ta.cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(ta.cfg.bulk))
    }

    let ans = await util.question(`Are you sure you want to [delete] ${ids.length} videos? y/n `)
    if (ans !== 'y') return

    await ta.yt.updateSession()

    let res = await ta.yt.listVideos(ids)

    for (let item of res.items) {
      let vid = item.videoId

      await util.retry(async () => {
        await ta.yt.updateVideo(vid, {
          addToPlaylist: { deleteFromPlaylistIds: Object.values(ta.cfg.playlist) }
        })

        await ta.yt.deleteVideo(vid)
      }, re.fail('deleting video'), e => { throw e })

      for (let zone in ta.uploads) {
        for (let id in ta.uploads[zone]) {
          if (vid === ta.uploads[zone][id]) {
            delete ta.uploads[zone][id]
            if (!Object.keys(ta.uploads[zone]).length) delete ta.uploads[zone]
            ta.uploads.export()
            break
          }
        }
      }

      console.log(`Deleted: ${item.title} (${vid})`)
    }
  })

program
  .command('bulk')
  .description('search for multiple videos and save to file')
  .argument('<value>', 'value to match in title or desc')
  .action(async (value) => {
    await ta.yt.updateSession()

    let filter = {
      or: {
        operands: [
          { descriptionPrefixed: { value } },
          { titlePrefixed: { value } }
        ]
      }
    }

    let items = []

    let loopVids = async next => {
      let res = await ta.yt.listVideos(null, { filter }, next)

      items.push(...res.items.map(x => x.videoId))
      util.log(`Fetching videos... ${items.length}`)

      if (res.next) await loopVids(res.next)
    }
    await loopVids()

    util.write(ta.cfg.bulk, JSON.stringify(items))
    util.log(`Fetched ${items.length} videos. Saved in '${ta.cfg.bulk}'`)
  })

program
  .command('reportfix')
  .description('fix issues in the report.json file')
  .action(async () => {
    if (!util.exists(ta.cfg.report)) return util.log('No report.json found!')
    let report = JSON.parse(util.read(ta.cfg.report, 'utf-8'))

    // fix privacy
    for (let privacy in report.privacy) {
      let items = report.privacy[privacy]
      for (let i = 0; i < items.length; i++) {
        util.log(`[reportfix] Set privacy to ${privacy} - ${i + 1}/${items.length} (${items[i]})`)

        await util.retry(() => ta.yt.updateVideo(items[i], {
          privacyState: { newPrivacy: privacy.toUpperCase() }
        }), re.fail('updating privacy'), e => { throw e })
      }
      util.log(`[reportfix] Changed ${items.length} videos to ${privacy}!\n`)
    }

    // fix desc chains
    if (report.update) {
      let items = Object.keys(report.update)
      if (items.length) {
        let res = await ta.yt.listVideos(items)
        for (let i = 0; i < res.items.length; i++) {
          let item = res.items[i]
          let rep = report.update[item.videoId]

          util.log(`[reportfix] Updating desc chain ${i + 1}/${res.items.length} (${item.videoId})`)

          let desc = item.description

          if (rep === '') {
            desc = desc.replace(/.*https:\/\/youtu\.be\/.*/, '')
          } else {
            desc = desc.replace(/(https:\/\/youtu\.be\/).*/, `$1${rep}`)
            if (desc === item.description) {
              desc = desc.replace(/(?<=\n)/, `Previous Record: https://youtu.be/${rep}`)
            }
          }

          await util.retry(() => ta.yt.updateVideo(item.videoId, {
            description: { newDescription: desc }
          }), re.fail('updating desc chain'), e => { throw e })
        }
        util.log(`[reportfix] Updated ${res.items.length} desc chains!\n`)
      }
    }

    util.remove(ta.cfg.report)
  })

program
  .name('tempusarchive')
  .parse()

async function run (ids, opts) {
  if (opts.continue) {
    console.log(MEDAL, 'Continuing from previous state...')
    if (!util.exists(ta.cfg.state)) {
      console.log(MEDAL, 'Could not continue. State file does not exist.')
      return
    } else {
      let state = JSON.parse(util.read(ta.cfg.state))
      ids = state.ids
      opts = state.opts
    }
  }

  for (let list of ['records', 'uploads', 'players']) {
    if (!util.exists(ta.cfg[list])) {
      console.log(MEDAL, `Missing ${list} file! Updating...`)
      await ta.update({ [list]: true }, true)
    }
  }

  if (!opts.continue) {
    if (!ids.length && Date.now() - util.date(ta.cfg.records) >= ta.cfg.record_update_wait) {
      console.log(MEDAL, 'Records file is older than a day!')
    }

    if (!ids.length) ids = ta.pending().sort()
    if (opts.shuffle) util.shuffleArray(ids)
    if (Number(opts.max) && ids.length > opts.max) ids.length = opts.max
  }

  let start = opts.index ?? 0
  let time = opts.time ?? 0
  let size = opts.size ?? 0

  console.log(MEDAL, `Queued ${ids.length - start} record${ids.length === 1 ? '' : 's'} for render.`)

  let status = 'PUBLIC'
  if (!opts.upload) status = 'DISABLED'
  else if (opts.unlisted) status = 'UNLISTED'
  console.log(MEDAL, `Upload Mode: ${status}`)

  // await ta.launch()

  for (let i = start; i < ids.length; i++) {
    if (time && Number(opts.ntime) && time > opts.ntime) {
      console.log(MEDAL, `ntime limit reached (${time.toFixed(1)}s > ${opts.ntime.toFixed(1)}s)! Quitting...`)
      break
    }

    if (size && Number(opts.nsize) && size > opts.nsize) {
      console.log(MEDAL, `nsize limit reached (${size}B > ${opts.nsize}B)! Quitting...`)
      break
    }

    util.write(ta.cfg.state, JSON.stringify({ ids, opts: { ...opts, index: i, time, size } }))

    let id = ids[i]

    let rec = await ta.fetch(id).catch(e => {
      if (e.toString().indexOf('not found!') >= 0) return null
      throw e
    })

    if (!rec) {
      console.log(MEDAL, `Record ${id} not found! Skipping...`)
      continue
    }

    id = rec.id // incase we load a json file

    console.log(MEDAL_OPEN, `${i + 1}/${ids.length} ${((i + 1) / ids.length * 100).toFixed(2)}% >> (${rec.id}): "${rec.display}"`)

    if (!opts.unlisted && opts.upload && ta.uploads[rec.key]?.[id]) {
      console.log(MEDAL_CLOSE, `Already Uploaded: ${ta.uploads[rec.key][id]}`)
      continue
    }

    rec.file = util.join(ta.cfg.output, id + '.mp4')
    rec.velo = util.join(ta.cfg.output, id + '.velo')
    rec.thumb = util.join(ta.cfg.output, id + '.png') // created in upload step

    if (util.exists(rec.file) && util.exists(rec.velo)) {
      console.log(MEDAL, `Using existing file: "${rec.file}"`)
    } else {
      try {
        if (!ta.tr.app) await ta.launch()
        rec.file = await ta.record(rec, 'default', 'default')
      } catch (e) {
        console.log('\n')
        console.log(MEDAL_CLOSE, 'Error during record! Aborting process...')
        throw e
      }

      if (rec.file === null) {
        console.log(MEDAL_CLOSE, 'Skipping record.')
        continue
      }
    }

    time += rec.time
    size += util.size(rec.file, true)

    let res = await util.exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${rec.file}"`)
    if (res.stdout.trim() === '1024x1024') {
      console.log(MEDAL_CLOSE, 'Error! Video output is corrupted.')
      await ta.exit(true)
      return
    }

    if (opts.upload) {
      try {
        util.log(`${MEDAL_CLOSE} Uploading...`)
        let vid = await ta.upload(rec, rec.file, progress => {
          util.log(`${MEDAL_CLOSE} Uploading... ${(progress * 100).toFixed(2)}%`)
        }, opts.unlisted)
        util.log(`${MEDAL_CLOSE} https://youtu.be/${vid} <${util.size(rec.file)}>\n`)
        if (opts.keep) console.log(MEDAL_CLOSE, `Output: "${rec.file}"`)
        else util.remove([rec.file, rec.velo, rec.thumb])
      } catch (e) {
        console.log('\n')
        if (e.toString().indexOf('UPLOAD_STATUS_REASON_RATE_LIMIT_EXCEEDED') >= 0) {
          await ta.exit(true)
          console.log(MEDAL_CLOSE, 'Upload limit hit! Waiting 12h...')
          await new Promise(resolve => setTimeout(resolve, 43200000))
          return
        } else {
          console.log(MEDAL_CLOSE, 'Error during upload! Aborting process...')
          throw e
        }
      }
    } else console.log(MEDAL_CLOSE, `Output: "${rec.file}"`)
  }

  util.remove(ta.cfg.state)

  await ta.exit()
}

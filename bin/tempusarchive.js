#!/usr/bin/env node
process.chdir(require('path').dirname(__dirname))

let util = require('../src/util')

let TempusArchive = require('../src')
let ta = new TempusArchive('../data/config.json')

let { program } = require('commander')

let MEDAL = '[TempusArchive]'
let MEDAL_OPEN = '╔════════╗'
let MEDAL_CLOSE = '╚════════╝'

program
  .command('run')
  .description('start rendering')
  .argument('[ids...]', 'list of specific record ids to be rendered, otherwise renders all pending ones')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-s, --shuffle', 'randomize the order of the records', false)
  .option('-k, --no-upload', 'skip uploading and don\'t delete output files', true)
  .option('-w, --no-update', 'skip updating of records file and display a warning if file is older than a day', true)
  .option('-u, --unlisted', 'upload records unlisted without adding to database', false)
  .option('-c, --continue', 'continue from previous state if exists', false)
  .action((ids, opts) => run(ids, opts))

program
  .command('update')
  .description('update databases')
  .argument('[types...]', 'database types to update (players/records/uploads)')
  .action(types => {
    if (!types.length) types = ['players', 'records', 'uploads']

    types = types.reduce((obj, item) => {
      obj[item] = true
      return obj
    }, {})

    ta.update(types)
  })

program
  .command('cleanup')
  .description('delete leftover temporary files')
  .action(() => {
    ta.tr.init()
    util.remove([ta.cfg.state, ta.cfg.report, ta.cfg.velo])
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
  .command('check')
  .description('check if keys.json is valid')
  .action(async () => {
    ta.tr.init()
    console.log(await ta.yt.updateSession())
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
      await ta.update({ [list]: true })
    }
  }

  if (!opts.continue) {
    if (!ids.length && Date.now() - util.date(ta.cfg.records) >= ta.cfg.record_update_wait) {
      if (opts.update) {
        console.log(MEDAL, 'Updating records file...')
        await ta.update({ records: true })
      } else console.log(MEDAL, 'Records file is older than a day!')
    }

    if (!ids.length) ids = ta.pending().sort()
    if (opts.shuffle) util.shuffleArray(ids)
    if (Number(opts.max) && ids.length > opts.max) ids.length = opts.max
  }

  let start = opts.index ?? 0

  console.log(MEDAL, `Queued ${ids.length - start} record${ids.length === 1 ? '' : 's'} for render.`)

  let status = 'PUBLIC'
  if (!opts.upload) status = 'DISABLED'
  else if (opts.unlisted) status = 'UNLISTED'
  console.log(MEDAL, `Upload Mode: ${status}`)

  await ta.launch()

  for (let i = start; i < ids.length; i++) {
    util.write(ta.cfg.state, JSON.stringify({ ids, opts: { ...opts, index: i } }))

    let id = ids[i]

    let rec = await ta.fetch(id)

    console.log(MEDAL_OPEN, `${i + 1}/${ids.length} ${((i + 1) / ids.length * 100).toFixed(2)}% >> (${rec.id}): "${rec.display}"`)

    if (opts.upload && ta.uploads[rec.key]?.[id]) {
      console.log(MEDAL_CLOSE, `Already Uploaded: ${ta.uploads[rec.key][id]}`)
      continue
    }

    let file = null

    try {
      file = await ta.record(rec, 'default', 'default')
    } catch (e) {
      console.log('\n', MEDAL_CLOSE, 'Error during record! Aborting process...')
      console.error(e)
      return
    }

    if (file === null) {
      console.log(MEDAL_CLOSE, 'Skipping record.')
      continue
    }

    if (opts.upload) {
      try {
        util.log(`${MEDAL_CLOSE} Uploading...`)
        let vid = await ta.upload(rec, file, progress => {
          util.log(`${MEDAL_CLOSE} Uploading... ${(progress * 100).toFixed(2)}%`)
        }, opts.unlisted)
        util.log(`${MEDAL_CLOSE} https://youtu.be/${vid} <${util.size(file)}>\n`)
        util.remove(file)
      } catch (e) {
        console.log('\n', MEDAL_CLOSE, 'Error during upload! Aborting process...')
        console.error(e)
        return
      }
    } else console.log(MEDAL_CLOSE, `Output: "${file}"`)
  }

  util.remove(ta.cfg.state)

  await ta.exit()
}

let KILLERS = ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2']
KILLERS.forEach(killer => process.on(killer, () => {
  try {
    util.remove(ta.tmp)
    if (ta.tr.app) ta.exit(true)
    if (killer !== 'exit') process.exit()
  } catch (e) {}
}))

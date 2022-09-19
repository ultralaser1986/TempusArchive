#! /usr/bin/env node
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
  .option('-k, --no-upload', 'skip uploading and don\'t delete output files', true)
  .option('-w, --no-update', 'skip updating of records file and display a warning if file is older than a day', true)
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
  .action(() => ta.tr.init())

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

  if (!ids.length && Date.now() - util.date(ta.cfg.records) >= ta.cfg.record_update_wait) {
    if (opts.update) {
      console.log(MEDAL, 'Updating records file...')
      await ta.update({ records: true })
    } else console.log(MEDAL, 'Records file is older than a day!')
  }

  if (!ids.length) ids = ta.pending()
  if (Number(opts.max) && ids.length > opts.max) ids.length = opts.max

  let start = opts.index ?? 0

  console.log(MEDAL, `Queued ${ids.length - start} record${ids.length === 1 ? '' : 's'} for render.`)
  if (!opts.upload) console.log(MEDAL, 'Uploading disabled.')

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

    let file = await ta.record(rec, 'default')

    if (opts.upload) {
      let vid = await ta.upload(rec, file)
      console.log(MEDAL_CLOSE, `https://youtu.be/${vid} <${util.size(file)}>`)

      util.remove(file)
    } else console.log(MEDAL_CLOSE, `Output: "${file}"`)
  }

  await ta.exit()
}

let KILLERS = ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2']
KILLERS.forEach(killer => process.on(killer, () => {
  try {
    util.remove([ta.tmp, ta.cfg.state])
    if (ta.tr.app) ta.exit(true)
  } catch (e) {}
}))

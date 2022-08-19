#! /usr/bin/env node
process.chdir(require('path').dirname(__dirname))

let util = require('../src/util')

let TempusArchive = require('../src')
let ta = new TempusArchive('../data/config.json')

let { program } = require('commander')

let MEDAL = '[TempusArchive]'

program
  .command('run')
  .description('start rendering')
  .argument('[ids...]', 'list of specific record ids to be rendered, otherwise renders all pending ones')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-k, --no-upload', 'skip uploading and don\'t delete output files', true)
  .option('-w, --no-update', 'skip updating of records file and display a warning if file is older than a day', true)
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
  if (Date.now() - util.date(ta.cfg.records) >= ta.cfg.record_update_wait) {
    if (opts.update) {
      console.log(MEDAL, 'Updating records file...')
      await ta.update({ records: true })
    } else console.log(MEDAL, 'Records file is older than a day!')
  }

  if (!ids.length) ids = ta.pending()
  if (Number(opts.max) && ids.length > opts.max) ids.length = opts.max

  console.log(MEDAL, `Queued ${ids.length} record${ids.length === 1 ? '' : 's'} for render.`)
  if (!opts.upload) console.log(MEDAL, 'Uploading disabled.')

  await ta.launch()

  for (let i = 0; i < ids.length; i++) {
    let id = ids[i]

    let rec = await ta.fetch(id)

    console.log(MEDAL, `${i + 1}/${ids.length} ${((i + 1) / ids.length * 100).toFixed(2)}% >> (${rec.id}): "${rec.display}"`)

    let file = await ta.record(rec)

    if (opts.upload) {
      if (ta.uploads[rec.key]?.[id]) {
        console.log(MEDAL, 'Already Uploaded:', ta.uploads[rec.key][id])
        continue
      }

      let vid = await ta.upload(rec, file)
      console.log(MEDAL, `https://youtu.be/${vid} <${util.size(file)}>`)

      util.remove(file)
    } else console.log(MEDAL, `Output: "${file}"`)
  }

  await ta.exit()
}

let KILLERS = ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2']
KILLERS.forEach(killer => process.on(killer, () => {
  try {
    util.remove(ta.tmp)
    if (ta.tr.app) ta.exit(true)
  } catch (e) {}
}))

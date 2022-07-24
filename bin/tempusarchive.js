#! /usr/bin/env node
let util = require('../src/util')

let TempusArchive = require('../src')
let ta = new TempusArchive('../data/config.json')

let { program } = require('commander')

program
  .command('run')
  .description('start rendering')
  .argument('[ids...]', 'list of specific record ids to be rendered, otherwise renders all pending ones')
  .action(ids => run(ids, program.opts()))

program
  .command('update')
  .description('update database')
  .action(() => ta.update())

program
  .name('tempusarchive')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-k, --no-upload', 'skip uploading and don\'t delete output files')
  .parse()

async function run (ids, opts) {
  if (!ids.length) ids = ta.pending()
  if (!isNaN(opts.max) && ids.length > opts.max) ids.length = opts.max

  console.log(`[TempusArchive] Queued ${ids.length} record${ids.length === 1 ? '' : 's'} for render.`)
  if (!opts.upload) console.log('[TempusArchive] Uploading disabled.')

  await ta.launch()

  for (let i = 0; i < ids.length; i++) {
    let id = ids[i]

    console.log(`[TempusArchive] Progress: ${i + 1}/${ids.length} ${((i + 1) / ids.length * 100).toFixed(2)}%`)

    let rec = await ta.fetch(id)

    console.log(id, '<<', rec.display)

    let file = util.join(ta.out, rec.id + '.mp4')
    if (!util.exists(file)) file = await ta.record(rec)

    if (opts.upload) {
      if (ta.uploads[rec.key]?.[id]) {
        console.log(id, '>>', 'Already Uploaded:', ta.uploads[rec.key][id])
        continue
      }

      let vid = await ta.upload(rec, file)
      console.log(id, '>>', `[${util.size(file)}] https://youtu.be/${vid}`)

      util.remove(file)
    } else console.log(id, '>>', file)
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

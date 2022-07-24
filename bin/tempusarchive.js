#! /usr/bin/env node
process.chdir(require('path').dirname(__dirname))

let util = require('../src/util')

let TempusArchive = require('../src')
let ta = new TempusArchive('data/config.ini')

let { program } = require('commander')

program
  .name('tempusarchive')
  .argument('[ids...]', 'List of specific record ids to be rendered, otherwise renders all pending ones')
  .option('-n, --max <number>', 'Limit number of records to render', 0)
  .option('-k, --no-upload', 'Skip uploading and don\'t delete output files')
  .parse()

async function main (ids, opts) {
  if (!ids.length) ids = ta.pending()
  if (opts.max && ids.length > opts.max) ids.length = opts.max

  await ta.launch()

  for (let id of ids) {
    let rec = await ta.fetch(id)

    console.log(id, '<<', rec.display)

    let file = util.join(this.out, rec.id + '.mp4')
    if (!util.exists(file)) file = await ta.record(rec)

    if (opts.upload) {
      if (ta.uploads[rec.key]?.[id]) {
        console.log(id, '>>', 'Already Uploaded:', ta.uploads[rec.key][id])
        continue
      }

      let vid = await ta.upload(rec, file)
      util.remove(file)

      console.log(id, '>>', `[${util.size(file)}] https://youtu.be/${vid}`)
    } else console.log(id, '>>', file)
  }

  await ta.exit()
}

main(program.args, program.opts())

let KILLERS = ['exit', 'SIGINT', 'SIGUSR1', 'SIGUSR2']
KILLERS.forEach(killer => process.on(killer, () => {
  try {
    util.remove(ta.tmp)
    if (ta.tr.app) ta.exit(true)
  } catch (e) {}
}))

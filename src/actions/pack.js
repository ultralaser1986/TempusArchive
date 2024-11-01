/* global program, cfg, util, modules */

let EXT = 'rec'

program
  .command('pack')
  .description('pack record file')
  .argument('id', 'record id')
  .action(async id => {
    let rec = await modules.fetch(id, { local: true }).catch(e => { return { error: e } })
    if (rec.error) {
      if (rec.error.code === 'ENOENT') return console.error(`File "${rec.error.path}" does not exist!`)
      return console.error(rec.error.message)
    }

    for (let file in rec.files) {
      let path = util.join(cfg.output, rec.files[file])
      if (!util.exists(path)) return console.error(`File "${path}" does not exist!`)
    }

    let files = Object.values(rec.files).map(x => util.join(cfg.output, x))
    let out = util.join(cfg.output, rec.id.toString())

    let res = await pack(files, out, { delete: true })
    console.log(`Record packed to: ${res}`)
  })

program
  .command('unpack')
  .description('unpack record file')
  .argument('id', 'record id')
  .action(async id => {
    let pack = util.join(cfg.output, id + '.' + EXT)
    if (!util.exists(pack)) return console.error(`File "${pack}" does not exist!`)

    await unpack(pack, cfg.output, { delete: true })
    console.log(`Record unpacked to: ${util.resolve(cfg.output)}\\${id}.*`)
  })

async function pack (files, pack, opts = {}) {
  pack = util.resolve(pack)
  if (util.basename(pack).indexOf('.') === -1) pack += '.' + (opts.ext || EXT)

  await util.exec(`tar -c -f "${pack}" ${files.map(x => util.basename(x)).join(' ')}`, { cwd: util.resolve(util.dirname(files[0])) })
  if (opts.delete) util.remove(files)
  return pack
}

async function unpack (pack, out, opts = {}) {
  if (out) util.mkdir(out)

  pack = util.resolve(pack)
  if (util.basename(pack).indexOf('.') === -1) pack += '.' + (opts.ext || EXT)

  let { stdout } = await util.exec(`tar -xf "${pack}" && tar -tf "${pack}"`, { cwd: util.resolve(out) })
  if (opts.delete) util.remove(pack)

  return stdout.split(/\r?\n/).filter(x => x).map(x => util.join(out, x))
}

async function read (file, out, opts = {}) {
  if (opts.json) file = file.replace(/(?=\.[^.]+$).*/, '') + '.json'

  let pack = file.replace(/(?=\.[^.]+$).*/, '') + '.' + (opts.ext || EXT)

  if (util.exists(pack)) {
    if (opts.check) return true
    let files = await unpack(pack, out)
    file = files.find(x => util.basename(x) === util.basename(file))
  } else out = util.join(file, '..').replaceAll('\\', '/')

  if (util.exists(file)) {
    if (opts.check) return true
    file = util.read(file)
    return opts.json ? { ...JSON.parse(file), dir: out } : file
  }

  return opts.check ? false : null
}

module.exports = { pack, unpack, read, packEXT: EXT }

/* global program, cfg, util, tr, modules */

program
  .command('clean')
  .description('clean up leftover data')
  .option('-f, --full', 'delete output and log files too')
  .action(async ({ full }) => {
    if (!tr.initialized) await tr.init()
    clean(full)
  })

function clean (full) {
  util.remove([cfg.tmp, cfg.state, cfg.velo, cfg.bulk, cfg.report, tr.game?.tmp])
  if (full) {
    try { util.remove(tr.game?.tmpRoot) } catch (e) {} // can fail cuz of console.log still open
    util.remove([cfg.output, cfg.queue])
    util.mkdir(cfg.output)
  }
}

function sweep (rec) {
  let files = [
    ...Object.values(rec.files).map(x => util.join(cfg.output, x)),
    ...Object.values(rec.files).map(x => util.join(rec.dir, x)),
    util.join(cfg.output, rec.id + '.' + modules.packEXT)
  ].filter(x => util.exists(x))

  let bytes = files.reduce((a, b) => a + util.size(b, true), 0)

  util.remove(files)

  return { count: files.length, bytes }
}

module.exports = { clean, sweep }

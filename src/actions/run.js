/* global program, modules */

program
  .command('run')
  .description('record and upload records')
  .argument('[ids...]', 'list of record ids to be rendered, otherwise renders all remaining ones')
  .option('-n, --max <number>', 'limit number of records to render', 0)
  .option('-nt, --ntime <seconds>', 'limit amount of records rendered by seconds', 0)
  .option('-ns, --nsize <bytes>', 'limit amount of records rendered by bytes', 0)
  .option('-p, --pack', 'pack output files', false)
  .option('-h, --hidden', 'upload records as hidden', false)
  .option('-k, --keep', 'keep files after upload', false)
  .option('-c, --continue', 'continue from previous state if exists', false)
  .action(async (ids, opts) => {
    await modules.record(ids, { ...opts, run: true })
  })

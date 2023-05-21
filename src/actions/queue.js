/* global program, util, cfg */

let RETRY = {
  fail: x => {
    return async (i, r, t) => {
      console.log(`[Retry] Failed ${x}, retrying (${i + 1}/${r})... (${t / 1000}s)`)
    }
  }
}

program
  .command('queue')
  .description('view items in queue')
  .action(async () => {
    let items = queue.list()
    if (!items.length) return console.log('No items in queue!')

    for (let i = 0; i < items.length; i++) console.log(i, items[i])
  })

let queue = {
  async add (data) {
    if (!util.exists(cfg.queue)) await this.update('')

    let list = await this.list()
    let index = list.push(data)

    await this.update(list.join('\n'))

    return index
  },
  async take (readOnly) {
    if (!util.exists(cfg.queue)) return null

    let list = await this.list()
    let data = list.shift()

    if (!readOnly) await this.update(list.join('\n'))

    return data
  },
  async list () {
    if (!util.exists(cfg.queue)) return []
    return await util.retry(() => util.read(cfg.queue, 'utf-8').split(/\r?\n/), RETRY.fail('reading queue'))
  },
  async update (data) {
    return await util.retry(() => util.write(cfg.queue, data), RETRY.fail('updating queue'))
  }
}

module.exports = { queue }

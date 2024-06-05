#!/usr/bin/env node
process.chdir(require('path').dirname(__dirname))

let { program } = require('commander')

let TemRec = require('temrec')
let YouTube = require('./lib/YouTube')
let ListStore = require('./lib/ListStore')
ListStore.setValueSwaps([undefined, true], ['X', false])

let util = require('./util')

let cfg = require('../data/config.json')

let overrides = require(util.join('..', cfg.overrides))

let yt = new YouTube(cfg.youtube)
let tr = new TemRec(cfg.temrec, true)
tr.tmp = cfg.tmp

let stores = {
  players: new ListStore(cfg.players),
  records: new ListStore(cfg.records),
  uploads: new ListStore(cfg.uploads)
}

util.globals({ ListStore, program, util, cfg, overrides, yt, tr, stores })

let modules = []
let act = util.resolve('src/actions')
util.read(act).forEach(a => {
  let mod = require(util.join(act, a))
  if (mod) modules = { ...modules, ...mod }
})
util.globals({ modules })

program
  .name('tempusarchive')
  .parse()

for (let killer of ['SIGINT', 'SIGTERM', 'SIGQUIT']) process.on(killer, () => exit().then(() => process.exit(1)))
async function exit () {
  if (tr.app) await tr.exit()
  util.remove([cfg.tmp, tr.game?.tmpRoot])
}

/* global program, cfg, util, stores */
let tempus = require('../tempus')

program
  .command('fetch')
  .description('fetch record data')
  .argument('id', 'record id or .json file')
  .option('-m, --minimal', 'dont fetch extra data')
  .option('-s, --save', 'save to output folder')
  .action(async (id, { minimal, save }) => {
    let rec = await fetch(id, !!minimal)
    if (!rec) return console.log(`Record ${id} not found!`)

    if (save) {
      let out = util.join(cfg.output, rec.id + '.json')
      util.write(out, JSON.stringify(rec, null, 2))
      console.log(`Record data saved in '${util.join(cfg.output, rec.id + '.json')}'`)
    } else {
      delete rec.files
      console.log(display(rec), rec)
    }
  })

async function fetch (id, opts = { minimal: false, local: false }) {
  id = id.toString()
  let rec = null

  if (opts.local || id.endsWith('.json')) {
    if (!id.endsWith('.json')) id = util.join(cfg.output, id + '.json')
    rec = JSON.parse(util.read(id))
  } else {
    rec = await tempus.getRecordOverview(id)
    if (!rec) throw Error('Record not found!')

    if (!opts.minimal) {
      rec.diff = await tempus.getDiffFromRecord(rec)

      if (rec.record_info.rank === 1 && rec.zone_info.type === 'map') {
        let wrs = await tempus.getMapWRS(rec.map_info.name)
        rec.splits = Object.values(wrs).find(x => x && x.wr.id === rec.record_info.id)?.wr?.splits
        if (rec.splits) rec.splits = rec.splits.filter(x => x.duration !== null)
        if (!rec.splits?.length) rec.splits = null
      }
    }

    let nick = stores.players[rec.player_info.steamid]
    if (nick) rec.nick = Object.keys(nick)[0]

    rec = format(rec)

    rec.key = `${rec.class}_${rec.zone.id}`
  }

  return util.removeEmpty(rec)
}

function format (rec) {
  return {
    id: rec.record_info.id,
    date: rec.record_info.date,
    rank: rec.record_info.rank,
    class: tempus.formatClass(rec.record_info.class),
    map: rec.map_info.name,
    tier: {
      number: rec.tier_info[rec.record_info.class],
      name: tempus.formatTier(rec.tier_info[rec.record_info.class])
    },
    zone: {
      id: rec.record_info.zone_id,
      type: rec.zone_info.type,
      index: rec.zone_info.zoneindex,
      custom: rec.zone_info.custom_name
    },
    player: {
      nick: rec.nick,
      name: rec.player_info.name,
      steam: rec.player_info.steamid
    },
    time: {
      start: rec.record_info.demo_start_tick,
      end: Math.floor(rec.record_info.demo_start_tick + (rec.record_info.duration * (200 / 3))),
      duration: rec.record_info.duration,
      diff: rec.diff
    },
    demo: {
      id: rec.demo_info.id,
      url: rec.demo_info.url
    },
    splits: rec.splits?.map(x => {
      return {
        zone: {
          type: x.type,
          index: x.zoneindex,
          custom: x.custom_name
        },
        time: {
          duration: x.duration,
          diff: x.duration - x.compared_duration
        }
      }
    }),
    files: {
      video: rec.record_info.id + '.mp4',
      velo: rec.record_info.id + '.velo',
      thumb: rec.record_info.id + '.png',
      meta: rec.record_info.id + '.json'
    }
  }
}

function display (rec) {
  let type = rec.zone.type
  if (type === 'map') type = ''
  else type = `${type[0].toUpperCase()}${type.slice(1)} ${rec.zone.index}`
  let custom = rec.zone.custom

  let title = `[${rec.class}] ${rec.player.nick || rec.player.name} on ${rec.map} ${type}`.trim()
  if (custom) title += ` (${util.maxLen(custom, 30)})`
  title += ` - ${util.formatTime(rec.time.duration * 1000)}`

  return title
}

module.exports = { fetch, format, display }

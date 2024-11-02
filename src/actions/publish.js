/* global program, cfg, util, modules, yt, stores */

let RETRY = {
  fail: x => {
    return async (i, r, t) => {
      await yt.updateSession()
      console.log(`[Retry] Failed ${x}, retrying (${i + 1}/${r})... (${t / 1000}s)`)
    }
  },
  del: vid => {
    return async e => {
      console.log('[Retry] Failed too many times! Deleting video...')
      await util.retry(() => yt.deleteVideo(vid), RETRY.fail('deleting video'), e => { throw e })
      throw e
    }
  }
}

program
  .command('pending')
  .description('view pending uploads yet to be uploaded')
  .action(async () => {
    let pen = await pending()
    for (let i = 0; i < pen.length; i++) {
      let vid = pen[i]
      console.log(`${i + 1}/${pen.length} ${vid.title}`)
    }
  })

program
  .command('publish')
  .option('-k, --keep', 'keep files after publish', false)
  .description('check and publish videos that are ready')
  .action(async opts => {
    let items = await pending()

    items = items.reverse() // important, avoids having to check overrides recursively

    for (let i = 0; i < items.length; i++) {
      let item = items[i]

      // TODO: check for corruption here

      let vid = item.videoId

      console.log(`[${i + 1}/${items.length}] Publishing ${vid}...`)

      let tags = item.tags.map(x => x.value)

      let take = pre => {
        let r = tags.findIndex(x => x.startsWith(pre + ':'))
        return r !== -1 ? tags.splice(r, 1)[0].slice(pre.length + 1) : null
      }

      let visibility = take('v')
      if (!visibility) throw Error(`Video '${vid}' with unknown visibility!`)
      let override = take('o')
      let playlist = take('pl')

      let title = item.title.replace(/^(. )?/, '')

      console.log(`Updating metadata of record... (${vid})`)
      await util.retry(() => yt.updateVideo(vid, {
        title: { newTitle: title },
        tags: { newTags: tags },
        privacyState: { newPrivacy: visibility },
        addToPlaylist: { addToPlaylistIds: [playlist] }
      }), RETRY.fail('updating metadata of record'), e => { throw e }) // can also RETRY.del(vid) here but for now we just throw error

      if (override) {
        console.log(`Updating metadata of previous record... (${override})`)
        await util.retry(() => yt.updateVideo(override, {
          privacyState: { newPrivacy: 'UNLISTED' },
          addToPlaylist: { deleteFromPlaylistIds: [playlist] }
        }), RETRY.fail(`updating metadata of previous record (${override})`), e => { throw e })
      }

      let tfclass = item.title.match(new RegExp(`^\\${cfg.prefix.pending} \\[(\\w)]`))
      let [, record, zone] = item.description.match(/records\/(\d+)\/(\d+)/)
      let key = `${tfclass[1]}_${zone}`

      stores.uploads.add(key, record, vid) // remove pending tag
      await stores.uploads.export()

      if (!opts.keep) {
        let rec = await modules.read(util.join(cfg.output, record), cfg.tmp, { json: true })
        if (rec) {
          let { count, bytes } = await modules.sweep(rec)
          if (count) console.log(`Cleaned ${count} file${util.s(count)} (${util.formatBytes(bytes)}) from disk.`)
        }
      }
    }
  })

program
  .command('reportfix')
  .description('fix issues in the report.json file')
  .action(async () => {
    if (!util.exists(cfg.report)) return console.log('No report.json found!')

    let report = JSON.parse(util.read(cfg.report, 'utf-8'))

    // fix nicks
    if (report.nicks) {
      let items = Object.keys(report.nicks)
      if (items.length) {
        let res = await yt.listVideos(items)
        for (let i = 0; i < res.items.length; i++) {
          let item = res.items[i]
          let rep = report.nicks[item.videoId]

          util.log(`[reportfix] Updating nicks ${i + 1}/${res.items.length} (${item.videoId})`)

          let title = item.title

          console.log('\n' + title)
          title = title.replace(rep[0], rep[1])
          console.log(title)

          await util.retry(() => yt.updateVideo(item.videoId, {
            title: { newTitle: title }
          }), RETRY.fail('updating nick'), e => { throw e })
        }
        util.log(`[reportfix] Updated ${res.items.length} nicks!\n`)
      }
    }

    // fix privacy
    for (let privacy in report.privacy) {
      let items = report.privacy[privacy]
      for (let i = 0; i < items.length; i++) {
        util.log(`[reportfix] Set privacy to ${privacy} - ${i + 1}/${items.length} (${items[i]})`)

        await util.retry(() => yt.updateVideo(items[i], {
          privacyState: { newPrivacy: privacy.toUpperCase() }
        }), RETRY.fail('updating privacy'), e => { throw e })
      }
      util.log(`[reportfix] Changed ${items.length} videos to ${privacy}!\n`)
    }

    // fix desc chains
    if (report.update) {
      let items = Object.keys(report.update)
      if (items.length) {
        let res = await yt.listVideos(items)
        for (let i = 0; i < res.items.length; i++) {
          let item = res.items[i]
          let rep = report.update[item.videoId]

          util.log(`[reportfix] Updating desc chain ${i + 1}/${res.items.length} (${item.videoId})`)

          let desc = item.description

          if (rep === '') {
            desc = desc.replace(/.*https:\/\/youtu\.be\/.*/, '')
          } else {
            desc = desc.replace(/(https:\/\/youtu\.be\/).*/, `$1${rep}`)
            if (desc === item.description) {
              desc = desc.replace(/(?<=\n)/, `Previous Record: https://youtu.be/${rep}`)
            }
          }

          await util.retry(() => yt.updateVideo(item.videoId, {
            description: { newDescription: desc }
          }), RETRY.fail('updating desc chain'), e => { throw e })
        }
        util.log(`[reportfix] Updated ${res.items.length} desc chains!\n`)
      }
    }

    util.remove(cfg.report)
  })

async function pending () {
  let filter = { privacyIs: { value: 'VIDEO_PRIVACY_PRIVATE' } }
  let mask = { videoResolutions: { all: true }, tags: { all: true } }

  let items = []
  let next = null

  do {
    let res = await yt.listVideos(null, { filter, mask }, next)

    let vids = res.items.filter(x => x.videoResolutions?.statusSd === 'RESOLUTION_STATUS_DONE' && x.title.startsWith(cfg.prefix.pending))
    items.push(...vids)
    util.log(`Fetching videos... ${items.length}`)

    next = res.next
  } while (next)

  util.log(`Fetched ${items.length} videos!\n`)

  return items
}

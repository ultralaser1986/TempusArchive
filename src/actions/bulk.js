/* global program, cfg, yt, stores, util */
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
  .command('keys')
  .description('check if keys.json is valid')
  .action(async () => {
    console.log(await yt.updateSession())
  })

program
  .command('wipe')
  .description('unlist a youtube video and mark it as wiped')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(cfg.bulk))
    }

    let ans = await util.question(`Are you sure you want to [wipe] ${ids.length} videos? y/n `)
    if (ans !== 'y') return

    await yt.updateSession()

    let res = await yt.listVideos(ids)

    for (let item of res.items) {
      let vid = item.videoId
      let title = item.title.replace(/^(. )?/, cfg.prefix.wiped + ' ')

      let pls = Object.values(cfg.playlist)
      pls = pls.splice(pls.indexOf(cfg.playlist.wiped), 1)

      await util.retry(() => yt.updateVideo(vid, {
        privacyState: { newPrivacy: 'UNLISTED' },
        addToPlaylist: { deleteFromPlaylistIds: pls, addToPlaylistIds: [cfg.playlist.wiped] },
        title: { newTitle: title }
      }), RETRY.fail('wiping video'), e => { throw e })

      for (let zone in stores.uploads) {
        for (let id in stores.uploads[zone]) {
          if (vid === stores.uploads[zone][id]) {
            delete stores.uploads[zone][id]
            if (!Object.keys(stores.uploads[zone]).length) delete stores.uploads[zone]
            stores.uploads.export()
            break
          }
        }
      }

      console.log(`Wiped: ${title} (${vid})`)
    }
  })

program
  .command('info')
  .description('view info about a youtube video')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(cfg.bulk))
    }

    let res = await yt.listVideos(ids)

    for (let item of res.items) console.log(`${item.title} (${item.videoId})`)
  })

program
  .command('delete')
  .description('delete youtube videos')
  .argument('<video ids...>', 'youtube video ids')
  .action(async (ids) => {
    if (ids[0] === 'bulk') {
      if (!util.exists(cfg.bulk)) return util.log('No bulk.json found!')
      ids = JSON.parse(util.read(cfg.bulk))
    }

    let ans = await util.question(`Are you sure you want to [delete] ${ids.length} videos? y/n `)
    if (ans !== 'y') return

    await yt.updateSession()

    let res = await yt.listVideos(ids)

    for (let item of res.items) {
      let vid = item.videoId

      await util.retry(async () => {
        await yt.updateVideo(vid, {
          addToPlaylist: { deleteFromPlaylistIds: Object.values(cfg.playlist) }
        })

        await yt.deleteVideo(vid)
      }, RETRY.fail('deleting video'), e => { throw e })

      for (let zone in stores.uploads) {
        for (let id in stores.uploads[zone]) {
          if (vid === stores.uploads[zone][id]) {
            delete stores.uploads[zone][id]
            if (!Object.keys(stores.uploads[zone]).length) delete stores.uploads[zone]
            stores.uploads.export()
            break
          }
        }
      }

      console.log(`Deleted: ${item.title} (${vid})`)
    }
  })

program
  .command('bulk')
  .description('search for multiple videos and save to file')
  .argument('<value>', 'value to match in title or desc')
  .action(async (value) => {
    await yt.updateSession()

    let filter = {
      or: {
        operands: [
          { descriptionPrefixed: { value } },
          { titlePrefixed: { value } }
        ]
      }
    }

    let items = []
    let next = null

    do {
      let res = await yt.listVideos(null, { filter }, next)
      next = res.next

      items.push(...res.items.map(x => x.videoId))
      util.log(`Fetching videos... ${items.length}`)
    } while (next)

    util.write(cfg.bulk, JSON.stringify(items))
    util.log(`Fetched ${items.length} videos. Saved in '${cfg.bulk}'\n`)
  })

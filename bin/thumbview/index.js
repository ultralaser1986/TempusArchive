#!/usr/bin/env node
let child = require('child_process')

let ph = require('path')
process.chdir(ph.dirname(ph.join(__dirname, '..')))

let util = require('../../src/util')

let TempusArchive = require('../../src')
let ta = new TempusArchive('../data/config.json')

async function main (max) {
  max = (max && !isNaN(max)) ? Number(max) : 0
  let total = 0
  let thumbs = {}

  let loopVids = async next => {
    let res = await ta.yt.listVideos(null, null, next)

    total += res.items.length
    util.log(`Fetching videos... ${total}`)

    for (let item of res.items) {
      thumbs[item.videoId] = item.thumbnailEditorState.stills.at(-1).thumbnails[0].url
    }

    if (max && total >= max) return
    if (res.next) await loopVids(res.next)
  }
  await loopVids()

  let html = util.read(ph.join(__dirname, 'template.html'), 'utf-8')
  html = html.replace('<!--%THUMBS%-->', `<script>window.thumbnails = ${JSON.stringify(thumbs)}</script>`)

  let out = ph.join(__dirname, 'thumbview.html')
  util.write(out, html)

  util.log(`Done! Fetched ${total} videos.`)

  child.exec(`explorer.exe "${out}"`)
}

main(process.argv[2])

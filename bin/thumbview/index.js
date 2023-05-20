#!/usr/bin/env node
let child = require('child_process')

let ph = require('path')
process.chdir(ph.dirname(ph.join(__dirname, '..')))

let util = require('../../src/util')
let cfg = require('../../data/config.json')
let YouTube = require('../../src/lib/YouTube')
let yt = new YouTube(cfg.youtube)

async function main (max) {
  max = (max && !isNaN(max)) ? Number(max) : 0
  let total = 0
  let thumbs = {}

  let next = null

  do {
    let res = await yt.listVideos(null, { mask: { thumbnailEditorState: { all: true } } }, next)
    next = res.next

    total += res.items.length
    util.log(`Fetching videos... ${total}`)

    for (let item of res.items) {
      thumbs[item.videoId] = item.thumbnailEditorState.stills.at(-1).thumbnails[0].url
    }

    if (max && total >= max) break
  } while (next)

  let html = util.read(ph.join(__dirname, 'template.html'), 'utf-8')
  html = html.replace('<!--%THUMBS%-->', `<script>window.thumbnails = ${JSON.stringify(thumbs)}</script>`)

  let out = ph.join(__dirname, 'thumbview.html')
  util.write(out, html)

  util.log(`Done! Fetched ${total} videos.`)

  child.exec(`explorer.exe "${out}"`)
}

main(process.argv[2])

let dp = require('despair')
let fs = require('fs')
let ph = require('path')
let crypto = require('crypto')
let risk = require('./risk')

let AZ = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
let INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
let CHUNK_SIZE = 262144 * 20

function genUploadId () {
  let a = Array(36)
  for (let b = 0, c, d = 0; d < a.length; d++) {
    if ([8, 13, 18, 23].some(x => x === d)) a[d] = '-'
    else if (d === 14) a[d] = '4'
    else {
      if (b <= 2) b = 33554432 + 16777216 * Math.random() | 0
      c = b & 15
      b >>= 4
      a[d] = AZ[d === 19 ? (c & 3 | 8) : c]
    }
  }
  return `innertube_studio:${a.join('')}:0`
}

function getSAPSIDHASH (sapisid) {
  let time = Math.floor(Date.now() / 1E3)
  let str = time + ' ' + sapisid + ' ' + 'https://studio.youtube.com'
  return `${time}_${crypto.createHash('sha1').update(str).digest('hex')}`
}

function getVideoInfo (file) {
  file = ph.resolve(file)
  return {
    id: genUploadId(),
    name: ph.basename(file),
    path: file,
    size: fs.statSync(file).size
  }
}

function getSerializedDelegationContext (channel) {
  return Buffer.from([0x12, channel.length, ...Buffer.from(channel), 0x2a, 0x02, 0x08, 0x02]).toString('base64')
}

function YouTube (keyfile) {
  this.file = ph.resolve(keyfile)

  let keys = JSON.parse(fs.readFileSync(this.file))

  this.keys = {
    cookies: `CONSENT=YES+cb;${Object.entries(keys.cookies).map(x => x.join('=')).join(';')};`,
    authorization: `SAPISIDHASH ${getSAPSIDHASH(keys.cookies.SAPISID)}`,
    session: keys.sessionInfo,
    channel: keys.channelId
  }

  this.context = () => {
    return {
      client: { clientName: 62, clientVersion: '1.11111111' },
      request: { sessionInfo: { token: this.keys.session } },
      user: { serializedDelegationContext: getSerializedDelegationContext(this.keys.channel) }
    }
  }
}

YouTube.prototype.updateSession = async function () {
  let check = await this.updateVideo('00000000000').catch(e => e.code === 403)
  if (check === false) {
    let keys = JSON.parse(fs.readFileSync(this.file))
    this.keys.session = keys.sessionInfo = await risk(keys)
    fs.writeFileSync(this.file, JSON.stringify(keys, null, 2))
    return false
  }
  return true
}

YouTube.prototype.uploadVideo = async function (file, meta = {}, progress) {
  if (!fs.existsSync(file)) throw Error('Invalid file path provided')
  let video = getVideoInfo(file)

  video = { ...video, ...meta, ...await this.describeFile(video) }

  let res = await this.createVideo(video)

  let reason = res.contents?.uploadFeedbackItemRenderer?.contents?.[0]?.uploadStatus?.uploadStatusReason
  if (reason) throw Error(reason)

  await this.sendVideoBinary(video, progress)

  return res.videoId
}

YouTube.prototype.updateVideo = async function (vid, data) {
  try {
    let res = await dp.post('https://studio.youtube.com/youtubei/v1/video_manager/metadata_update', {
      query: {
        alt: 'json',
        key: INNERTUBE_KEY
      },
      headers: {
        'x-origin': 'https://studio.youtube.com',
        cookie: this.keys.cookies,
        Authorization: this.keys.authorization
      },
      data: {
        encryptedVideoId: vid,
        context: this.context(),
        failOnError: true,
        ...data
      }
    }).json()
    if (res.overallResult.resultCode !== 'UPDATE_SUCCESS') {
      console.error(res)
      throw Error('Failed to update')
    }
  } catch (e) { throw e.body ? JSON.parse(e.body).error : e }
}

YouTube.prototype.describeFile = async function (video) {
  let { headers } = await dp.post('https://upload.youtube.com/upload/studio', {
    headers: {
      authority: 'upload.youtube.com',
      'x-goog-upload-file-name': video.name,
      'x-goog-upload-header-content-length': video.size,
      'x-goog-upload-command': 'start',
      'x-goog-upload-protocol': 'resumable',
      origin: 'https://studio.youtube.com',
      referer: 'https://studio.youtube.com/',
      cookie: this.keys.cookies
    },
    data: { frontendUploadId: video.id },
    type: 'form'
  })
  return {
    resourceId: headers['x-goog-upload-header-scotty-resource-id'],
    uploadUrl: headers['x-goog-upload-url']
  }
}

YouTube.prototype.createVideo = async function (video) {
  let body = await dp.post('https://studio.youtube.com/youtubei/v1/upload/createvideo', {
    query: {
      alt: 'json',
      key: INNERTUBE_KEY
    },
    headers: {
      'x-origin': 'https://studio.youtube.com',
      cookie: this.keys.cookies,
      Authorization: this.keys.authorization
    },
    data: {
      channelId: this.keys.channel,
      initialMetadata: {
        title: { newTitle: video.title },
        description: { newDescription: video.description },
        privacy: { newPrivacy: video.visibility },
        category: { newCategoryId: video.category },
        draftState: { isDraft: video.draft },
        tags: { newTags: video.tags }
      },
      resourceId: {
        scottyResourceId: {
          id: video.resourceId
        }
      },
      frontendUploadId: video.id,
      context: this.context()
    }
  }).json()
  return body
}

YouTube.prototype.sendVideoBinary = async function (video, progress) {
  let stream = fs.createReadStream(video.path, { highWaterMark: CHUNK_SIZE })
  let n = 0
  let info = fs.statSync(video.path)

  return new Promise((resolve, reject) => {
    stream.on('data', async chunk => {
      let buffer = Buffer.from(chunk)
      let IS_LAST_CHUNK = buffer.byteLength + CHUNK_SIZE * n === info.size
      let OFFSET = CHUNK_SIZE * n

      if (progress) progress((buffer.byteLength + CHUNK_SIZE * n) / info.size)

      try {
        stream.pause()
        await dp.post(video.uploadUrl, {
          headers: {
            origin: 'https://studio.youtube.com',
            'x-goog-upload-command': IS_LAST_CHUNK ? 'upload, finalize' : 'upload',
            'x-goog-upload-offset': OFFSET,
            'x-goog-upload-file-name': encodeURIComponent(video.name),
            cookie: this.keys.cookies
          },
          data: buffer,
          type: 'form'
        })
        n++
        stream.resume()
        if (IS_LAST_CHUNK) resolve()
      } catch (err) { reject(err) }
    })

    stream.on('error', reject)
  })
}

YouTube.prototype.listVideos = async function (vids, opts, next) {
  if (!opts) opts = {}
  if (!vids || !Array.isArray(vids)) vids = []
  let method = vids.length ? 'get' : 'list'
  let body = await dp.post(`https://studio.youtube.com/youtubei/v1/creator/${method}_creator_videos`, {
    query: {
      alt: 'json',
      key: INNERTUBE_KEY
    },
    headers: {
      'x-origin': 'https://studio.youtube.com',
      cookie: this.keys.cookies,
      Authorization: this.keys.authorization
    },
    data: {
      pageSize: 100,
      mask: {
        title: true,
        description: true,
        privacy: true,
        timeCreatedSeconds: true,
        ...opts.mask
      },
      filter: opts.filter,
      videoIds: vids,
      pageToken: next,
      context: this.context()
    },
    type: 'json'
  }).json()
  return {
    next: body.nextPageToken,
    items: body.videos
      ? body.videos.map(x => {
        x.date = Number(x.timeCreatedSeconds)
        delete x.responseStatus
        delete x.loggingDirectives
        delete x.timeCreatedSeconds
        return x
      })
      : []
  }
}

YouTube.prototype.getTranslations = async function (vids) {
  if (!vids || !Array.isArray(vids)) vids = []
  let body = await dp.post('https://studio.youtube.com/youtubei/v1/crowdsourcing/get_video_translations', {
    query: {
      alt: 'json',
      key: INNERTUBE_KEY
    },
    headers: {
      'x-origin': 'https://studio.youtube.com',
      cookie: this.keys.cookies,
      Authorization: this.keys.authorization
    },
    data: {
      videoIds: vids,
      context: this.context()
    },
    type: 'json'
  }).json()
  return body.videoTranslations
}

YouTube.prototype.deleteVideos = async function (ids) {
  if (!Array.isArray(ids)) ids = [ids]
  try {
    await dp.post('https://studio.youtube.com/youtubei/v1/creator/enqueue_creator_bulk_delete', {
      query: {
        alt: 'json',
        key: INNERTUBE_KEY
      },
      headers: {
        'x-origin': 'https://studio.youtube.com',
        cookie: this.keys.cookies,
        Authorization: this.keys.authorization
      },
      data: {
        videos: { videoIds: ids },
        context: this.context()
      }
    })
  } catch (e) {
    if (e.code === 400) return false
    throw Error(e)
  }
  return true
}

YouTube.prototype.deleteVideo = async function (id) {
  try {
    let res = await dp.post('https://studio.youtube.com/youtubei/v1/video/delete', {
      query: {
        alt: 'json',
        key: INNERTUBE_KEY
      },
      headers: {
        'x-origin': 'https://studio.youtube.com',
        cookie: this.keys.cookies,
        Authorization: this.keys.authorization
      },
      data: {
        videoId: id,
        context: this.context()
      }
    }).json()
    return res.success
  } catch (e) {
    throw Error(e)
  }
}

YouTube.prototype.addCaptions = async function (id, captions, together = false) {
  if (!Array.isArray(captions)) captions = [captions]

  let post = async (operations) => {
    let res = await dp.post('https://studio.youtube.com/youtubei/v1/globalization/update_captions', {
      query: {
        alt: 'json',
        key: INNERTUBE_KEY
      },
      headers: {
        'x-origin': 'https://studio.youtube.com',
        cookie: this.keys.cookies,
        Authorization: this.keys.authorization
      },
      data: {
        context: this.context(),
        videoId: id,
        channelId: this.keys.channel,
        operations
      }
    })
    return res.headers.statusCode
  }

  try {
    let ops = []

    for (let cap of captions) {
      let c = {
        ttsTrackId: { lang: cap.lang, name: cap.name },
        isContentEdited: false,
        userIntent: 'USER_INTENT_EDIT_LATEST_DRAFT',
        vote: 'VOTE_PUBLISH'
      }

      if (!cap.buffer) c.captionSegments = { segments: cap.segments }
      else c.captionsFile = { dataUri: 'data:application/octet-stream;base64,' + cap.buffer.toString('base64') }

      if (!together) await post([c])
      else ops.push(c)
    }

    if (together) await post(ops)
  } catch (e) {
    throw Error(e)
  }
}

module.exports = YouTube

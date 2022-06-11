let dp = require('despair')
let fs = require('fs')
let ph = require('path')
let crypto = require('crypto')

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

function YouTube (keyfile) {
  let keys = JSON.parse(fs.readFileSync(ph.resolve(__dirname, keyfile)))

  this.keys = {
    cookies: `CONSENT=YES+cb;${Object.entries(keys.cookies).map(x => x.join('=')).join(';')};`,
    authorization: `SAPISIDHASH ${getSAPSIDHASH(keys.cookies.SAPISID)}`,
    session: keys.sessionInfo
  }
}

YouTube.prototype.uploadVideo = async function (file, meta = {}) {
  if (!fs.existsSync(file)) throw Error('Invalid file path provided')
  let video = getVideoInfo(file)

  video = { ...video, ...meta, ...await this.describeFile(video) }

  let res = await this.createVideo(video)

  let reason = res.contents?.uploadFeedbackItemRenderer?.contents[0]?.uploadStatus?.uploadStatusReason
  if (reason) throw Error(reason)

  await this.sendVideoBinary(video)

  return res.videoId
}

YouTube.prototype.setVideoPrivacy = async function (vid, privacy) {
  try {
    await dp.post('https://studio.youtube.com/youtubei/v1/video_manager/metadata_update', {
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
        privacyState: { newPrivacy: privacy }
      }
    })
  } catch (e) { return false }
  return true
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
      context: {
        client: { clientName: 62, clientVersion: '1.11111111' },
        request: { sessionInfo: { token: this.keys.session } }
      }
    }
  }).json()
  return body
}

YouTube.prototype.sendVideoBinary = async function (video) {
  let stream = fs.createReadStream(video.path, { highWaterMark: CHUNK_SIZE })
  let n = 0
  let info = fs.statSync(video.path)

  return new Promise((resolve, reject) => {
    stream.on('data', async chunk => {
      let buffer = Buffer.from(chunk)
      let IS_LAST_CHUNK = buffer.byteLength + CHUNK_SIZE * n === info.size
      let OFFSET = CHUNK_SIZE * n

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

YouTube.prototype.listVideos = async function (next) {
  let body = await dp.post('https://studio.youtube.com/youtubei/v1/creator/list_creator_videos', {
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
      context: {
        client: { clientName: 62, clientVersion: '1.11111111' }
      },
      mask: {
        title: true,
        description: true,
        privacy: true,
        timeCreatedSeconds: true
      },
      pageToken: next
    },
    type: 'json'
  }).json()
  return {
    next: body.nextPageToken,
    items: body.videos.map(x => {
      x.date = Number(x.timeCreatedSeconds)
      delete x.responseStatus
      delete x.loggingDirectives
      delete x.timeCreatedSeconds
      return x
    })
  }
}

module.exports = YouTube

let fs = require('fs')
let ph = require('path')
let child = require('child_process')
let readline = require('readline')

let STEAM_BASE = 76561197960265728n

module.exports = {
  log (msg) {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    process.stdout.write(msg)
  },
  formatTime (ms, decimals = 3) {
    if (!ms) return null
    let invert = false
    if (ms < 0) {
      invert = true
      ms = Math.abs(ms)
    }
    ms = ms / 1000
    let s = Math.floor(ms % 60)
    let m = Math.floor(ms / 60 % 60)
    let h = Math.floor(ms / 60 / 60)
    if (!h) h = null
    else if (!m) m = '00'
    if (!s) s = '00'
    let t = [h, m, s].filter(x => x !== null).map((x, i, a) => {
      return (i !== 0 && x < 10 && x !== '00') ? '0' + x : x
    })
    ms = ms.toString()
    return (invert ? '-' : '') + t.join(':') + (decimals ? ms.substr(ms.indexOf('.'), decimals + 1) : '')
  },
  maxLen (str, len) {
    if (str.length > len) str = str.slice(0, len - 3).trim() + '...'
    return str
  },
  remove (file) {
    if (!Array.isArray(file)) file = [file]
    for (let f of file) fs.existsSync(f) && fs.rmSync(f, { force: true, recursive: true })
  },
  read (file, encoding) {
    return fs.readFileSync(file, encoding)
  },
  write (file, data) {
    fs.writeFileSync(file, data)
  },
  exec (cmd) {
    return child.execSync(cmd, { stdio: 'pipe' })
  },
  join (...paths) {
    return ph.join(...paths)
  },
  resolve (...paths) {
    return ph.resolve(...paths)
  },
  mkdir (path) {
    if (!this.exists(path)) fs.mkdirSync(path)
  },
  copy (from, to) {
    fs.copyFileSync(from, to)
  },
  formatBytes (bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'

    let k = 1024
    let dm = decimals < 0 ? 0 : decimals
    let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    let i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  },
  size (file) {
    return this.formatBytes(fs.statSync(file).size)
  },
  exists (file) {
    return fs.existsSync(file)
  },
  merge (target, ...sources) {
    if (!sources.length) return target
    let source = sources.shift()

    let isObject = item => (item && typeof item === 'object' && !Array.isArray(item))

    if (isObject(target) && isObject(source)) {
      for (let key in source) {
        if (isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} })
          this.merge(target[key], source[key])
        } else {
          Object.assign(target, { [key]: source[key] })
        }
      }
    }

    return this.merge(target, ...sources)
  },
  date (file) {
    return this.exists(file) ? fs.statSync(file).mtime : 0
  },
  formatSteamID (id) {
    if (id.startsWith('STEAM_')) return id

    let uid = id.match(/\[U:(\d):(\d+)]/)
    if (uid) {
      let num = Number(uid[2])
      let uni = Number(num % 2 !== 0)
      return 'STEAM_0:' + uni + ':' + ((num - uni) / 2)
    }

    if (!isNaN(id)) {
      let uni = BigInt(id % 2 !== 0)
      return 'STEAM_0:' + uni + ':' + ((BigInt(id) - STEAM_BASE + uni) / 2n)
    }

    return null
  },
  formatSteamProfile (id) {
    let str = this.formatSteamID(id)
    let [, uni, num] = str.split(':').map(Number)
    num = (BigInt(num) * 2n) + STEAM_BASE + BigInt(uni)
    return num.toString()
  },
  shuffleArray (array) {
    for (let i = array.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1))
      let temp = array[i]
      array[i] = array[j]
      array[j] = temp
    }
  },
  removeEmpty (x) {
    Object.keys(x).forEach(key => {
      if (x[key] && typeof x[key] === 'object') this.removeEmpty(x[key])
      else if (x[key] === undefined || x[key] === null) delete x[key]
      if (typeof x[key] === 'object' && Object.keys(x[key]).length === 0 && !(x[key] instanceof Date)) delete x[key]
    })
    return x
  }
}

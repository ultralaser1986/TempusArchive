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
    if (!ms) return '0:00' + (decimals ? '.' + '0'.repeat(decimals) : '')

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

    let t = [h, m, s].filter(x => x !== null).map((x, i) => (i !== 0 && x < 10 && x !== '00') ? '0' + x : x)

    let decs = (ms % 1).toString().slice(2) + '0'.repeat(16)

    return (invert ? '-' : '') + t.join(':') + (decimals ? '.' + decs.slice(0, decimals) : '')
  },
  msFromTime (str) {
    let [x = '', m = 0, h = 0] = str.split(':').reverse()
    let ms = x.split('.').join('')
    return (((Number(h) * 60 * 60) + (Number(m) * 60)) * 1000) + Number(ms)
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
    return fs.statSync(file).isDirectory() ? fs.readdirSync(file, encoding) : fs.readFileSync(file, encoding)
  },
  write (file, data) {
    fs.writeFileSync(file, data)
  },
  async exec (cmd, opts = {}) {
    return new Promise(resolve => {
      child.exec(cmd, { stdio: 'pipe', ...opts }, (err, stdout, stderr) => {
        if (err) throw err
        resolve({ stdout, stderr })
      })
    })
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
  dirname (path) {
    return ph.dirname(path)
  },
  basename (path) {
    return ph.basename(path)
  },
  copy (from, to) {
    fs.copyFileSync(from, to)
  },
  rename (from, to) {
    this.copy(from, to)
    this.remove(from)
  },
  formatBytes (bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes'

    let k = 1024
    let dm = decimals < 0 ? 0 : decimals
    let sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    let i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  },
  size (file, raw = false) {
    let s = fs.statSync(file).size
    return raw ? s : this.formatBytes(s)
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
      let uni = (BigInt(id) - STEAM_BASE) % 2n
      return 'STEAM_0:' + uni + ':' + ((BigInt(id) - STEAM_BASE - uni) / 2n)
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
  },
  async question (msg) {
    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    return new Promise(resolve => rl.question(msg, ans => {
      rl.close()
      resolve(ans)
    }))
  },
  async retry (fn, fail, error) {
    let retries = 5
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn()
      } catch (e) {
        if (i === retries) return error ? error(e) : false
        let time = (i + 1) * 10 * 1000
        if (fail) await fail(i, retries, time)
        await new Promise(resolve => setTimeout(resolve, time))
      }
    }
  },
  globals (obj) {
    for (let key in obj) {
      global[key] = obj[key]
    }
  },
  s: n => {
    return n === 1 ? '' : 's'
  },
  fixTickDuration (duration) {
    if (duration < 0) return -this.fixTickDuration(-duration)
    if (Math.abs(Math.round(duration * 200 / 3) * 3 / 200 - duration) <= duration * 2 ** -19) {
      duration = Math.round(duration * 200 / 3) * 3 / 200
    }
    return duration + 1e-9 // to avoid printing .999999
  },
  createOrderedObject () {
    let order = []
    let values = Object.create(null)

    return new Proxy(values, {
      set (target, prop, value) {
        if (!(prop in target))order.push(prop)
        target[prop] = value
        return true
      },
      ownKeys () { return order },
      getOwnPropertyDescriptor (target, prop) {
        return {
          enumerable: true,
          configurable: true,
          writable: true,
          value: target[prop]
        }
      }
    })
  }
}

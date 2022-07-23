let fs = require('fs')
let ph = require('path')
let child = require('child_process')

module.exports = {
  formatTime (ms, decimals = 3) {
    if (!ms) return null
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
    return t.join(':') + (decimals ? ms.substr(ms.indexOf('.'), decimals + 1) : '')
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
  mkdir (path) {
    fs.mkdirSync(path)
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
  }
}

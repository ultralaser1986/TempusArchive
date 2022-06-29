let fs = require('fs')
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
    for (let f of file) fs.existsSync(f) && fs.unlinkSync(f)
  },
  read (file, encoding) {
    return fs.readFileSync(file, encoding)
  },
  write (file, data) {
    fs.writeFileSync(file, data)
  },
  exec (cmd) {
    return child.execSync(cmd, { stdio: 'pipe' })
  }
}

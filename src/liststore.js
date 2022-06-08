let fs = require('fs')
let ph = require('path')

function ListStore (path) {
  if (path) {
    let file = fs.readFileSync(ph.resolve(__dirname, path), 'utf-8')
    for (let line of file.split(/\r?\n/)) {
      line = line.trim()
      if (line) {
        let parts = line.split(' ')
        this[parts[0]] = parts.slice(1)
      }
    }
  }
}

ListStore.prototype.add = function (key, items) {
  if (!this[key]) this[key] = []
  if (!Array.isArray(items)) items = [items]
  this[key].push(...items.filter(x => x))
}

ListStore.prototype.export = function (path) {
  let out = []
  for (let key in this) out.push(`${key} ${this[key].join(' ')}`)
  fs.writeFileSync(path, out.join('\n'))
}

module.exports = ListStore

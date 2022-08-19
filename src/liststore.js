let fs = require('fs')
let ph = require('path')

function ListStore (path) {
  if (path) {
    Object.defineProperty(this, 'path', {
      value: ph.resolve(path),
      enumerable: false
    })
    let file = fs.readFileSync(this.path, 'utf-8')
    for (let line of file.split(/\r?\n/)) {
      line = line.trim()
      if (line) {
        let parts = line.match(/[^"\s]+|"(?:\\"|[^"])+"/g).map(x => {
          if (x[0] === '"' && x.at(-1) === '"') x = x.slice(1, -1)
          return x
        })
        this.add([parts.shift()], ...parts)
      }
    }
  }
}

ListStore.setValueSwaps = function (...args) {
  this.valueSwap = value => {
    for (let a of args) {
      if (value === a[0]) value = a[1]
      else if (value === a[1]) value = a[0]
    }
    return value
  }
}

Object.defineProperties(ListStore.prototype, {
  add: {
    value: function (key, ...args) {
      let swap = false
      if (Array.isArray(key)) {
        key = key[0]
        swap = true
      }

      key = typeof key === 'string' ? key.replaceAll('\\"', '"') : key
      args = args.map(x => typeof x === 'string' ? x.replaceAll('\\"', '"') : x)

      if (!this[key]) this[key] = {}
      for (let i = 0; i < args.length; i++) {
        let prop = args[i]
        let value = args[++i]
        if (ListStore.valueSwap && swap) value = ListStore.valueSwap(value)
        this[key][prop] = value
      }
    }
  },
  export: {
    value: function (path) {
      if (!path) path = this.path
      let out = []
      for (let key in this) {
        let line = [key]
        for (let prop in this[key]) {
          let value = this[key][prop]
          if (ListStore.valueSwap) value = ListStore.valueSwap(value)
          line.push(prop, value)
        }
        line = line.map(x => x && x.indexOf(' ') > 0 ? `"${x.replaceAll('"', '\\"')}"` : x)
        out.push(line.join(' ').trim())
      }
      fs.writeFileSync(path, out.join('\n'))
    }
  }
})

module.exports = ListStore

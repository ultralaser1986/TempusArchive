let fs = require('fs')
let ph = require('path')

async function git (file, data) {
  if (!ListStore.remote) return null

  let opts = { headers: { Authorization: 'Bearer ' + ListStore.remote.key } }

  if (data) {
    opts.method = 'PUT'
    opts.body = JSON.stringify(data)
  }

  return await fetch(`https://api.github.com/repos/${ListStore.remote.repo}/contents/${file}?ref=${ListStore.remote.branch}`, opts).then(j => j.json())
}

function ListStore () {}

ListStore.setValueSwaps = function (...args) {
  this.valueSwap = value => {
    for (let a of args) {
      if (value === a[0]) value = a[1]
      else if (value === a[1]) value = a[0]
    }
    return value
  }
}

ListStore.setRemote = function (keyfile) {
  this.remote = JSON.parse(fs.readFileSync(ph.resolve(keyfile)))
}

Object.defineProperties(ListStore.prototype, {
  import: {
    value: async function (path) {
      Object.defineProperty(this, 'path', { value: path, enumerable: false })
      let file = null
      if (ListStore.remote) {
        try {
          let data = await git(ph.basename(path))
          file = Buffer.from(data.content, 'base64').toString('utf-8')
        } catch (e) {
          console.error(`Failed retrieving '${ph.basename(path)}'.`)
          return
        }
      } else {
        if (!fs.existsSync(this.path)) return
        file = fs.readFileSync(this.path, 'utf-8')
      }
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
  },
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
    value: async function (path) {
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

      if (ListStore.remote) {
        let list = ph.basename(path)

        let data = await git(list)

        if (Buffer.from(out.join('\n')).toString('utf-8') === Buffer.from(data.content, 'base64').toString('utf-8')) return

        try {
          await git(list, {
            branch: ListStore.remote.branch,
            sha: data.sha,
            message: 'update ' + list,
            committer: ListStore.remote.committer,
            content: Buffer.from(out.join('\n')).toString('base64')
          })
        } catch (e) {
          console.error(`Failed uploading '${list}'. Falling back to local file.`)
          fs.writeFileSync(path, out.join('\n'))
        }
      } else {
        fs.writeFileSync(path, out.join('\n'))
      }
    }
  }
})

module.exports = ListStore

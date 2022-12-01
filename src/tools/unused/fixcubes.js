// fixes broken cubemaps if map changed name. Cubemaps have to be rebuild after probably.
// unused because reflections look terrible in most cases.

let fs = require('fs')
let ph = require('path')
let child = require('child_process')

let BSPZIP = String.raw`C:\Program Files (x86)\Steam\steamapps\common\Team Fortress 2\bin\bspzip.exe`
let TMP = ph.join(__dirname, 'tmp')

async function packMap (map, compress) {
  let app = child.exec(`"${BSPZIP}" -repack ${compress ? '-compress ' : ''}"${map}"`)

  app.stderr.on('data', d => { throw Error(d) })

  await new Promise(resolve => app.on('exit', resolve))
}

async function extractFiles (map, out) {
  let app = child.exec(`"${BSPZIP}" -extractfiles "${map}" "${out}"`)

  let data = ''

  app.stdout.on('data', d => { data += d })
  app.stderr.on('data', d => { throw Error(d) })

  await new Promise(resolve => app.on('exit', resolve))

  let files = data.match(/(?<=Writing file: ).*/g) || []

  return files.map(x => [ph.relative(out, x).replaceAll('\\', '/'), x.replaceAll('\\', '/')])
}

async function updateFiles (map, filelist) {
  let list = ph.join(__dirname, 'list.txt')

  fs.writeFileSync(list, filelist.map(x => x.join('\n')).join('\n'))

  let app = child.exec(`"${BSPZIP}" -addorupdatelist "${map}" "${list}" "${map}"`)

  app.stderr.on('data', d => { throw Error(d) })

  await new Promise(resolve => app.on('exit', resolve))

  fs.unlinkSync(list)
}

async function patchFiles (map, fn) {
  map = ph.resolve(map)

  await packMap(map, false)

  let filelist = await extractFiles(map, TMP)

  fn(filelist)

  await updateFiles(map, filelist)

  // await packMap(map, true)

  fs.rmSync(TMP, { recursive: true })
}

async function fixCubes (map) {
  map = map.replaceAll('\\', '/')

  patchFiles(map, filelist => {
    for (let parts of filelist) {
      let file = parts[1]
      if (!file.endsWith('.vmt')) continue

      // replace every envmap map name with current file name
      let data = fs.readFileSync(file, 'utf-8')
      data = data.replace(/\$envmap.*?\s"(.*?)"/g, (a, cube) => {
        return a.replace(cube, `maps/${map.split('/').pop()}/${cube.split('/').pop()}`)
      })
      fs.writeFileSync(file, data, 'utf-8')
    }
  })
}

module.exports = fixCubes

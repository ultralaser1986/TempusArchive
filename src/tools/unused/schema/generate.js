// generates diff.txt from items_game.txt and items_game_old.txt

let fs = require('fs')
let ph = require('path')

let diff = ph.join(__dirname, 'diff.txt')
let cur = VDFtoJSON(ph.join(__dirname, 'items_game.txt')).items_game.items
let old = VDFtoJSON(ph.join(__dirname, 'items_game_old.txt')).items_game.items

let file = fs.createWriteStream(diff, { flags: 'a' })
fs.truncateSync(diff, 0)

for (let i in old) {
  let [o, c] = [old[i]?.model_player, cur[i]?.model_player]
  if (!o || !c || o === c) continue
  file.write(o + ' ' + c + '\n')
}

file.close()

function VDFtoJSON (input) {
  let lines = fs.readFileSync(input, 'utf-8').split('\n')
  let obj = {}
  let stack = [obj]
  let regex = new RegExp(
    '^("((?:\\\\.|[^\\\\"])+)"|([a-z0-9\\-\\_]+))' +
        '([ \t]*(' +
        '"((?:\\\\.|[^\\\\"])*)(")?' +
        '|([a-z0-9\\-\\_]+)' +
        '))?'
  )
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (line === '' || line[0] === '/') continue
    if (line[0] === '{') continue
    if (line[0] === '}') {
      stack.pop()
      continue
    }
    while (true) {
      let m = regex.exec(line)
      let key = (m[2] !== undefined) ? m[2] : m[3]
      let val = (m[6] !== undefined) ? m[6] : m[8]
      if (val === undefined) {
        if (stack[stack.length - 1][key] === undefined) { stack[stack.length - 1][key] = {} }
        stack.push(stack[stack.length - 1][key])
      } else {
        if (m[7] === undefined && m[8] === undefined) {
          line += '\n' + lines[++i]
          continue
        }
        stack[stack.length - 1][key] = val
      }
      break
    }
  }
  return obj
}

let trackPosition = require('./trackpos')
let detection = require('./detection')

function getBoxTicks (demo, player, boxes, range) {
  boxes = boxes.reduce((prev, cur) => {
    let m = typeof cur === 'string' ? cur.match(/[-.\d]+/g).map(Number) : cur

    let mins = [m[0], m[1], m[2]]
    let maxs = [m[3], m[4], m[5]]

    for (let i = 0; i < 3; i++) {
      if (mins[i] > maxs[i]) {
        let tmp = mins[i]
        mins[i] = maxs[i]
        maxs[i] = tmp
      }
    }

    let o = { mins, maxs, ticks: [] }
    Object.defineProperty(o, 'state', { value: 0, enumerable: false, writable: true })
    prev.push(o)

    return prev
  }, [])

  let last = null

  let prev = null

  trackPosition(demo, player, (tick, pos) => {
    if (range && (range[0] >= tick || tick >= range[1])) return
    pos = [pos.x, pos.y, pos.z]

    if (last) {
      for (let i = 0; i < boxes.length; i++) {
        let hit = detection(boxes[i].mins, boxes[i].maxs, last, pos)
        if (hit) {
          if (boxes[i].state === 0) {
            boxes[i].state = 1
            prev = tick
          }
        } else {
          if (boxes[i].state === 1) {
            boxes[i].state = 0
            boxes[i].ticks.push([prev, tick])
          }
        }
      }
    }

    last = pos
  })

  return boxes
}

module.exports = getBoxTicks

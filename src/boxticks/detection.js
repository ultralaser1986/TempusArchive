function CheckLineBox (mins, maxs, start, end, hit) {
  // check if line intersects sides of box
  for (let i = 0; i < 3; i++) {
    let sect = (
      GetIntersection(start[i] - mins[i], end[i] - mins[i], start, end, hit) ||
      GetIntersection(start[i] - maxs[i], end[i] - maxs[i], start, end, hit)
    )
    if (sect && InBox(sect, mins, maxs, i)) return sect
  }

  // check if line is inside box
  let line = [start, end]
  for (let i = 0; i < 2; i++) {
    if (
      (mins[0] <= line[i][0] && line[i][0] <= maxs[0]) &&
      (mins[1] <= line[i][1] && line[i][1] <= maxs[1]) &&
      (mins[2] <= line[i][2] && line[i][2] <= maxs[2])
    ) {
      return line[i]
    }
  }

  return null
}

function GetIntersection (f1, f2, p1, p2, hit) {
  if ((f1 * f2) >= 0 || f1 === f2) return false
  hit = SubtractVectors(p2, p1)

  hit = ScaleVector(hit, (-f1 / (f2 - f1)))
  hit = AddVectors(p1, hit)

  return hit
}

function InBox (hit, b1, b2, axis) {
  return ((axis === 0 && hit[2] > b1[2] && hit[2] < b2[2] && hit[1] > b1[1] && hit[1] < b2[1]) ||
        (axis === 1 && hit[2] > b1[2] && hit[2] < b2[2] && hit[0] > b1[0] && hit[0] < b2[0]) ||
        (axis === 2 && hit[0] > b1[0] && hit[0] < b2[0] && hit[1] > b1[1] && hit[1] < b2[1]))
}

function SubtractVectors (v1, v2) {
  let out = []
  for (let i = 0; i < 3; i++) out[i] = v1[i] - v2[i]
  return out
}

function AddVectors (v1, v2) {
  let out = []
  for (let i = 0; i < 3; i++) out[i] = v1[i] + v2[i]
  return out
}

function ScaleVector (v1, scale) {
  let out = []
  for (let i = 0; i < 3; i++) out[i] = v1[i] * scale
  return out
}

module.exports = CheckLineBox

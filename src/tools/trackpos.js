let fs = require('fs')
let ph = require('path')
let Demo = require('@demostf/demo.js')

function formatSteamID (id) {
  if (id.startsWith('STEAM_')) return id
  let uid = id.match(/\[U:(\d):(\d+)]/)
  if (uid) {
    let num = Number(uid[2])
    let uni = Number(num % 2 !== 0)
    return 'STEAM_0:' + uni + ':' + ((num - uni) / 2)
  }
}

function trackPosition (demofile, player, callback) {
  player = formatSteamID(player)

  let file = fs.readFileSync(ph.resolve(demofile))

  let demo = Demo.Demo.fromNodeBuffer(file)
  let analyser = demo.getAnalyser()

  let prev = 0
  let start = 0

  for (let packet of analyser.getPackets()) {
    if (!start && packet.packetType === 'netTick') start = packet.tick

    if (packet.packetType === 'packetEntities') {
      for (let entity of packet.entities) {
        if (entity.serverClass.name === 'CTFPlayer') {
          let pos = null
          for (let prop of entity.props) {
            if (prop.definition.name === 'm_vecOrigin') pos = { ...prop.value }
            else if (prop.definition.name === 'm_vecOrigin[2]') pos = { ...pos, z: prop.value }
          }

          if (pos && pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
            let user = analyser.match.getUserInfoForEntity(entity)
            if (formatSteamID(user.steamId) === player && packet.delta) {
              if (!pos.z) pos.z = prev
              else prev = pos.z

              let tick = packet.delta - start

              callback(tick, pos)
            }
          }
        }
      }
    }
  }
}

module.exports = trackPosition

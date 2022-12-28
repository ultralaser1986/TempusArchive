// fixes broken models in pre jungle inferno demos (updated version of laurirasanen/DemoTools).
// unused because this takes too long, so manually execute this script for the few demos we need.

let fs = require('fs')
let ph = require('path')

let BitStream = require('bit-buffer').BitStream
let Transformer = require('@demostf/demo.js/build/Transformer').Transformer

let models = fs.readFileSync(ph.join(__dirname, 'schema/diff.txt'), 'utf-8').split('\n').reduce((prev, cur) => {
  let parts = cur.split(' ')
  prev[parts[0]] = parts[1]
  return prev
}, {})

function fixModels (input, output) {
  let data = fs.readFileSync(input)

  let inStream = new BitStream(data)
  let outStream = new BitStream(Buffer.alloc(data.length * 2))

  let transformer = new Transformer(inStream, outStream)

  transformer.transform(
    message => {
      if (message.table?.name === 'modelprecache') {
        for (let entry of message.table.entries) {
          if (models[entry.text]) entry.text = models[entry.text]
        }
      }
      return message
    },
    packet => { return packet }
  )

  fs.writeFileSync(output, Uint8Array.prototype.slice.call(outStream.buffer, 0, outStream.index / 8 + 1))
}

module.exports = fixModels

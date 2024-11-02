/* global program, stores, util */

let nick = program.command('nick').description('various commands for nicknames')

nick.command('list')
  .description('list all nicks')
  .action(async () => {
    for (let key in stores.players) {
      console.log(key, Object.keys(stores.players[key])[0])
    }
  })

nick.command('set')
  .description('set new nickname for player')
  .argument('id', 'steam id')
  .argument('name', 'nickname')
  .action(async (id, name) => {
    id = util.formatSteamID(id)
    if (!id) return console.log('Invalid steam id provided!')
    if (stores.players[id]?.[name]) return console.log('Nick already set!')

    if (stores.players[id]) stores.players[id] = { [name]: true }
    else stores.players.add(id, name, true)
    console.log(`Added nick: ${name} (${id})`)

    await stores.players.export()
  })

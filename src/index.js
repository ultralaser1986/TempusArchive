let ListStore = require('./liststore')
let YouTube = require('./youtube')
let yt = new YouTube('./data/keys.json')
let tempus = require('./tempus')

ListStore.setValueSwaps([undefined, true], ['X', false])

let records = new ListStore('./data/records.list')
let uploads = new ListStore('./data/uploads.list')

/*
yt.uploadVideo("C:/Users/pear/Desktop/cat.mp4", {
    title: 'Cat Video',
    description: 'Cool cat does cool thing',
    visibility: 'private',
    category: 20,
    draft: false,
    tags: ["cute", "adorable"]
}).then(id => console.log('https://youtu.be/' + id))
*/

let puppeteer = require('puppeteer-extra')
puppeteer.use(require('puppeteer-extra-plugin-stealth')())

async function getSessionRisk (cookies) {
  cookies = Object.entries(cookies).map(x => {
    return { name: x[0], value: x[1], domain: '.youtube.com' }
  })

  let browser = await puppeteer.launch({ headless: true })
  let page = await browser.newPage()

  await page.setCookie(...cookies)

  await page.setRequestInterception(true)

  let res = new Promise(resolve => {
    page.on('request', req => {
      req.continue()
      let data = req.postData()
      if (data) {
        data = JSON.parse(data).context?.request?.sessionInfo?.token
        if (data) resolve(data)
      }
    })
  })

  await page.goto('https://studio.youtube.com/channel/my/editing/details')

  try { await page.waitForSelector('#textbox') } catch (e) {}

  let txt = await page.evaluate(() => {
    let box = document.getElementById('textbox')
    box.focus()
    return box.innerText
  })

  let take = txt.at(-2) === ' '

  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press(take ? 'Backspace' : 'Space')

  await page.evaluate(() => document.getElementById('publish-button').click())

  res = await Promise.resolve(res)

  await browser.close()

  return res
}

module.exports = getSessionRisk

let { Camoufox } = require('camoufox')

async function getSessionRisk (keys) {
  let browser = await Camoufox({ headless: true })
  let context = await browser.newContext()

  let cookies = Object.entries(keys.cookies).map(x => { return { name: x[0], value: x[1], domain: '.youtube.com', path: '/', secure: true, httpOnly: true } })
  await context.addCookies(cookies)

  let page = await context.newPage()

  let token = new Promise(resolve => {
    page.route('**/*', async (route) => {
      let req = route.request()

      let url = req.url()
      let data = req.postData()

      await route.continue()

      if (url.indexOf('/youtubei/v1/channel_edit/update_channel_page_settings') !== -1) {
        try {
          data = JSON.parse(data).context?.request?.sessionInfo?.token
          if (data && data.length > 25) resolve(data)
        } catch (e) { }
      }
    })
  })

  let channelId = keys.channelId || 'my'
  await page.goto(`https://studio.youtube.com/channel/${channelId}/editing/details`, { waitUntil: 'domcontentloaded' })

  await page.waitForSelector('#textbox', { timeout: 10000 })

  let text = await page.locator('#textbox').innerText()
  let take = text.at(-2) === ' '
  await page.locator('#textbox').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press(take ? 'Backspace' : 'Space')
  await page.locator('#publish-button').click()

  let result = await token

  await browser.close()

  return result
}

module.exports = getSessionRisk

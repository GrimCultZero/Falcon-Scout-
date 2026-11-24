// Metro LinkedIn Scraper - register.js
// Runs on linkedin.com/feed (a page the person opened THEMSELVES: this makes no extra visit). Reads who is signed
// in from the left profile card and tells the background, which registers the account with the backend.
// Read only; it clicks nothing and sends nothing to LinkedIn.
(function () {
  function readMe() {
    const main = document.querySelector('main')
    if (!main) return null
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
    const a = [...main.querySelectorAll('a[href*="/in/"]')].filter(vis).find((x) => (x.textContent || '').trim().length > 3)
    if (!a) return null
    const slug = self.__metroParsers.slugFromHref(a.getAttribute('href'))
    const leaf = [...a.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).find((t) => t.length > 2)
    const name = leaf || (a.textContent || '').replace(/\s+/g, ' ').trim().split('  ')[0]
    return slug ? { slug, name } : null
  }
  let tries = 0
  const t = setInterval(() => {
    tries++
    const me = readMe()
    if (me || tries > 12) {
      clearInterval(t)
      if (me) chrome.runtime.sendMessage({ type: 'METRO_ME', slug: me.slug, name: me.name })
    }
  }, 2500)
})()

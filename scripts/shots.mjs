import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const all = args.includes('--all')
const hash = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') === false) ?? args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? ''
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const port = 8799
const sizes = { phone: [390, 844], tablet: [820, 1180], laptop: [1280, 800], wide: [1920, 1080] }
const pages = all
  ? [
      ...['race', 'timing', 'pit', 'strategy', 'weather', 'car', 'review', 'analysis', 'log'].map((w) => `t=builtin-race&w=w-${w}`),
      ...['drive', 'dpit', 'dmap', 'dcar', 'dlaps', 'analysis'].map((w) => `t=builtin-driver&w=w-${w}`),
    ]
  : [hash]

const bridge = spawn(
  'pnpm',
  ['--filter', '@pitwall/bridge', 'start', '--simulate-acc', '--no-browser', '--key', 'shotshotshot1', '--http', `127.0.0.1:${port}`, '--sim-session', opt('session', 'race'), '--sim-track', opt('track', 'demo'), '--sim-speed', opt('speed', '4')],
  { stdio: 'ignore', shell: true },
)
const stop = () => spawn('taskkill', ['/pid', String(bridge.pid), '/t', '/f'], { stdio: 'ignore' })

const audit = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  const name = (e) => (e.closest('.mod')?.querySelector('.mod-title, h2, h3, header')?.textContent ?? '').trim().slice(0, 24)
  const out = { page: document.documentElement.scrollWidth - innerWidth, spill: [], small: [] }
  for (const mod of document.querySelectorAll('.mod')) {
    const m = mod.getBoundingClientRect()
    if (!vis(mod)) continue
    for (const e of mod.querySelectorAll('*')) {
      const r = e.getBoundingClientRect()
      if (r.width && (r.right > m.right + 2 || r.left < m.left - 2) && !e.closest('[data-scroll], .scroll, .t-wrap') && getComputedStyle(e).position !== 'fixed') { out.spill.push(`${name(mod)} <${e.tagName.toLowerCase()}.${String(e.className).slice(0, 20)}>`); break }
    }
    if (mod.scrollWidth > mod.clientWidth + 2) out.spill.push(`${name(mod)} scrolls sideways`)
  }
  if (innerWidth <= 820)
    for (const e of document.querySelectorAll('button, a[href], [role=button], [role=tab], input, select')) {
      const r = e.getBoundingClientRect()
      if (vis(e) && (r.height < 36 || r.width < 36)) out.small.push(`${(e.getAttribute('aria-label') || e.textContent || e.className).toString().trim().slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
  return out
}

try {
  mkdirSync('.shots', { recursive: true })
  const browser = await chromium.launch()
  const errors = new Set()
  for (const h of pages) {
    const tag = h.replace(/t=builtin-|&w=/g, (m) => (m === '&w=' ? '-' : '')) || 'page'
    for (const [name, [width, height]] of Object.entries(sizes)) {
      const touch = width <= 820
      const page = await (await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1 })).newPage()
      if (opt('appearance', '')) await page.addInitScript((j) => { try { localStorage.setItem('pitwall.appearance', j) } catch {} }, JSON.stringify({ base: 'pitwall', ...JSON.parse(opt('appearance', '')) }))
      page.on('pageerror', (e) => errors.add(`${tag} ${name}: ${e.message}`))
      page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/track') && errors.add(`${tag} ${name}: ${r.status()} ${r.url()}`))
      for (let i = 0; i < 30; i++) {
        try { await page.goto(`http://127.0.0.1:${port}/?key=shotshotshot1${h ? '#' + h : ''}`); break } catch { await new Promise((r) => setTimeout(r, 1000)) }
      }
      await page.waitForTimeout(Number(opt('wait', all ? 3500 : 6000)))
      const a = await page.evaluate(audit)
      await page.screenshot({ path: `.shots/${tag}-${name}.png`, fullPage: true })
      const spill = [...new Set(a.spill)]
      const small = [...new Set(a.small)]
      console.log(`${tag.padEnd(16)} ${name.padEnd(6)} overflow ${a.page}px  spill ${spill.length}  small-targets ${small.length}`)
      for (const s of spill.slice(0, 4)) console.log(`    spill: ${s}`)
      for (const s of small.slice(0, 4)) console.log(`    small: ${s}`)
      await page.close()
    }
  }
  await browser.close()
  console.log(errors.size ? `errors:\n${[...errors].join('\n')}` : 'no page errors')
} finally {
  stop()
}

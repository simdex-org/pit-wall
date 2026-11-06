// Usage: pnpm shots [hash] [--session race|quali] [--track demo]
// Starts the simulator, screenshots the page at phone, tablet and desktop widths into .shots/.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const hash = args.find((a) => !a.startsWith('--')) ?? ''
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d)
const port = 8799
const sizes = { phone: [390, 844], tablet: [820, 1180], laptop: [1280, 800], wide: [1920, 1080] }

const bridge = spawn(
  'pnpm',
  ['--filter', '@pitwall/bridge', 'start', '--simulate-acc', '--no-browser', '--key', 'shotshotshot1', '--http', `127.0.0.1:${port}`, '--sim-session', opt('session', 'race'), '--sim-track', opt('track', 'demo'), '--sim-speed', '4'],
  { stdio: 'ignore', shell: true },
)
const stop = () => spawn('taskkill', ['/pid', String(bridge.pid), '/t', '/f'], { stdio: 'ignore' })

try {
  mkdirSync('.shots', { recursive: true })
  const browser = await chromium.launch()
  const errors = []
  for (const [name, [width, height]] of Object.entries(sizes)) {
    const page = await browser.newPage({ viewport: { width, height } })
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
    page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`))
    for (let i = 0; i < 30; i++) {
      try { await page.goto(`http://127.0.0.1:${port}/?key=shotshotshot1${hash ? '#' + hash : ''}`); break } catch { await new Promise((r) => setTimeout(r, 1000)) }
    }
    await page.waitForTimeout(6000)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    await page.screenshot({ path: `.shots/${name}.png`, fullPage: true })
    console.log(`${name} ${width}x${height} horizontal overflow: ${overflow}px`)
    await page.close()
  }
  await browser.close()
  console.log(errors.length ? `console errors:\n${[...new Set(errors)].join('\n')}` : 'no console errors')
} finally {
  stop()
}

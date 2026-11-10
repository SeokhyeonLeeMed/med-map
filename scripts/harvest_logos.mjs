// 로고 후보를 넓게 모은다(fetch_logos.py·fetch_logos_browser.mjs 로 못 받은 기관용).
//
// 누리집 첫 화면을 실제 브라우저로 한 번 열고, 아래를 모두 후보로 저장한다.
//   - 'logo'·'로고'·'ci' 가 이름·클래스·주소·대체문구에 들어간 <img> 원본 파일(머리글·바닥글 모두)
//   - 같은 표시가 붙은 인라인 <svg> (outerHTML 을 그대로 .svg 로 저장 — 벡터 원본)
//   - 'logo' 표시가 붙은 요소의 CSS 배경 이미지 원본
//   - 위 요소들의 화면 캡처, apple-touch-icon·og:image
// 크롤링이 아니라 기관마다 첫 화면 한 번만 연다. 어떤 후보를 쓸지는 사람이 후보 시트를 보고 고른다.
//
// 사용: node scripts/harvest_logos.mjs <targets.json>
//   targets.json = [{ "id": "h-...", "urls": ["https://...", ...] }, ...]
// 결과: .cache/logos_web/<id>/h<n>.* 와 .cache/logos_web/harvest.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.cache', 'logos_web')
const logPath = path.join(outDir, 'harvest.json')
const targets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : {}

const extOf = (ct, url) => {
  if (/svg/.test(ct)) return '.svg'
  if (/png/.test(ct)) return '.png'
  if (/gif/.test(ct)) return '.gif'
  if (/webp/.test(ct)) return '.webp'
  if (/jpe?g/.test(ct)) return '.jpg'
  if (/icon/.test(ct)) return '.ico'
  const m = /\.(svg|png|gif|webp|jpe?g|ico)(\?|$)/i.exec(url)
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.bin'
}

// 스크립트가 끝없이 도는 누리집에서 멈추지 않도록 문서 조사에 시간 제한을 둔다.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: 'ko-KR',
  ignoreHTTPSErrors: true,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
})
for (const { id, urls } of targets) {
  // 기관마다 새 탭을 연다. 스스로 계속 이동하는 누리집이 다음 기관까지 망치지 않게 한다.
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.dismiss().catch(() => {}))
  const dir = path.join(outDir, id)
  fs.mkdirSync(dir, { recursive: true })
  const got = []
  let n = 0
  for (const url of urls) {
    console.log(`  ${id} — ${url}`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 })
      await page.waitForTimeout(4000)
    } catch (e) {
      console.log(`    열지 못함 (${e.message.split('\n')[0].slice(0, 90)})`)
      got.push({ url, error: e.message.split('\n')[0].slice(0, 120) })
      continue
    }
    // 첫 화면 전체 캡처(로고가 요소로 안 잡힐 때 손으로 잘라 쓸 원본)
    const shot = `h${n++}_page.png`
    await page.screenshot({ path: path.join(dir, shot), timeout: 20000 }).catch(() => {})
    got.push({ file: shot, url: page.url(), kind: 'page' })

    for (const frame of page.frames()) {
      let found
      try {
        found = await withTimeout(frame.evaluate(() => {
          const RX = /logo|로고|ロゴ|(^|[^a-z])ci([^a-z]|$)|brand|symbol/i
          const out = { imgs: [], svgs: [], bgs: [], boxes: [], icons: [] }
          const label = (el) => {
            const parts = []
            for (let e = el, d = 0; e && d < 4; e = e.parentElement, d++) {
              parts.push(e.id, e.className?.baseVal ?? e.className, e.getAttribute?.('alt'), e.getAttribute?.('title'), e.getAttribute?.('aria-label'))
              if (e.tagName === 'IMG') parts.push(e.getAttribute('src'))
            }
            return parts.filter(Boolean).join(' ')
          }
          const vis = (el) => {
            const r = el.getBoundingClientRect()
            const s = getComputedStyle(el)
            return r.width >= 24 && r.height >= 12 && s.visibility !== 'hidden' && s.display !== 'none'
          }
          for (const img of document.querySelectorAll('img')) {
            const l = label(img)
            const r = img.getBoundingClientRect()
            const top = r.top + window.scrollY
            if (RX.test(l) || (top < 180 && r.left < 600 && r.width > 60 && r.width < 520 && r.height < 180)) {
              out.imgs.push({ src: img.currentSrc || img.src, label: l.slice(0, 100) })
              if (vis(img)) out.boxes.push({ x: r.left, y: top, w: r.width, h: r.height, label: 'img ' + l.slice(0, 60) })
            }
          }
          for (const svg of document.querySelectorAll('svg')) {
            const l = label(svg)
            const r = svg.getBoundingClientRect()
            if (!RX.test(l) || r.width < 40) continue
            const c = svg.cloneNode(true)
            if (!c.getAttribute('xmlns')) c.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
            // <use> 가 문서의 다른 심볼을 가리키면 그 심볼을 함께 넣는다.
            for (const u of c.querySelectorAll('use')) {
              const ref = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace(/^#/, '')
              const sym = ref && document.getElementById(ref)
              if (sym) c.insertBefore(sym.cloneNode(true), c.firstChild)
            }
            if (!c.getAttribute('viewBox')) c.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`)
            out.svgs.push({ html: c.outerHTML, label: l.slice(0, 100) })
            out.boxes.push({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, label: 'svg ' + l.slice(0, 60) })
          }
          for (const el of document.querySelectorAll('a, h1, div, span, i, strong, p')) {
            const s = getComputedStyle(el)
            if (s.backgroundImage === 'none' || !/url\(/.test(s.backgroundImage)) continue
            const l = label(el)
            if (!RX.test(l)) continue
            const m = /url\(["']?([^"')]+)/.exec(s.backgroundImage)
            if (m) out.bgs.push({ src: new URL(m[1], document.baseURI).href, label: l.slice(0, 100) })
            const r = el.getBoundingClientRect()
            if (vis(el)) out.boxes.push({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, label: 'bg ' + l.slice(0, 60) })
          }
          for (const ln of document.querySelectorAll('link[rel*="icon"], meta[property="og:image"]')) {
            const href = ln.getAttribute('href') || ln.getAttribute('content')
            if (href) out.icons.push({ src: new URL(href, document.baseURI).href, label: ln.getAttribute('rel') || 'og:image' })
          }
          return out
        }), 15000)
      } catch {
        continue
      }
      const frameEl = await frame.frameElement().catch(() => null)
      const off = frameEl ? (await frameEl.boundingBox()) ?? { x: 0, y: 0 } : { x: 0, y: 0 }
      const seen = new Set(got.map((g) => g.src).filter(Boolean))
      for (const it of [...found.imgs, ...found.bgs, ...found.icons]) {
        if (!it.src || seen.has(it.src) || it.src.startsWith('data:image/gif')) continue
        seen.add(it.src)
        if (got.filter((g) => g.kind === 'file').length >= 25) break
        try {
          let body, ct
          if (it.src.startsWith('data:')) {
            const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(it.src)
            ct = m[1]
            body = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
          } else {
            const r = await ctx.request.get(it.src, { timeout: 20000, headers: { Referer: page.url() } })
            if (!r.ok()) continue
            body = await r.body()
            ct = r.headers()['content-type'] ?? ''
          }
          if (body.length < 200) continue
          const file = `h${n++}${extOf(ct, it.src)}`
          fs.writeFileSync(path.join(dir, file), body)
          got.push({ file, src: it.src.slice(0, 300), url: page.url(), kind: 'file', note: it.label })
        } catch {
          /* 받지 못한 후보는 건너뛴다 */
        }
      }
      for (const s of found.svgs) {
        const file = `h${n++}.svg`
        fs.writeFileSync(path.join(dir, file), s.html)
        got.push({ file, url: page.url(), kind: 'inline-svg', note: s.label })
      }
      for (const b of found.boxes.slice(0, 8)) {
        const file = `h${n++}_shot.png`
        try {
          await page.screenshot({ path: path.join(dir, file), clip: { x: b.x + off.x, y: b.y + off.y, width: b.w, height: b.h }, fullPage: true, timeout: 15000 })
          got.push({ file, url: page.url(), kind: 'shot', note: b.label })
        } catch {
          /* 화면 밖 요소 */
        }
      }
    }
  }
  console.log(`    후보 ${got.filter((g) => g.file).length}개`)
  log[id] = { candidates: got, retrievedOn: new Date().toISOString().slice(0, 10) }
  fs.writeFileSync(logPath, JSON.stringify(log, null, 1))
  await page.close().catch(() => {})
}
await browser.close()

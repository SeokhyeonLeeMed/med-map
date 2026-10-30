// 자바스크립트로 그리는 누리집에서 로고를 받는다(fetch_logos.py 로 못 받은 기관용).
//
// 페이지를 실제 브라우저로 열고, 화면 위쪽에서 'logo' 가 들어간 요소를 찾아 그 요소만 캡처한다.
// CSS 배경이나 인라인 SVG 로 그린 로고도 그대로 담긴다. robots.txt 가 막은 주소는 열지 않는다.
// 결과는 .cache/logos_web/<기관ID>/browser<n>.png 와 candidates.json 에 더한다. 채택은 사람이 한다.
//
// 사용: node scripts/fetch_logos_browser.mjs <기관ID>=<주소> ...   (주소를 빼면 hospitals.json 의 홈페이지)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.cache', 'logos_web')
const logPath = path.join(outDir, 'candidates.json')
const UA = 'medmap-logo-fetch/0.1 (+https://github.com/SeokhyeonLeeMed/med-map)'

const insts = [
  ...JSON.parse(fs.readFileSync(path.join(root, 'public/data/hospitals.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(root, 'public/data/medical-schools.json'), 'utf8')),
]
const byId = Object.fromEntries(insts.map((i) => [i.id, i]))
const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : {}

const robotsCache = new Map()
async function allowed(url) {
  const u = new URL(url)
  if (!robotsCache.has(u.origin)) {
    let rules = []
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (r.ok) {
        // User-agent: * 묶음의 Disallow 만 본다.
        let star = false
        for (const line of (await r.text()).split(/\r?\n/)) {
          const [k, ...v] = line.split(':')
          const key = k.trim().toLowerCase()
          const val = v.join(':').trim()
          if (key === 'user-agent') star = val === '*'
          else if (star && key === 'disallow' && val) rules.push(val)
        }
      }
    } catch {
      rules = []
    }
    robotsCache.set(u.origin, rules)
  }
  return !robotsCache.get(u.origin).some((p) => u.pathname.startsWith(p))
}

const targets = process.argv.slice(2).map((a) => {
  const [id, ...rest] = a.split('=')
  return { id, url: rest.join('=') || byId[id]?.homepage }
})

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: 'ko-KR', ignoreHTTPSErrors: true })
const page = await ctx.newPage()
page.on('dialog', (d) => d.dismiss().catch(() => {}))
for (const { id, url: raw } of targets) {
  if (!raw) continue
  const url = /^https?:/.test(raw) ? raw : `http://${raw}`
  console.log(`  ${id} ${byId[id]?.officialName ?? ''} — ${url}`)
  if (!(await allowed(url))) {
    console.log('    robots.txt 가 막음')
    log[id] = { ...(log[id] ?? {}), homepage: url, browserError: 'robots.txt' }
    continue
  }
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3500)
  } catch (e) {
    console.log(`    열지 못함 (${e.name})`)
    log[id] = { ...(log[id] ?? {}), homepage: url, browserError: '열지 못함' }
    continue
  }
  // 화면 위쪽 400px 안에서 logo 가 이름·클래스·주소·대체문구에 들어간 보이는 요소를 고른다.
  const find = () => {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('img, svg, a, h1, div, span')) {
      const r = el.getBoundingClientRect()
      if (r.width < 40 || r.height < 16 || r.top > 400 || r.top < -5 || r.width > 700 || r.height > 220) continue
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue
      const attrs = [el.id, el.className?.baseVal ?? el.className, el.getAttribute('src'), el.getAttribute('alt'), el.getAttribute('title')]
        .join(' ')
        .toLowerCase()
      const bg = s.backgroundImage !== 'none'
      const hasImg = el.tagName === 'IMG' || el.tagName === 'svg' || bg || el.querySelector('img, svg')
      if (!/logo|로고/.test(attrs) || !hasImg) continue
      if (/foot|bottom|btm|sns|banner|popup/.test(attrs)) continue
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, tag: el.tagName, attrs: attrs.slice(0, 80) })
    }
    if (out.length === 0) {
      // 'logo' 표시가 없으면 화면 왼쪽 위의 첫 이미지(대개 로고 자리)를 후보로 삼는다.
      for (const el of document.querySelectorAll('img, svg')) {
        const r = el.getBoundingClientRect()
        if (r.top < 0 || r.top > 160 || r.left > 700 || r.width < 60 || r.width > 500 || r.height < 20 || r.height > 160) continue
        out.push({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height, tag: `${el.tagName}(위치)`, attrs: (el.getAttribute('src') ?? '').slice(0, 80) })
        break
      }
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 3)
  }
  // 프레임으로 짠 누리집은 로고가 하위 프레임에 있다. 위쪽 프레임부터 찾는다.
  let boxes = []
  let shotTarget = page
  for (const frame of page.isClosed() ? [] : page.frames()) {
    try {
      boxes = await frame.evaluate(find)
    } catch {
      boxes = []
    }
    if (boxes.length) {
      const handle = await frame.frameElement().catch(() => null)
      const offset = handle ? await handle.boundingBox() : { x: 0, y: 0 }
      boxes = boxes.map((b) => ({ ...b, x: b.x + (offset?.x ?? 0), y: b.y + (offset?.y ?? 0) }))
      shotTarget = page
      break
    }
  }
  const got = []
  fs.mkdirSync(path.join(outDir, id), { recursive: true })
  for (const [n, b] of boxes.entries()) {
    if (b.w * b.h <= 0) continue
    const file = `browser${n}.png`
    try {
      await shotTarget.screenshot({ path: path.join(outDir, id, file), clip: { x: b.x, y: b.y, width: b.w, height: b.h }, timeout: 15000 })
    } catch (e) {
      console.log(`    캡처 실패 (${e.name})`)
      continue
    }
    got.push({ file, url: page.url(), kind: `browser:${b.tag}`, note: b.attrs })
  }
  console.log(`    후보 ${got.length}개`)
  log[id] = { ...(log[id] ?? {}), homepage: page.url(), browserCandidates: got, retrievedOn: new Date().toISOString().slice(0, 10) }
  // 도중에 멈춰도 그때까지 받은 결과는 남도록 기관마다 저장한다.
  fs.writeFileSync(logPath, JSON.stringify(log, null, 1))
}
await browser.close()
fs.writeFileSync(logPath, JSON.stringify(log, null, 1))
console.log(`→ ${logPath}`)

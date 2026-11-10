// 로고 후보 시트: 기관마다 후보 파일을 한 장에 늘어놓고 캡처한다. 채택은 사람이 눈으로 한다.
//
// 사용: node scripts/logo_sheet.mjs <출력 폴더> <기관ID> ...
//   후보는 .cache/logos_web/<기관ID>/ 의 h* 파일(harvest_logos.mjs 결과)과 cand*·browser* 파일이다.
//   page 캡처(h*_page.png)는 너무 커서 따로 한 장으로 남긴다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, '.cache', 'logos_web')
const [out, ...ids] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
for (const id of ids) {
  const dir = path.join(web, id)
  if (!fs.existsSync(dir)) continue
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(svg|png|jpe?g|gif|webp|ico)$/i.test(f) && !/_page\.png$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const cells = files
    .map((f) => {
      // about:blank 에서는 file:// 이미지를 막으므로 data URI 로 넣는다.
      const ext = path.extname(f).slice(1).toLowerCase()
      const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon' }[ext] ?? `image/${ext}`
      const src = `data:${mime};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`
      return `<figure><div class="w"><img src="${src}"></div><div class="d"><img src="${src}"></div><figcaption>${f}</figcaption></figure>`
    })
    .join('')
  await page.setContent(
    `<style>body{font:12px sans-serif;margin:8px;display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:280px;border:1px solid #ccc}
     .w,.d{height:70px;display:flex;align-items:center;justify-content:center;padding:4px}.d{background:#333}
     img{max-width:270px;max-height:62px}figcaption{padding:2px 4px;background:#eee}</style><h3 style="width:100%;margin:0">${id}</h3>${cells}`,
  )
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(out, `${id}.png`), fullPage: true })
  for (const f of fs.readdirSync(dir).filter((f) => /_page\.png$/.test(f))) {
    fs.copyFileSync(path.join(dir, f), path.join(out, `${id}__${f}`))
  }
}
await browser.close()

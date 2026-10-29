/**
 * 공개 원자료를 내려받는다. 둘 다 로그인 없이 받을 수 있지만 평범한 GET 으로는 막혀서
 * 실제 브라우저 세션이 필요하다. 그래서 Playwright 로 받는다.
 *
 *   node scripts/fetch_sources.mjs           둘 다
 *   node scripts/fetch_sources.mjs hira      심평원 전국 병의원 및 약국 현황 (ZIP, 약 20MB)
 *   node scripts/fetch_sources.mjs quota     2023~2026년도 전공의 정원 PDF
 *
 * 받은 파일은 .cache/ 아래에 두고, 각각 build_hira_index.py 와 extract_quota.py 가 읽는다.
 * .cache 는 저장소에 올리지 않는다.
 */
import { chromium } from '@playwright/test'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache')

/** 공공데이터포털 파일데이터. 페이지의 '다운로드' 버튼이 로그인 없이 동작한다. */
async function fetchHira(ctx) {
  const out = path.join(CACHE, 'hira')
  fs.mkdirSync(out, { recursive: true })
  const page = await ctx.newPage()
  await page.goto('https://www.data.go.kr/data/15051059/fileData.do', {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  })
  await page.waitForTimeout(2000)
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180_000 }),
    page.getByRole('button', { name: '다운로드' }).first().click(),
  ])
  const dest = path.join(out, download.suggestedFilename())
  await download.saveAs(dest)
  console.log(`심평원 자료: ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`)
  console.log('  압축을 .cache/hira/extracted/ 에 풀고 `npm run build:hira` 를 실행하세요.')
  await page.close()
}

/**
 * 대한병원협회 수련환경평가본부 공지사항의 연도별 전공의 정원 첨부.
 * 게시판이 자바스크립트로 동작해 목록에서 검색한 뒤 글을 열어야 한다.
 *
 * 각 글의 첨부는 「○○년도 인턴 정원」·「○○년도 레지던트 1년차 정원」 PDF 두 개다.
 * 파일명이 해마다 조금씩 달라 링크 텍스트로 찾는다.
 */
const QUOTA_POSTS = [
  { year: 2023, view: ['37966', 'Y', 'B150720', 'ALL,KHA_STAFF,HOSPITAL'], keyword: '2023년도 전공의' },
  { year: 2024, view: ['38010', 'Y', 'B150720', 'ALL,KHA_STAFF,HOSPITAL'], keyword: '2024년도 전공의' },
  { year: 2025, view: ['38063', 'Y', 'B150720', 'ALL,KHA_STAFF,HOSPITAL'], keyword: '2025년도 인턴' },
  { year: 2026, view: ['38121', 'Y', 'B211201', 'ALL,KHA_STAFF,HOSPITAL'], keyword: '2026년도 인턴' },
]

async function fetchQuota(ctx) {
  const out = path.join(CACHE, 'quota')
  fs.mkdirSync(out, { recursive: true })
  const page = await ctx.newPage()
  const board =
    'https://sinim.kha.or.kr/board/nsinim/list?siteGb=SINIMNEW&siteCd=SINIMNEW&brdMstIdx=446'

  for (const post of QUOTA_POSTS) {
    await page.goto(board, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.fill('#keyWord', post.keyword)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2500)
    await page.evaluate((args) => fnView(...args), post.view)
    await page.waitForTimeout(3000)

    // 첨부 링크 중 '인턴 정원' / '레지던트 ... 정원' 이 들어간 PDF 를 고른다.
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .map((a, i) => ({ i, text: a.textContent.replace(/\s+/g, ' ').trim() }))
        .filter((x) => /\.pdf$/i.test(x.text) && x.text.includes('정원')),
    )
    for (const [needle, fileName] of [
      ['인턴', `intern${post.year}.pdf`],
      ['레지던트', `resident${post.year}.pdf`],
    ]) {
      // 같은 글에 수정본이 함께 올라오는 해가 있어, 맨 뒤(가장 나중) 파일을 쓴다.
      const hit = [...links].reverse().find((x) => x.text.includes(needle) && !x.text.includes('탄력'))
      if (!hit) {
        console.log(`  !! ${post.year} ${needle} 첨부를 찾지 못했습니다`)
        continue
      }
      const link = page.locator('a').nth(hit.i)
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        link.click(),
      ])
      const dest = path.join(out, fileName)
      await download.saveAs(dest)
      console.log(`${post.year}년 정원: ${fileName} (${Math.round(fs.statSync(dest).size / 1024)} KB)`)
      await page.waitForTimeout(800)
    }
  }
  console.log('  `npm run build:quota` 으로 표를 읽어 들이세요.')
  await page.close()
}

async function main() {
  const which = new Set(process.argv.slice(2))
  const all = which.size === 0
  try {
    createRequire(import.meta.url).resolve('@playwright/test')
  } catch {
    console.error('@playwright/test 가 필요합니다. `npm install` 을 먼저 실행하세요.')
    process.exit(1)
  }
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ acceptDownloads: true })
  try {
    if (all || which.has('hira')) await fetchHira(ctx)
    if (all || which.has('quota')) await fetchQuota(ctx)
  } finally {
    await browser.close()
  }
}

await main()

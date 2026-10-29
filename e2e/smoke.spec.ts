import { expect, test, type Page } from '@playwright/test'

async function waitForMap(page: Page) {
  await expect(page.getByTestId('map')).toBeVisible()
  await expect(page.locator('.maplibregl-canvas')).toBeVisible()
  // 마커 라벨이 하나라도 그려지면 데이터·지도 모두 올라온 것이다.
  await expect(page.locator('[aria-hidden="true"] > span').first()).toBeVisible({ timeout: 20_000 })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('지도와 기본 통계가 표시된다', async ({ page }) => {
  await waitForMap(page)
  await expect(page.getByRole('heading', { name: '메디컬 맵' })).toBeVisible()
  const total = page.locator('dt', { hasText: '기관' }).first().locator('xpath=following-sibling::dd[1]')
  await expect(total).not.toHaveText('0')
})

test('검색 결과를 고르면 상세 패널이 열린다', async ({ page }) => {
  await waitForMap(page)
  await page.getByLabel('기관 검색').fill('세브란스')
  const option = page.getByRole('option').first()
  await expect(option).toBeVisible()
  await option.click()
  const panel = page.getByRole('complementary', { name: '기관 상세 정보' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading')).toContainText('세브란스')
  await expect(page).toHaveURL(/sel=/)
})

test('상세 패널의 관련 기관을 누르면 그 기관으로 이동한다', async ({ page }) => {
  await waitForMap(page)
  await page.getByLabel('기관 검색').fill('고려대학교의과대학부속구로병원')
  await page.getByRole('option').first().click()
  const panel = page.getByRole('complementary', { name: '기관 상세 정보' })
  await expect(panel.getByRole('heading').first()).toContainText('구로병원')
  await panel.getByRole('tab', { name: '관련기관' }).click()
  // 구로병원의 관련 기관은 고려대학교 의과대학이다.
  await panel.getByRole('button', { name: /고려대학교 의과대학/ }).click()
  await expect(panel.getByRole('heading').first()).toContainText('고려대학교 의과대학')
  await expect(page).toHaveURL(/sel=ms-/)
})

test('권역 필터와 통계가 함께 바뀐다', async ({ page }) => {
  await waitForMap(page)
  const countOf = async () =>
    Number((await page.locator('dt', { hasText: /^기관$/ }).first().locator('xpath=following-sibling::dd[1]').textContent())?.replace(/[^\d]/g, ''))
  const before = await countOf()
  await page.getByRole('checkbox', { name: '제주' }).check()
  await expect.poll(countOf).toBeLessThan(before)
  await expect(page.getByRole('button', { name: /제주/ }).first()).toBeVisible()
})

test('원주충주는 강원과 충북 양쪽에서 함께 켜지고 꺼진다', async ({ page }) => {
  await waitForMap(page)
  const boxes = page.getByRole('checkbox', { name: '원주충주' })
  await expect(boxes).toHaveCount(2)
  await boxes.first().check()
  await expect(boxes.nth(0)).toBeChecked()
  await expect(boxes.nth(1)).toBeChecked()
  await boxes.nth(1).uncheck()
  await expect(boxes.nth(0)).not.toBeChecked()
  await expect(boxes.nth(1)).not.toBeChecked()
})

test('대권역을 켜면 소속 세부권역이 모두 켜진다', async ({ page }) => {
  await waitForMap(page)
  await page.getByRole('button', { name: /^서울/ }).first().click()
  for (const name of ['서울서북', '서울동북', '서울서남', '서울동남']) {
    await expect(page.getByRole('checkbox', { name })).toBeChecked()
  }
})

test('필터를 조합하면 결과가 함께 좁아진다', async ({ page }) => {
  await waitForMap(page)
  const countOf = async () =>
    Number((await page.locator('dt', { hasText: /^기관$/ }).first().locator('xpath=following-sibling::dd[1]').textContent())?.replace(/[^\d]/g, ''))
  await page.getByRole('checkbox', { name: '경기서남' }).check()
  const regionOnly = await countOf()
  await page.getByRole('checkbox', { name: /권역응급의료센터/ }).check()
  const combined = await countOf()
  expect(combined).toBeLessThanOrEqual(regionOnly)
  expect(combined).toBeGreaterThan(0)
})

test('뒤로 가기로 선택 상태가 되돌아간다', async ({ page }) => {
  await waitForMap(page)
  await page.getByLabel('기관 검색').fill('서울대학교병원')
  await page.getByRole('option').first().click()
  await expect(page.getByRole('complementary', { name: '기관 상세 정보' })).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/sel=/)
})

test('URL 로 직접 들어와도 선택 상태가 복원된다', async ({ page }) => {
  await page.goto('/?region=jeju&sel=h-jejudaehakgyobyeongwon')
  await waitForMap(page)
  const panel = page.getByRole('complementary', { name: '기관 상세 정보' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading').first()).toContainText('제주대학교병원')
  await expect(page.getByRole('checkbox', { name: '제주' })).toBeChecked()
})

test('확대하면 더 많은 기관 라벨이 드러난다', async ({ page }) => {
  await waitForMap(page)
  const labelsAt = async () => page.locator('[aria-hidden="true"] > span').count()
  const far = await labelsAt()
  // 기관이 조밀한 서울로 지도를 옮긴 뒤(선택 시 자동 이동) 라벨 수를 비교한다.
  await page.getByLabel('기관 검색').fill('서울대학교병원')
  await page.getByRole('option').first().click()
  await page.waitForTimeout(1200)
  expect(await labelsAt()).toBeGreaterThan(far)
})

test('모집 자료가 없는 병원은 0명이 아니라 미확인으로 표시된다', async ({ page }) => {
  await waitForMap(page)
  await page.getByLabel('기관 검색').fill('건양대학교부여병원')
  await page.getByRole('option').first().click()
  const panel = page.getByRole('complementary', { name: '기관 상세 정보' })
  await panel.getByRole('tab', { name: '수련' }).click()
  await expect(panel.getByText('자료 미확인')).toBeVisible()
})

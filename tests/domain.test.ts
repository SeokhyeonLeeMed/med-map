import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activeEmergency,
  applyFilters,
  buildSearchIndex,
  computeStats,
  highlightedSgg,
  hospitalsWithTraining,
  hospitalTraits,
  macroState,
  normalizeQuery,
  pastEmergency,
  recruitmentFor,
  rankedSearch,
  searchMatches,
  toggleMacro,
  toggleSub,
} from '../src/lib/domain'
import type { Dataset, Filters, Hospital } from '../src/types'

const ROOT = join(__dirname, '..')
const read = <T,>(name: string): T => JSON.parse(readFileSync(join(ROOT, 'public', 'data', name), 'utf-8')) as T

const data: Dataset = {
  hospitals: read('hospitals.json'),
  schools: read('medical-schools.json'),
  relations: read('institution-relations.json'),
  trainingUnits: read('training-units.json'),
  trainingIndex: read('recruitment-index.json'),
  recruitment: read<{ byInstitution: Dataset['recruitment'] }>('residency-recruitment.json').byInstitution,
  regions: read('regions.json'),
  sources: read<{ sources: Dataset['sources'] }>('sources.json').sources,
}
const trainedIds = hospitalsWithTraining(data)
const searchIndex = buildSearchIndex(data)
const ctx = { trainedIds, searchIndex }
const ALL: Filters = { subRegions: [], kinds: ['hospital', 'medicalSchool'], traits: [], query: '' }

/** 기관별로 묶인 기록을 한 줄로 펼친다. 통합수련 기록은 소속 병원 수만큼 중복된다. */
const allRecords = Object.values(data.recruitment).flat()

/** 중복을 걷어낸 기록. 통합수련 단위는 한 번만 센다. */
const uniqueRecords = (() => {
  const seen = new Set<string>()
  const out: typeof allRecords = []
  for (const [instId, rows] of Object.entries(data.recruitment)) {
    for (const r of rows) {
      const key = [r.unitId ?? instId, r.year, r.term, r.track, r.specialty ?? ''].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
    }
  }
  return out
})()

/** 그 해에 모집 기록이 있는 기관 수 */
const institutionsWithYear = (year: number) =>
  Object.entries(data.recruitment).filter(([, rows]) => rows.some((r) => r.year === year)).length

const macro = (id: string) => data.regions.macroRegions.find((m) => m.id === id)!
const sub = (id: string) => data.regions.subRegions.find((s) => s.id === id)!

describe('권역 정의', () => {
  it('세부권역이 256개 시군구를 빠짐없이, 한 번씩만 덮는다', () => {
    const all = data.regions.subRegions.flatMap((s) => s.sgg)
    expect(all).toHaveLength(256)
    expect(new Set(all).size).toBe(256)
  })

  it('대권역과 세부권역이 서로를 가리킨다', () => {
    for (const m of data.regions.macroRegions) {
      for (const sid of m.subRegions) expect(sub(sid).macroRegions).toContain(m.id)
    }
    for (const s of data.regions.subRegions) {
      for (const mid of s.macroRegions) expect(macro(mid).subRegions).toContain(s.id)
    }
  })

  it('원주충주만 두 대권역에 걸친다', () => {
    const dual = data.regions.subRegions.filter((s) => s.macroRegions.length > 1)
    expect(dual.map((s) => s.id)).toEqual(['wonju-chungju'])
    expect(dual[0].macroRegions.sort()).toEqual(['chungbuk', 'gangwon'])
  })
})

describe('권역 필터 토글', () => {
  it('대권역을 켜면 소속 세부권역이 모두 켜지고, 다시 누르면 모두 꺼진다', () => {
    const seoul = macro('seoul')
    const on = toggleMacro(seoul, new Set())
    expect([...on].sort()).toEqual([...seoul.subRegions].sort())
    expect(macroState(seoul, on)).toBe('all')
    expect(toggleMacro(seoul, on).size).toBe(0)
  })

  it('일부만 켜면 대권역은 부분 선택이 된다', () => {
    const seoul = macro('seoul')
    const partial = new Set(['seoul-nw'])
    expect(macroState(seoul, partial)).toBe('partial')
  })

  it('강원에서 원주충주를 켜면 충북 쪽에서도 켜진 것으로 보인다', () => {
    const on = toggleMacro(macro('gangwon'), new Set())
    expect(on.has('wonju-chungju')).toBe(true)
    expect(macroState(macro('chungbuk'), on)).toBe('partial')
  })

  it('충북에서 원주충주를 끄면 강원 쪽에서도 꺼진다', () => {
    const on = toggleMacro(macro('gangwon'), new Set())
    const off = toggleSub('wonju-chungju', on)
    expect(off.has('wonju-chungju')).toBe(false)
    expect(macroState(macro('chungbuk'), off)).toBe('none')
    expect(macroState(macro('gangwon'), off)).toBe('partial')
  })

  it('충북 전체를 켜면 원주충주가 포함되어 강원도 부분 선택이 된다', () => {
    const on = toggleMacro(macro('chungbuk'), new Set())
    expect(on.has('wonju-chungju')).toBe(true)
    expect(macroState(macro('gangwon'), on)).toBe('partial')
  })
})

describe('검색', () => {
  it('공백·괄호·가운뎃점 차이를 무시한다', () => {
    expect(normalizeQuery('가톨릭대학교 (서울)성모병원')).toBe(normalizeQuery('가톨릭대학교서울성모병원'))
  })

  it('약칭으로도 찾힌다', () => {
    const ids = searchMatches(searchIndex, '세브란스')
    const names = data.hospitals.filter((h) => ids.has(h.id)).map((h) => h.officialName)
    expect(names.some((n) => n.includes('세브란스'))).toBe(true)
  })

  it('관련 대학 이름으로 병원을 찾을 수 있다', () => {
    const ids = searchMatches(searchIndex, '울산대학교')
    const hit = data.hospitals.find((h) => h.officialName.includes('서울아산병원'))!
    expect(ids.has(hit.id)).toBe(true)
  })

  it('빈 검색어는 전부를 통과시킨다', () => {
    expect(searchMatches(searchIndex, '').size).toBe(data.hospitals.length + data.schools.length)
  })

  it('정확히 일치하는 이름이 가장 앞에 온다', () => {
    const all = applyFilters(data, ALL, ctx)
    const got = rankedSearch(searchIndex, '서울대학교병원', all)
    expect(got[0].officialName).toBe('서울대학교병원')
  })

  it('검색은 지도에 보이는 기관 안에서만 찾는다', () => {
    const jeju = applyFilters(data, { ...ALL, subRegions: ['jeju'] }, ctx)
    expect(rankedSearch(searchIndex, '서울대학교병원', jeju)).toHaveLength(0)
  })

  it('검색어는 지도 결과를 걸러내지 않는다', () => {
    const withQuery = applyFilters(data, { ...ALL, query: '세브란스' }, ctx)
    expect(withQuery).toHaveLength(data.hospitals.length + data.schools.length)
  })
})

describe('필터 조합', () => {
  it('필터가 없으면 모든 기관이 나온다', () => {
    expect(applyFilters(data, ALL, ctx)).toHaveLength(data.hospitals.length + data.schools.length)
  })

  it('기관 유형 필터가 작동한다', () => {
    const only = applyFilters(data, { ...ALL, kinds: ['medicalSchool'] }, ctx)
    expect(only).toHaveLength(data.schools.length)
    expect(only.every((i) => i.type === 'medicalSchool')).toBe(true)
  })

  it('권역과 병원 특성을 함께 걸면 둘 다 만족하는 기관만 남는다', () => {
    const got = applyFilters(data, { ...ALL, subRegions: ['gg-sw'], traits: ['university', 'emergency'] }, ctx)
    expect(got.length).toBeGreaterThan(0)
    for (const i of got) {
      expect(i.subRegionId).toBe('gg-sw')
      const traits = hospitalTraits(i as Hospital, trainedIds)
      expect(traits).toContain('university')
      expect(traits).toContain('emergency')
    }
  })

  it('상급종합병원과 2차병원은 겹치지 않는다', () => {
    const t = new Set(applyFilters(data, { ...ALL, traits: ['tertiary'] }, ctx).map((i) => i.id))
    const s = new Set(applyFilters(data, { ...ALL, traits: ['secondary'] }, ctx).map((i) => i.id))
    expect([...t].filter((id) => s.has(id))).toHaveLength(0)
  })
})

describe('통계', () => {
  it('두 대권역에 걸친 권역을 함께 골라도 기관이 중복 집계되지 않는다', () => {
    const both = applyFilters(data, { ...ALL, subRegions: ['wonju-chungju'] }, ctx)
    const stats = computeStats([...both, ...both], data, trainedIds)
    expect(stats.total).toBe(new Set(both.map((i) => i.id)).size)
  })

  it('기관 총수와 모집 자료가 확인된 기관 수는 다른 값이다', () => {
    const all = applyFilters(data, ALL, ctx)
    const s = computeStats(all, data, trainedIds)
    expect(s.total).toBe(s.hospitals + s.schools)
    expect(s.withIntern).toBeLessThan(s.hospitals)
    expect(s.withIntern).toBeGreaterThan(0)
  })

  it('상급종합병원은 제5기 지정 47개 기관과 일치한다', () => {
    const all = applyFilters(data, ALL, ctx)
    expect(computeStats(all, data, trainedIds).tertiary).toBe(47)
  })

  it('권역응급의료센터는 가장 최근 기수 53개소만 센다', () => {
    const all = applyFilters(data, ALL, ctx)
    expect(computeStats(all, data, trainedIds).emergency).toBe(53)
  })

  it('이번 기수에서 빠진 기관은 현재 지정에서 제외되고 이력에만 남는다', () => {
    const dropped = data.hospitals.filter(
      (h) => activeEmergency(h).length === 0 && pastEmergency(h).length > 0,
    )
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped.some((h) => h.officialName.includes('강동경희'))).toBe(true)
  })
})

describe('수련 모집', () => {
  it('통합수련 단위는 소속 병원 모두에서 같은 모집 정보를 보여 준다', () => {
    const unit = data.trainingUnits.find((u) => u.integratedTraining && u.hospitalIds.length > 1)!
    const [a, b] = unit.hospitalIds
    const ra = recruitmentFor(a, data).find((r) => r.unitId === unit.id)!
    const rb = recruitmentFor(b, data).find((r) => r.unitId === unit.id)!
    expect(ra.intern.quota).toBe(rb.intern.quota)
    expect(ra.integratedTraining).toBe(true)
  })

  it('모집인원 0명은 확인된 값이고, 자료가 없는 병원은 미확인이다', () => {
    const zero = allRecords.filter((r) => r.quota === 0)
    expect(zero.length).toBeGreaterThan(0)
    expect(zero.every((r) => r.status !== '미확인')).toBe(true)

    const untrained = data.hospitals.find((h) => !trainedIds.has(h.id))!
    expect(recruitmentFor(untrained.id, data)).toHaveLength(0)
  })

  it('2026년 하반기 인턴 모집인원 합계가 공고와 같다', () => {
    const total = uniqueRecords
      .filter((r) => r.track === '인턴' && r.year === 2026 && r.term === '하반기')
      .reduce((a, r) => a + r.quota, 0)
    expect(total).toBe(1830)
  })

  it('2026년 하반기 레지던트 모집인원 합계가 공고와 같다', () => {
    const total = uniqueRecords
      .filter((r) => r.track === '레지던트' && r.year === 2026 && r.term === '하반기')
      .reduce((a, r) => a + r.quota, 0)
    expect(total).toBe(710)
  })

  it('연도별 정원 합계가 공고와 같다', () => {
    const sum = (year: number, track: string) =>
      uniqueRecords
        .filter((r) => r.year === year && r.term === '상반기' && r.track === track)
        .reduce((a, r) => a + r.quota, 0)
    // 2023: 보도 총계(3,258·3,465)에서 공고 변경 이력(동강병원 인턴 -3, 국립정신건강센터 -1)을 뺀 값
    expect(sum(2023, '인턴')).toBe(3255)
    expect(sum(2024, '인턴')).toBe(3258)
    // 2025·2026: 원문 표의 '최종정원' 열 합계와 같아야 한다
    expect(sum(2025, '인턴')).toBe(3356)
    expect(sum(2025, '레지던트')).toBe(3639)
    expect(sum(2026, '인턴')).toBe(3275)
    expect(sum(2023, '레지던트')).toBe(3464)
    expect(sum(2026, '레지던트')).toBe(2827)
  })
})

describe('연도별 정원 자료', () => {
  const y2023 = uniqueRecords.filter((r) => r.year === 2023)

  it('공식 공고에서 2023년 정원을 전량 싣는다', () => {
    const intern = y2023.filter((r) => r.track === '인턴')
    const resident = y2023.filter((r) => r.track === '레지던트')
    expect(intern.length).toBeGreaterThan(180)
    expect(resident.length).toBeGreaterThan(1800)
    expect(intern.every((r) => r.sourceId === 'src-kha-quota-2023')).toBe(true)
    expect(intern.every((r) => r.quotaKind === '정원')).toBe(true)
  })

  it('정원 내역을 기본·미충원·정책적으로 나눠 보존한다', () => {
    // 정원이 0인 기록은 내역이 모두 비어 파일에서 빠진다. 값이 있는 기록만 본다.
    const withQuota = y2023.filter((r) => r.quota > 0)
    expect(withQuota.every((r) => r.quotaBreakdown)).toBe(true)
    const sample = y2023.find((r) => (r.quotaBreakdown?.['정책적 별도정원'] ?? 0) > 0)!
    const b = sample.quotaBreakdown!
    const sum = (b['기본정원'] ?? 0) + (b['미충원 별도정원'] ?? 0) + (b['정책적 별도정원'] ?? 0)
    expect(sample.quota).toBe(sum)
  })

  it('기본정원 칸이 비고 별도정원만 있는 행도 버리지 않는다 (국군수도병원)', () => {
    const afch = data.hospitals.find((h) => h.officialName === '국군수도병원')!
    const years = new Set((data.recruitment[afch.id] ?? []).filter((r) => r.quotaKind === '정원').map((r) => r.year))
    expect([...years].sort()).toEqual([2023, 2024, 2025, 2026])
  })

  it('2023년 표의 옛 명칭 흉부외과는 심장혈관흉부외과로 맞춘다', () => {
    expect(allRecords.some((r) => r.specialty === '흉부외과')).toBe(false)
    expect(allRecords.some((r) => r.year === 2023 && r.specialty === '심장혈관흉부외과')).toBe(true)
  })

  it('2023~2026년 네 해의 정원을 모두 싣는다', () => {
    for (const year of [2023, 2024, 2025, 2026]) {
      expect(institutionsWithYear(year)).toBeGreaterThan(190)
    }
  })

  it('예방의학과 모집 단위는 의과대학이거나 요양기관이 아닌 수련기관이다', () => {
    const schoolIds = new Set(data.schools.map((s) => s.id))
    const byId = new Map(data.hospitals.map((h) => [h.id, h]))
    const owners = Object.entries(data.recruitment).filter(([, rows]) =>
      rows.some((r) => r.specialty === '예방의학과'),
    )
    expect(owners.length).toBeGreaterThan(0)
    for (const [id] of owners) {
      if (schoolIds.has(id)) continue
      // 병원 쪽에 달린 것은 보건대학원·연구원처럼 요양기관이 아닌 수련기관뿐이다.
      expect(byId.get(id)?.institutionKind).toBe('수련기관(비요양기관)')
    }
  })
})

describe('심평원 연계 데이터', () => {
  it('대부분의 병원이 공식 주소와 좌표를 가진다', () => {
    const withAddr = data.hospitals.filter((h) => h.address.status === '확인됨')
    expect(withAddr.length / data.hospitals.length).toBeGreaterThan(0.9)
    // 심평원 명부에 없는 비요양기관만 기관 공식 안내의 주소를 쓴다.
    const others = withAddr.filter((h) => h.address.sourceId !== 'src-hira-file-2026')
    expect(others.every((h) => h.institutionKind === '수련기관(비요양기관)')).toBe(true)
    expect(others.every((h) => data.sources.some((s) => s.id === h.address.sourceId))).toBe(true)
  })

  it('모든 기관이 좌표를 가지고, 근사 좌표에는 무엇을 찍었는지 적는다', () => {
    const all = [...data.hospitals, ...data.schools]
    expect(all.filter((i) => i.coord.lat == null)).toEqual([])
    const approx = all.filter((i) => i.coord.precision !== 'exact')
    expect(approx.every((i) => !!i.coord.note)).toBe(true)
    expect(data.schools.filter((s) => s.coord.precision === '시군구 대표점')).toEqual([])
  })

  it('이름을 바꾼 온종합병원은 온병원 하나로 합친다', () => {
    const on = data.hospitals.filter((h) => /온(종합)?병원$/.test(h.officialName.replace(/\s/g, '')))
    expect(on.map((h) => h.officialName)).toEqual(['의료법인 온병원그룹의료재단 온병원'])
    const years = new Set((data.recruitment[on[0].id] ?? []).map((r) => r.year))
    expect([...years].sort()).toEqual([2023, 2024, 2025, 2026])
  })

  it('의과대학 권역은 지도 위치(교육 장소)를 따른다', () => {
    const byName = (n: string) => data.schools.find((s) => s.officialName === n)!
    expect(byName('서울대학교 의과대학').sggName).toBe('서울특별시 종로구')
    expect(byName('연세대학교(미래) 의과대학').macroRegionIds).toContain('gangwon')
    expect(byName('울산대학교 의과대학').macroRegionIds).toEqual(['ulsan'])
  })

  it('진료과목과 과목별 전문의 수를 가진다', () => {
    const withDept = data.hospitals.filter((h) => h.departments.status === '확인됨')
    expect(withDept.length).toBeGreaterThan(200)
    const sample = withDept.find((h) => h.officialName.includes('서울대학교병원'))!
    expect(sample.departments.items.length).toBeGreaterThan(20)
    expect(sample.departments.items.some((d) => (d.specialists ?? 0) > 0)).toBe(true)
  })

  it('전문의 수와 재직 전공의 수를 모집 정원과 구별해 담는다', () => {
    const sample = data.hospitals.find((h) => h.staffing.status !== '미확인')!
    expect(sample.staffing.metric).toBe('과목별 전문의 수')
    expect(sample.staffing.note).toContain('모집 정원과 다른 값')
  })

  it('병상 수를 세부 내역과 함께 담는다', () => {
    const sample = data.hospitals.find((h) => h.bedDetail && h.bedDetail.total > 500)!
    const sum = Object.values(sample.bedDetail!.breakdown).reduce((a, b) => a + b, 0)
    expect(sum).toBe(sample.bedDetail!.total)
  })

  it('같은 요양기관이 두 레코드로 남아 있지 않다', () => {
    const ids = data.hospitals.map((h) => h.hiraId).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('상급종합병원 지정과 심평원 공시 종별이 서로 어긋나지 않는다', () => {
    const designated = data.hospitals.filter((h) => h.designations.tertiary)
    expect(designated).toHaveLength(47)
    expect(designated.every((h) => h.hiraKind === '상급종합')).toBe(true)
    const byKind = data.hospitals.filter((h) => h.hiraKind === '상급종합')
    expect(byKind).toHaveLength(47)
  })

  it('2차병원 분류는 심평원 공시 종별을 근거로 한다', () => {
    const secondary = applyFilters(data, { ...ALL, traits: ['secondary'] }, ctx) as Hospital[]
    expect(secondary.length).toBeGreaterThan(100)
    expect(secondary.every((h) => h.hiraKind === null || h.hiraKind !== '상급종합')).toBe(true)
  })
})

describe('지도 하이라이트', () => {
  it('선택한 권역의 시군구만 강조된다', () => {
    const codes = highlightedSgg(data.regions, new Set(['jeju']))
    expect([...codes].sort()).toEqual(['50110', '50130'])
  })

  it('원주충주는 강원과 충북 시군구를 함께 강조한다', () => {
    const codes = highlightedSgg(data.regions, new Set(['wonju-chungju']))
    expect([...codes].some((c) => c.startsWith('51'))).toBe(true)
    expect([...codes].some((c) => c.startsWith('43'))).toBe(true)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  buildSearchIndex,
  computeStats,
  highlightedSgg,
  hospitalsWithTraining,
  hospitalTraits,
  macroState,
  normalizeQuery,
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
  recruitment: read('residency-recruitment.json'),
  regions: read('regions.json'),
  sources: read<{ sources: Dataset['sources'] }>('sources.json').sources,
}
const trainedIds = hospitalsWithTraining(data)
const searchIndex = buildSearchIndex(data)
const ctx = { trainedIds, searchIndex }
const ALL: Filters = { subRegions: [], kinds: ['hospital', 'medicalSchool'], traits: [], query: '' }

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
    const zero = data.recruitment.filter((r) => r.quota === 0)
    expect(zero.length).toBeGreaterThan(0)
    expect(zero.every((r) => r.status !== '미확인')).toBe(true)

    const untrained = data.hospitals.find((h) => !trainedIds.has(h.id))!
    expect(recruitmentFor(untrained.id, data)).toHaveLength(0)
  })

  it('2026년 하반기 인턴 합계가 공고와 같다', () => {
    const total = data.recruitment
      .filter((r) => r.track === '인턴' && r.year === 2026 && r.term === '하반기')
      .reduce((a, r) => a + r.quota, 0)
    expect(total).toBe(1830)
  })

  it('2026년 하반기 레지던트 합계가 공고와 같다', () => {
    const total = data.recruitment
      .filter((r) => r.track === '레지던트' && r.year === 2026 && r.term === '하반기')
      .reduce((a, r) => a + r.quota, 0)
    expect(total).toBe(710)
  })
})

describe('2023년 자료', () => {
  it('2023년 기록은 있지만 전체 명단이 아니라는 표시를 달고 있다', () => {
    const y2023 = data.recruitment.filter((r) => r.year === 2023)
    expect(y2023.length).toBeGreaterThan(0)
    expect(y2023.every((r) => r.status !== '확인됨' || r.sourceId === 'src-snuh-2023-intern')).toBe(true)
    const h2 = y2023.filter((r) => r.term === '하반기')
    expect(h2.length).toBeGreaterThan(0)
    expect(h2.every((r) => typeof r.coverageWarning === 'string')).toBe(true)
  })

  it('2026년 자료로 2023년을 대신 채우지 않았다', () => {
    const units2023 = new Set(data.recruitment.filter((r) => r.year === 2023).flatMap((r) => r.hospitalIds))
    const units2026 = new Set(data.recruitment.filter((r) => r.year === 2026).flatMap((r) => r.hospitalIds))
    expect(units2023.size).toBeLessThan(units2026.size)
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

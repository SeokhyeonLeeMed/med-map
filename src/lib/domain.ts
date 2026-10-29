/**
 * 필터·통계·검색의 순수 함수 모음. UI 와 떼어 두어 단위 테스트가 가능하게 한다.
 */
import type {
  Dataset,
  Filters,
  Hospital,
  HospitalTrait,
  Institution,
  MacroRegion,
  MedicalSchool,
  Regions,
  RecruitmentRecord,
} from '../types'

/** 데이터 기준 시점. 이 날짜에 유효한 지정만 '현재 지정'으로 센다. */
export const AS_OF = '2026-10-29'

export const TRAIT_LABEL: Record<HospitalTrait, string> = {
  tertiary: '3차병원 (상급종합병원)',
  secondary: '2차병원 (종합병원급 수련병원)',
  university: '대학병원 (의과대학 부속·협력)',
  emergency: '권역응급의료센터',
}

/** 각 특성이 무엇을 근거로 한 분류인지. 화면에도 그대로 보여 준다. */
export const TRAIT_DEFINITION: Record<HospitalTrait, string> = {
  tertiary:
    '보건복지부가 지정한 상급종합병원. 공식 종별이며 지정 기간이 있다. 이 사이트는 "3차병원"을 상급종합병원 지정과 같은 뜻으로 쓰되, 그 사실을 명시한다.',
  secondary:
    '상급종합병원으로 지정되지 않은 전공의 수련병원. 의료법상 공식 종별 구분이 아니라 이 사이트가 탐색 편의를 위해 정의한 분류다. 종합병원·병원 종별은 별도로 확인하지 않았다.',
  university:
    '의과대학과 부속병원·교육협력병원 관계가 자료로 확인된 병원. 이름이 비슷하거나 같은 법인이라는 이유만으로는 넣지 않는다.',
  emergency:
    '보건복지부가 지정한 권역응급의료센터. 기관이 있는 지리적 권역이 아니라 공식 관할 응급의료권역을 함께 보여 준다.',
}

export function isHospital(x: Institution): x is Hospital {
  return x.type === 'hospital'
}

export function isSchool(x: Institution): x is MedicalSchool {
  return x.type === 'medicalSchool'
}

/** 기준일에 유효한 권역응급의료센터 지정. */
export function activeEmergency(h: Hospital, asOf = AS_OF) {
  return h.designations.emergency.filter((e) => e.validFrom <= asOf && asOf <= e.validTo)
}

/** 기준일에 유효한 상급종합병원 지정. */
export function activeTertiary(h: Hospital, asOf = AS_OF) {
  const t = h.designations.tertiary
  return t && t.validFrom <= asOf && asOf <= t.validTo ? t : null
}

export function hospitalTraits(h: Hospital, trainedIds: Set<string>, asOf = AS_OF): HospitalTrait[] {
  const out: HospitalTrait[] = []
  const tertiary = activeTertiary(h, asOf)
  if (tertiary) out.push('tertiary')
  else if (trainedIds.has(h.id)) out.push('secondary')
  if (h.universityRelations.length > 0) out.push('university')
  if (activeEmergency(h, asOf).length > 0) out.push('emergency')
  return out
}

/** 전공의 모집 자료가 하나라도 있는 병원 ID. 2차병원 분류의 근거가 된다. */
export function hospitalsWithTraining(data: Pick<Dataset, 'recruitment'>): Set<string> {
  const ids = new Set<string>()
  for (const r of data.recruitment) for (const hid of r.hospitalIds) ids.add(hid)
  return ids
}

// ---------------------------------------------------------------- 권역

export type MacroState = 'all' | 'partial' | 'none'

export function macroState(macro: MacroRegion, selected: ReadonlySet<string>): MacroState {
  const subs = macro.subRegions
  if (subs.length === 0) return 'none'
  const n = subs.filter((s) => selected.has(s)).length
  if (n === 0) return 'none'
  return n === subs.length ? 'all' : 'partial'
}

/**
 * 대권역을 켜고 끄면 소속 세부권역이 함께 바뀐다.
 * 원주충주처럼 두 대권역에 걸친 권역은 세부권역 ID 를 하나만 유지하므로,
 * 강원에서 켜면 충북 쪽에서도 켜진 것으로 보이고 어느 쪽에서 꺼도 함께 꺼진다.
 */
export function toggleMacro(macro: MacroRegion, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected)
  const state = macroState(macro, selected)
  for (const s of macro.subRegions) {
    if (state === 'all') next.delete(s)
    else next.add(s)
  }
  return next
}

export function toggleSub(subId: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected)
  if (next.has(subId)) next.delete(subId)
  else next.add(subId)
  return next
}

// ---------------------------------------------------------------- 검색

/**
 * 검색 대조용 정규화. 공백·괄호·가운뎃점·하이픈을 지우고 소문자로 맞춘다.
 * 정규화한 문자열은 대조에만 쓰고 화면에는 언제나 공식 명칭을 표시한다.
 */
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/[()[\]{}（）]/g, '')
    .replace(/[\s·ㆍ・,.'"\-_]/g, '')
}

export function searchKeys(inst: Institution): string[] {
  const base = [inst.officialName, ...inst.aliases]
  if (isHospital(inst)) {
    base.push(inst.commonName)
    if (inst.sggName) base.push(inst.sggName)
    base.push(...inst.universityRelations.map((r) => r.universityName))
  } else {
    base.push(inst.universityName, inst.schoolKind)
    if (inst.sggName) base.push(inst.sggName)
  }
  return [...new Set(base.filter(Boolean))]
}

export interface SearchIndexEntry {
  id: string
  type: Institution['type']
  /** 기관 자신의 이름들 */
  keys: string[]
  /** 관련 기관의 이름들. 찾히기는 하되 자기 이름보다 뒤로 밀린다. */
  relatedKeys: string[]
}

export function buildSearchIndex(data: Dataset): SearchIndexEntry[] {
  const nameById = new Map<string, string>()
  for (const h of data.hospitals) nameById.set(h.id, h.officialName)
  for (const s of data.schools) nameById.set(s.id, s.officialName)

  const related = new Map<string, string[]>()
  for (const r of data.relations) {
    const a = nameById.get(r.fromId)
    const b = nameById.get(r.toId)
    if (a && b) {
      related.set(r.toId, [...(related.get(r.toId) ?? []), a])
      related.set(r.fromId, [...(related.get(r.fromId) ?? []), b])
    }
  }

  const all: Institution[] = [...data.hospitals, ...data.schools]
  return all.map((inst) => ({
    id: inst.id,
    type: inst.type,
    keys: searchKeys(inst).map(normalizeQuery).filter(Boolean),
    relatedKeys: [...new Set(related.get(inst.id) ?? [])].map(normalizeQuery).filter(Boolean),
  }))
}

export function searchMatches(index: SearchIndexEntry[], query: string): Set<string> {
  const q = normalizeQuery(query)
  if (!q) return new Set(index.map((e) => e.id))
  const out = new Set<string>()
  for (const e of index) {
    if (e.keys.some((k) => k.includes(q)) || e.relatedKeys.some((k) => k.includes(q))) out.add(e.id)
  }
  return out
}

/** 검색어와 얼마나 맞는지. 0이면 안 맞음, 클수록 잘 맞음. */
export function matchScore(entry: SearchIndexEntry, q: string): number {
  let best = 0
  // 자기 이름이 맞은 쪽이 관련 기관 이름으로 걸린 쪽보다 언제나 앞선다.
  for (const [list, floor] of [
    [entry.keys, 1000],
    [entry.relatedKeys, 0],
  ] as const) {
    for (const k of list) {
      if (!k.includes(q)) continue
      // 정확히 같은 이름 > 그 이름으로 시작 > 어딘가에 포함. 같은 등급이면 짧은 이름이 먼저.
      const grade = k === q ? 300 : k.startsWith(q) ? 200 : 100
      best = Math.max(best, floor + grade - Math.min(k.length, 60) / 2)
    }
  }
  return best
}

/**
 * 검색 결과를 맞는 순서대로 돌려준다.
 *
 * 검색은 지도를 걸러내지 않는다. 현재 필터로 지도에 보이는 기관 안에서만 찾으므로
 * 결과를 고르면 그 기관이 지도에도 반드시 있다.
 */
export function rankedSearch(
  index: SearchIndexEntry[],
  query: string,
  visible: Institution[],
  limit = 12,
): Institution[] {
  const q = normalizeQuery(query)
  if (!q) return []
  const byId = new Map(index.map((e) => [e.id, e]))
  const scored: Array<{ inst: Institution; score: number }> = []
  for (const inst of visible) {
    const entry = byId.get(inst.id)
    if (!entry) continue
    const score = matchScore(entry, q)
    if (score > 0) scored.push({ inst, score })
  }
  scored.sort((a, b) => b.score - a.score || a.inst.officialName.localeCompare(b.inst.officialName, 'ko'))
  return scored.slice(0, limit).map((s) => s.inst)
}

// ---------------------------------------------------------------- 필터

export interface FilterContext {
  trainedIds: Set<string>
  searchIndex: SearchIndexEntry[]
}

export function applyFilters(data: Dataset, filters: Filters, ctx: FilterContext): Institution[] {
  // 검색어는 지도를 걸러내지 않는다. 결과 목록을 좁히는 데만 쓴다(rankedSearch).
  const selected = new Set(filters.subRegions)
  const kinds = new Set(filters.kinds)
  const traits = new Set(filters.traits)

  const out: Institution[] = []
  for (const inst of [...data.hospitals, ...data.schools] as Institution[]) {
    if (!kinds.has(inst.type)) continue
    if (selected.size > 0 && !(inst.subRegionId && selected.has(inst.subRegionId))) continue
    if (traits.size > 0) {
      if (!isHospital(inst)) continue
      const own = hospitalTraits(inst, ctx.trainedIds)
      // 서로 다른 특성은 AND 로 겹친다. "경기서남 + 대학병원 + 권역응급" 같은 조합을 위해서다.
      let ok = true
      for (const t of traits) if (!own.includes(t)) ok = false
      if (!ok) continue
    }
    out.push(inst)
  }
  return out
}

// ---------------------------------------------------------------- 통계

export interface Stats {
  total: number
  hospitals: number
  schools: number
  emergency: number
  tertiary: number
  universityHospitals: number
  withIntern: number
  withResident: number
  coordUnverified: number
}

export function computeStats(
  shown: Institution[],
  data: Dataset,
  trainedIds: Set<string>,
): Stats {
  // 병원마다 '모집 자료가 확인된 과정'을 모아 둔다. 모집 단위를 거치든 병원에 바로 붙든 같게 센다.
  const tracksByHospital = new Map<string, Set<string>>()
  for (const r of data.recruitment) {
    for (const hid of r.hospitalIds) {
      const set = tracksByHospital.get(hid) ?? new Set<string>()
      set.add(r.track)
      tracksByHospital.set(hid, set)
    }
  }

  // 기관 ID 로 세므로 한 기관이 두 대권역에 걸쳐도 중복 집계되지 않는다.
  const seen = new Set<string>()
  const s: Stats = {
    total: 0, hospitals: 0, schools: 0, emergency: 0, tertiary: 0,
    universityHospitals: 0, withIntern: 0, withResident: 0, coordUnverified: 0,
  }
  for (const inst of shown) {
    if (seen.has(inst.id)) continue
    seen.add(inst.id)
    s.total += 1
    if (inst.coord.status === '미확인') s.coordUnverified += 1
    if (isSchool(inst)) {
      s.schools += 1
      continue
    }
    s.hospitals += 1
    const traits = hospitalTraits(inst, trainedIds)
    if (traits.includes('tertiary')) s.tertiary += 1
    if (traits.includes('university')) s.universityHospitals += 1
    if (traits.includes('emergency')) s.emergency += 1
    const tracks = tracksByHospital.get(inst.id) ?? new Set<string>()
    if (tracks.has('인턴')) s.withIntern += 1
    if (tracks.has('레지던트')) s.withResident += 1
  }
  return s
}

// ---------------------------------------------------------------- 수련 모집

export interface RecruitmentSummary {
  unitId: string | null
  unitName: string
  year: number
  term: string
  integratedTraining: boolean
  memberHospitalIds: string[]
  memberSchoolIds: string[]
  /** 전체 명단을 확보하지 못한 연도에 붙는 경고 */
  coverageWarning: string | null
  sourceIds: string[]
  status: string
  intern: { quota: number | null; status: string }
  resident: {
    total: number | null
    bySpecialty: Array<{ specialty: string; quota: number; flexible: boolean }>
    /** 전공과별 내역을 아는지. 총원만 아는 경우와 구별한다. */
    specialtyBreakdownKnown: boolean
  }
}

/**
 * 한 기관의 모집 정보를 연도·학기·모집 단위로 묶는다.
 *
 * 의과대학도 모집 단위가 될 수 있다(예방의학과). 그래서 병원 ID 와 의과대학 ID 를 모두 본다.
 */
export function recruitmentFor(institutionId: string, data: Dataset): RecruitmentSummary[] {
  const mine = data.recruitment.filter(
    (r) => r.hospitalIds.includes(institutionId) || r.medicalSchoolIds.includes(institutionId),
  )
  if (mine.length === 0) return []

  const unitName = new Map(data.trainingUnits.map((u) => [u.id, u.name]))
  const groups = new Map<string, RecruitmentRecord[]>()
  for (const r of mine) {
    // 모집 단위를 아는 기록은 단위별로, 모르는 기록은 연도·학기별로 묶는다.
    const key = `${r.year}|${r.term}|${r.trainingUnitId ?? 'direct'}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }

  const out: RecruitmentSummary[] = []
  for (const [key, rs] of groups) {
    const [year, term, unitKey] = key.split('|')
    const unitId = unitKey === 'direct' ? null : unitKey
    const intern = rs.find((r) => r.track === '인턴')
    const resident = rs.filter((r) => r.track === '레지던트')
    const residentTotal = resident.length ? resident.reduce((a, r) => a + r.quota, 0) : null
    out.push({
      unitId,
      unitName: unitId ? (unitName.get(unitId) ?? unitId) : '병원 단위',
      year: Number(year),
      term,
      integratedTraining: rs.some((r) => r.integratedTraining) && unitId !== null,
      memberHospitalIds: rs[0].hospitalIds,
      memberSchoolIds: rs[0].medicalSchoolIds,
      coverageWarning: rs.find((r) => r.coverageWarning)?.coverageWarning ?? null,
      sourceIds: [...new Set(rs.map((r) => r.sourceId))],
      status: rs.every((r) => r.status === '확인됨') ? '확인됨' : '일부확인',
      intern: intern ? { quota: intern.quota, status: intern.status } : { quota: null, status: '미확인' },
      resident: {
        total: residentTotal,
        bySpecialty: resident
          .filter((r) => r.specialty && r.specialty !== '전공과별 미확인')
          .map((r) => ({ specialty: r.specialty as string, quota: r.quota, flexible: r.flexible }))
          .sort((a, b) => b.quota - a.quota || a.specialty.localeCompare(b.specialty, 'ko')),
        specialtyBreakdownKnown: resident.length === 0 || resident.some((r) => r.specialty !== '전공과별 미확인'),
      },
    })
  }
  return out.sort((a, b) => b.year - a.year || a.term.localeCompare(b.term, 'ko'))
}

// ---------------------------------------------------------------- 권역 하이라이트

/** 선택한 세부권역이 덮는 시군구 코드. 지도 하이라이트에 쓴다. */
export function highlightedSgg(regions: Regions, selected: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const sr of regions.subRegions) {
    if (!selected.has(sr.id)) continue
    for (const code of sr.sgg) out.add(code)
  }
  return out
}

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
    '상급종합병원으로 지정되지 않은 전공의 수련병원. 종별은 건강보험심사평가원이 공시한 공식 분류(종합병원·병원 등)를 쓰지만, "2차병원"이라는 묶음 자체는 이 사이트가 탐색 편의를 위해 정의한 것이다.',
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

/**
 * 가장 최근 지정 기준의 권역응급의료센터 지정.
 *
 * 지정은 3년마다 갱신되고 새 기수의 시행일이 아직 오지 않았을 수 있다. 그럴 때
 * 날짜만 보면 이미 교체가 확정된 옛 기수를 보여 주게 되므로, 데이터에 있는
 * 가장 나중 기수를 현재 지정으로 삼는다. 지난 기수는 pastEmergency 로 따로 본다.
 */
export function activeEmergency(h: Hospital) {
  return h.designations.emergency.filter((e) => e.isCurrent)
}

/** 현재 기수가 아닌 지난 지정 이력. 이번 기수에 빠진 기관은 여기에만 남는다. */
export function pastEmergency(h: Hospital) {
  return h.designations.emergency.filter((e) => !e.isCurrent)
}

/** 기준일에 유효한 상급종합병원 지정. */
export function activeTertiary(h: Hospital, asOf = AS_OF) {
  const t = h.designations.tertiary
  return t && t.validFrom <= asOf && asOf <= t.validTo ? t : null
}

/** 심평원 공시 종별 중 상급종합이 아닌 병원급. 2차병원 분류의 공식 근거다. */
const SECONDARY_KINDS = new Set(['종합병원', '병원', '정신병원', '요양병원', '치과병원', '한방병원'])

export function hospitalTraits(h: Hospital, trainedIds: Set<string>, asOf = AS_OF): HospitalTrait[] {
  const out: HospitalTrait[] = []
  const tertiary = activeTertiary(h, asOf)
  if (tertiary) out.push('tertiary')
  // 보건대학원·연구원처럼 요양기관이 아닌 수련기관은 병원이 아니므로 2차병원으로 묶지 않는다.
  else if (
    trainedIds.has(h.id) &&
    !h.institutionKind &&
    (h.hiraKind === null || SECONDARY_KINDS.has(h.hiraKind))
  )
    out.push('secondary')
  if (h.universityRelations.length > 0) out.push('university')
  if (activeEmergency(h).length > 0) out.push('emergency')
  return out
}

/** 전공의 모집 자료가 하나라도 있는 기관 ID. 2차병원 분류의 근거가 된다. */
export function hospitalsWithTraining(data: Pick<Dataset, 'trainingIndex'>): Set<string> {
  return new Set(Object.keys(data.trainingIndex))
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
  // 모집 자료가 확인된 과정은 색인에서 읽는다. 전체 모집 기록을 받기 전에도 통계가 맞는다.
  const tracksOf = (id: string) => data.trainingIndex[id]?.tracks ?? []

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
    const tracks = tracksOf(inst.id)
    if (tracks.includes('인턴')) s.withIntern += 1
    if (tracks.includes('레지던트')) s.withResident += 1
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
  sourceIds: string[]
  status: string
  /** '정원' 과 '모집인원' 은 다른 지표다. 화면에도 그대로 적는다. */
  quotaKind: string
  /** 기본정원·미충원 별도정원·정책적 별도정원 합계 */
  breakdown: Record<string, number> | null
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
  const mine = data.recruitment[institutionId] ?? []
  if (mine.length === 0) return []

  // 연도·학기·모집 단위가 같은 기록끼리 묶는다.
  const groups = new Map<string, RecruitmentRecord[]>()
  for (const r of mine) {
    const key = `${r.year}|${r.term}|${r.unitId ?? 'direct'}`
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
      unitName: rs[0].unitName ?? (unitId ?? '병원 단위'),
      year: Number(year),
      term,
      integratedTraining: rs.some((r) => r.integratedTraining === true),
      memberHospitalIds: rs.find((r) => r.unitHospitalIds)?.unitHospitalIds ?? [],
      sourceIds: [...new Set(rs.map((r) => r.sourceId))],
      status: rs.every((r) => r.status === '확인됨') ? '확인됨' : '일부확인',
      quotaKind: rs[0].quotaKind,
      breakdown: sumBreakdown(rs),
      intern: intern ? { quota: intern.quota, status: intern.status } : { quota: null, status: '미확인' },
      resident: {
        total: residentTotal,
        bySpecialty: resident
          .filter((r) => r.specialty && r.specialty !== '전공과별 미확인')
          .map((r) => ({ specialty: r.specialty as string, quota: r.quota, flexible: r.flexible === true }))
          .sort((a, b) => b.quota - a.quota || a.specialty.localeCompare(b.specialty, 'ko')),
        specialtyBreakdownKnown:
          resident.length === 0 || resident.some((r) => r.specialty && r.specialty !== '전공과별 미확인'),
      },
    })
  }
  // 가장 최근 시점이 맨 위로. 같은 해면 하반기가 상반기보다 뒤의 일이므로 먼저 온다.
  const termRank = (t: string) => (t === '하반기' ? 0 : 1)
  return out.sort((a, b) => b.year - a.year || termRank(a.term) - termRank(b.term))
}

function sumBreakdown(rs: RecruitmentRecord[]): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const r of rs) {
    for (const [k, v] of Object.entries(r.quotaBreakdown ?? {})) {
      if (v > 0) out[k] = (out[k] ?? 0) + v
    }
  }
  return Object.keys(out).length ? out : null
}

/** 선택한 세부권역이 덮는 시군구 코드. 지도 하이라이트에 쓴다. */
export function highlightedSgg(regions: Regions, selected: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const sr of regions.subRegions) {
    if (!selected.has(sr.id)) continue
    for (const code of sr.sgg) out.add(code)
  }
  return out
}

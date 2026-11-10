import { create } from 'zustand'
import type { Country, Coverage, Dataset, Discipline, Filters, HospitalTrait, Institution } from './types'
import { buildSearchIndex, hospitalsWithTraining, toggleMacro, toggleSub, type SearchIndexEntry } from './lib/domain'
import type { JapanFile } from './lib/japan'

const BASE = import.meta.env.BASE_URL

const EMPTY_FILTERS: Filters = {
  countries: ['KR'],
  disciplines: ['medical', 'dental'],
  subRegions: [],
  kinds: ['hospital', 'medicalSchool'],
  traits: [],
  query: '',
}

/** 좁은 화면에서는 필터가 드로어로 지도를 덮으므로 처음에는 닫아 둔다. */
const WIDE_SCREEN = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

export interface AppState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  data: Dataset | null
  coverage: Coverage | null
  trainedIds: Set<string>
  searchIndex: SearchIndexEntry[]
  filters: Filters
  selectedId: string | null
  /** 상세 패널에서 기관을 오갈 때 지도를 그 위치로 옮길지. 목록 클릭은 true, 뒤로 가기는 false. */
  flyToken: number
  /** 이번 이동은 화면 밖이 아니어도 그 기관을 가운데로 옮긴다(단과대학 탭 전환). */
  flyCenter: boolean
  /** 전체 모집 기록(큰 파일)을 받아 왔는지 */
  recruitmentState: 'idle' | 'loading' | 'ready' | 'error'
  filterPanelOpen: boolean
  /** 일본 데이터(약 800 KB)는 일본을 처음 켤 때 받는다 */
  japanState: 'idle' | 'loading' | 'ready' | 'error'

  load: () => Promise<void>
  loadJapan: () => Promise<void>
  setCountries: (c: Country[]) => void
  loadRecruitment: () => Promise<void>
  setQuery: (q: string) => void
  setKinds: (k: Filters['kinds']) => void
  setDisciplines: (d: Discipline[]) => void
  toggleTrait: (t: HospitalTrait) => void
  toggleSubRegion: (id: string) => void
  toggleMacroRegion: (id: string) => void
  clearFilters: () => void
  removeSubRegion: (id: string) => void
  select: (id: string | null, fly?: boolean, center?: boolean) => void
  setFilterPanelOpen: (v: boolean) => void
  applyUrl: (search: string) => void
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}data/${name}`)
  if (!res.ok) throw new Error(`${name} 을(를) 불러오지 못했습니다 (HTTP ${res.status})`)
  return (await res.json()) as T
}

export function serializeUrl(filters: Filters, selectedId: string | null): string {
  const p = new URLSearchParams()
  const countries = [...filters.countries].sort()
  if (!(countries.length === 1 && countries[0] === 'KR')) p.set('country', countries.join(',').toLowerCase())
  if (filters.subRegions.length) p.set('region', [...filters.subRegions].sort().join(','))
  if (filters.traits.length) p.set('trait', [...filters.traits].sort().join(','))
  if (filters.kinds.length === 1) p.set('kind', filters.kinds[0])
  if (filters.disciplines.length === 1) p.set('field', filters.disciplines[0])
  if (filters.query.trim()) p.set('q', filters.query.trim())
  if (selectedId) p.set('sel', selectedId)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function parseUrl(search: string): { filters: Filters; selectedId: string | null } {
  const p = new URLSearchParams(search)
  const kind = p.get('kind')
  const field = p.get('field')
  const sel = p.get('sel')
  const countries = (p.get('country') ?? 'kr')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c): c is Country => c === 'KR' || c === 'JP')
  // 일본 기관을 가리키는 링크로 들어오면 일본을 켠다.
  if (sel?.startsWith('jp-') && !countries.includes('JP')) countries.push('JP')
  return {
    filters: {
      countries: countries.length ? [...new Set(countries)] : ['KR'],
      disciplines: field === 'medical' || field === 'dental' ? [field] : ['medical', 'dental'],
      subRegions: (p.get('region') ?? '').split(',').filter(Boolean),
      traits: (p.get('trait') ?? '').split(',').filter(Boolean) as HospitalTrait[],
      kinds: kind === 'hospital' || kind === 'medicalSchool' ? [kind] : ['hospital', 'medicalSchool'],
      query: p.get('q') ?? '',
    },
    selectedId: sel,
  }
}

/**
 * URL 을 현재 상태에 맞춘다.
 *
 * 검색어는 글자를 칠 때마다 바뀌므로 히스토리를 쌓지 않고 현재 항목을 바꾼다(replace).
 * 기관 선택과 필터는 뒤로 가기로 되돌아갈 수 있어야 하므로 항목을 새로 쌓는다(push).
 */
function syncUrl(filters: Filters, selectedId: string | null, mode: 'push' | 'replace' = 'push') {
  const next = `${window.location.pathname}${serializeUrl(filters, selectedId)}`
  if (next === `${window.location.pathname}${window.location.search}`) return
  if (mode === 'replace') window.history.replaceState(null, '', next)
  else window.history.pushState(null, '', next)
}

export const useStore = create<AppState>((set, get) => ({
  status: 'loading',
  error: null,
  data: null,
  coverage: null,
  trainedIds: new Set(),
  searchIndex: [],
  filters: EMPTY_FILTERS,
  selectedId: null,
  flyToken: 0,
  flyCenter: false,
  recruitmentState: 'idle',
  filterPanelOpen: WIDE_SCREEN,
  japanState: 'idle',

  load: async () => {
    try {
      // 첫 화면에 필요한 것만 받는다. 모집 기록 전체(약 2 MB)는 상세 패널을 열 때 따로 받는다.
      const [hospitals, schools, relations, trainingUnits, trainingIndex, regions, sourcesDoc, coverage, networks] =
        await Promise.all([
          fetchJson<Dataset['hospitals']>('hospitals.json'),
          fetchJson<Dataset['schools']>('medical-schools.json'),
          fetchJson<Dataset['relations']>('institution-relations.json'),
          fetchJson<Dataset['trainingUnits']>('training-units.json'),
          fetchJson<Dataset['trainingIndex']>('recruitment-index.json'),
          fetchJson<Dataset['regions']>('regions.json'),
          fetchJson<{ sources: Dataset['sources'] }>('sources.json'),
          fetchJson<Coverage>('recruitment-coverage.json'),
          fetchJson<Dataset['networks']>('hospital-networks.json'),
        ])
      const data: Dataset = {
        hospitals, schools, relations, trainingUnits, trainingIndex, regions,
        recruitment: {},
        sources: sourcesDoc.sources,
        networks,
      }
      const fromUrl = parseUrl(window.location.search)
      set({
        status: 'ready',
        data,
        coverage,
        trainedIds: hospitalsWithTraining(data),
        searchIndex: buildSearchIndex(data),
        filters: fromUrl.filters,
        selectedId: fromUrl.selectedId,
        flyToken: fromUrl.selectedId ? 1 : 0,
      })
      if (fromUrl.selectedId) void get().loadRecruitment()
      if (fromUrl.filters.countries.includes('JP')) void get().loadJapan()
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  loadRecruitment: async () => {
    const { recruitmentState, data } = get()
    if (!data || recruitmentState === 'loading' || recruitmentState === 'ready') return
    set({ recruitmentState: 'loading' })
    try {
      const file = await fetchJson<{ byInstitution: Dataset['recruitment'] }>('residency-recruitment.json')
      set({ data: { ...get().data!, recruitment: file.byInstitution }, recruitmentState: 'ready' })
    } catch {
      set({ recruitmentState: 'error' })
    }
  },

  loadJapan: async () => {
    const { japanState, data } = get()
    if (!data || japanState === 'loading' || japanState === 'ready') return
    set({ japanState: 'loading' })
    try {
      const jp = await fetchJson<JapanFile>('jp.json')
      const cur = get().data!
      const known = new Set(cur.sources.map((x) => x.id))
      const merged: Dataset = {
        ...cur,
        hospitals: [...cur.hospitals, ...jp.hospitals],
        schools: [...cur.schools, ...jp.schools],
        relations: [...cur.relations, ...jp.relations],
        networks: [...cur.networks, ...jp.networks],
        regions: {
          meta: cur.regions.meta,
          macroRegions: [...cur.regions.macroRegions, ...jp.regions.macroRegions],
          subRegions: [...cur.regions.subRegions, ...jp.regions.subRegions],
        },
        sources: [...cur.sources, ...jp.sources.filter((x) => !known.has(x.id))],
      }
      set({ data: merged, searchIndex: buildSearchIndex(merged), japanState: 'ready' })
    } catch {
      set({ japanState: 'error' })
    }
  },
  setCountries: (countries) => {
    if (countries.length === 0) return
    if (countries.includes('JP')) void get().loadJapan()
    // 끈 나라의 지역·분류 선택은 함께 지운다. 화면에 안 보이는 조건이 남아 있으면 헷갈린다.
    const keepRegion = (id: string) => countries.includes(id.startsWith('jp-') ? 'JP' : 'KR')
    const keepTrait = (t: HospitalTrait) => countries.includes(t.startsWith('jp') ? 'JP' : 'KR')
    const cur = get().filters
    const filters = {
      ...cur,
      countries,
      subRegions: cur.subRegions.filter(keepRegion),
      traits: cur.traits.filter(keepTrait),
    }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  setQuery: (q) => {
    const filters = { ...get().filters, query: q }
    set({ filters })
    syncUrl(filters, get().selectedId, 'replace')
  },
  setKinds: (kinds) => {
    const filters = { ...get().filters, kinds }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  setDisciplines: (disciplines) => {
    const filters = { ...get().filters, disciplines }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  toggleTrait: (t) => {
    const cur = get().filters.traits
    const traits = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    const filters = { ...get().filters, traits }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  toggleSubRegion: (id) => {
    const next = toggleSub(id, new Set(get().filters.subRegions))
    const filters = { ...get().filters, subRegions: [...next] }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  toggleMacroRegion: (id) => {
    const { data, filters } = get()
    const macro = data?.regions.macroRegions.find((m) => m.id === id)
    if (!macro) return
    const next = toggleMacro(macro, new Set(filters.subRegions))
    const nf = { ...filters, subRegions: [...next] }
    set({ filters: nf })
    syncUrl(nf, get().selectedId)
  },
  removeSubRegion: (id) => {
    const filters = { ...get().filters, subRegions: get().filters.subRegions.filter((x) => x !== id) }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  clearFilters: () => {
    // 나라 선택은 '보는 범위'라서 초기화해도 유지한다.
    const filters = { ...EMPTY_FILTERS, countries: get().filters.countries }
    set({ filters })
    syncUrl(filters, get().selectedId)
  },
  select: (id, fly = true, center = false) => {
    if (id) void get().loadRecruitment()
    set((s) => ({
      selectedId: id,
      flyToken: fly ? s.flyToken + 1 : s.flyToken,
      flyCenter: fly && center,
      // 좁은 화면에서 상세 시트와 필터 드로어가 함께 열리면 지도가 가려진다.
      filterPanelOpen: id && !WIDE_SCREEN ? false : s.filterPanelOpen,
    }))
    syncUrl(get().filters, id)
  },
  setFilterPanelOpen: (v) => set({ filterPanelOpen: v }),

  applyUrl: (search) => {
    const { filters, selectedId } = parseUrl(search)
    set((s) => ({ filters, selectedId, flyToken: s.flyToken + 1, flyCenter: false }))
    // 뒤로·앞으로 가기로 선택 상태에 돌아왔을 때도 수련 탭이 비지 않게 한다.
    if (selectedId) void get().loadRecruitment()
    if (filters.countries.includes('JP')) void get().loadJapan()
  },
}))

export function selectedInstitution(state: AppState): Institution | null {
  if (!state.data || !state.selectedId) return null
  return (
    state.data.hospitals.find((h) => h.id === state.selectedId) ??
    state.data.schools.find((s) => s.id === state.selectedId) ??
    null
  )
}

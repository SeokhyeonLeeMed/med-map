import { create } from 'zustand'
import type { Coverage, Dataset, Filters, HospitalTrait, Institution } from './types'
import { buildSearchIndex, hospitalsWithTraining, toggleMacro, toggleSub, type SearchIndexEntry } from './lib/domain'

const BASE = import.meta.env.BASE_URL

const EMPTY_FILTERS: Filters = { subRegions: [], kinds: ['hospital', 'medicalSchool'], traits: [], query: '' }

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
  filterPanelOpen: boolean

  load: () => Promise<void>
  setQuery: (q: string) => void
  setKinds: (k: Filters['kinds']) => void
  toggleTrait: (t: HospitalTrait) => void
  toggleSubRegion: (id: string) => void
  toggleMacroRegion: (id: string) => void
  clearFilters: () => void
  removeSubRegion: (id: string) => void
  select: (id: string | null, fly?: boolean) => void
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
  if (filters.subRegions.length) p.set('region', [...filters.subRegions].sort().join(','))
  if (filters.traits.length) p.set('trait', [...filters.traits].sort().join(','))
  if (filters.kinds.length === 1) p.set('kind', filters.kinds[0])
  if (filters.query.trim()) p.set('q', filters.query.trim())
  if (selectedId) p.set('sel', selectedId)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function parseUrl(search: string): { filters: Filters; selectedId: string | null } {
  const p = new URLSearchParams(search)
  const kind = p.get('kind')
  return {
    filters: {
      subRegions: (p.get('region') ?? '').split(',').filter(Boolean),
      traits: (p.get('trait') ?? '').split(',').filter(Boolean) as HospitalTrait[],
      kinds: kind === 'hospital' || kind === 'medicalSchool' ? [kind] : ['hospital', 'medicalSchool'],
      query: p.get('q') ?? '',
    },
    selectedId: p.get('sel'),
  }
}

function pushUrl(filters: Filters, selectedId: string | null) {
  const next = `${window.location.pathname}${serializeUrl(filters, selectedId)}`
  if (next !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState(null, '', next)
  }
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
  filterPanelOpen: WIDE_SCREEN,

  load: async () => {
    try {
      const [hospitals, schools, relations, trainingUnits, recruitment, regions, sourcesDoc, coverage] = await Promise.all([
        fetchJson<Dataset['hospitals']>('hospitals.json'),
        fetchJson<Dataset['schools']>('medical-schools.json'),
        fetchJson<Dataset['relations']>('institution-relations.json'),
        fetchJson<Dataset['trainingUnits']>('training-units.json'),
        fetchJson<Dataset['recruitment']>('residency-recruitment.json'),
        fetchJson<Dataset['regions']>('regions.json'),
        fetchJson<{ sources: Dataset['sources'] }>('sources.json'),
        fetchJson<Coverage>('recruitment-coverage.json'),
      ])
      const data: Dataset = {
        hospitals, schools, relations, trainingUnits, recruitment, regions,
        sources: sourcesDoc.sources,
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
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },

  setQuery: (q) => {
    const filters = { ...get().filters, query: q }
    set({ filters })
    pushUrl(filters, get().selectedId)
  },
  setKinds: (kinds) => {
    const filters = { ...get().filters, kinds }
    set({ filters })
    pushUrl(filters, get().selectedId)
  },
  toggleTrait: (t) => {
    const cur = get().filters.traits
    const traits = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    const filters = { ...get().filters, traits }
    set({ filters })
    pushUrl(filters, get().selectedId)
  },
  toggleSubRegion: (id) => {
    const next = toggleSub(id, new Set(get().filters.subRegions))
    const filters = { ...get().filters, subRegions: [...next] }
    set({ filters })
    pushUrl(filters, get().selectedId)
  },
  toggleMacroRegion: (id) => {
    const { data, filters } = get()
    const macro = data?.regions.macroRegions.find((m) => m.id === id)
    if (!macro) return
    const next = toggleMacro(macro, new Set(filters.subRegions))
    const nf = { ...filters, subRegions: [...next] }
    set({ filters: nf })
    pushUrl(nf, get().selectedId)
  },
  removeSubRegion: (id) => {
    const filters = { ...get().filters, subRegions: get().filters.subRegions.filter((x) => x !== id) }
    set({ filters })
    pushUrl(filters, get().selectedId)
  },
  clearFilters: () => {
    set({ filters: EMPTY_FILTERS })
    pushUrl(EMPTY_FILTERS, get().selectedId)
  },
  select: (id, fly = true) => {
    set((s) => ({
      selectedId: id,
      flyToken: fly ? s.flyToken + 1 : s.flyToken,
      // 좁은 화면에서 상세 시트와 필터 드로어가 함께 열리면 지도가 가려진다.
      filterPanelOpen: id && !WIDE_SCREEN ? false : s.filterPanelOpen,
    }))
    pushUrl(get().filters, id)
  },
  setFilterPanelOpen: (v) => set({ filterPanelOpen: v }),

  applyUrl: (search) => {
    const { filters, selectedId } = parseUrl(search)
    set((s) => ({ filters, selectedId, flyToken: s.flyToken + 1 }))
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

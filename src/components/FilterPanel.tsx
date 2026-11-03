import { useMemo, useState } from 'react'
import type { Country, Dataset, Filters, HospitalTrait, Institution, MacroRegion } from '../types'
import {
  applyFilters,
  COUNTRY_LABEL,
  countryOf,
  hospitalTraits,
  isHospital,
  macroState,
  normalizeQuery,
  TRAIT_DEFINITION,
  TRAIT_LABEL,
  TRAITS_BY_COUNTRY,
} from '../lib/domain'
import { useStore } from '../store'

const COUNTRIES: Country[] = ['KR', 'JP']

/**
 * 필터 패널.
 *
 * 위에서부터 '무엇을 볼지(나라·기관 종류)' → '어떤 병원(분류)' → '어디(지역)' 순서로 좁혀 간다.
 * 선택지마다 지금 조건에서 몇 곳이 남는지 숫자를 붙여, 누르기 전에 결과를 짐작할 수 있게 한다.
 */
export function FilterPanel() {
  const data = useStore((s) => s.data)
  const filters = useStore((s) => s.filters)
  const trainedIds = useStore((s) => s.trainedIds)
  const searchIndex = useStore((s) => s.searchIndex)
  const japanState = useStore((s) => s.japanState)
  const setCountries = useStore((s) => s.setCountries)
  const setKinds = useStore((s) => s.setKinds)
  const toggleTrait = useStore((s) => s.toggleTrait)
  const clearFilters = useStore((s) => s.clearFilters)
  const ctx = useMemo(() => ({ trainedIds, searchIndex }), [trainedIds, searchIndex])

  // 각 선택지의 '이것을 고르면 몇 곳' 숫자. 그 선택지가 속한 조건만 비우고 나머지 조건은 그대로 둔 채 센다.
  const counts = useMemo(() => {
    if (!data) return null
    const run = (f: Filters) => applyFilters(data, f, ctx)
    const byCountry = new Map<Country, number>()
    for (const inst of run({ ...filters, countries: COUNTRIES })) {
      const c = countryOf(inst)
      byCountry.set(c, (byCountry.get(c) ?? 0) + 1)
    }
    const kindBase = run({ ...filters, kinds: ['hospital', 'medicalSchool'] })
    const byKind = {
      hospital: kindBase.filter(isHospital).length,
      medicalSchool: kindBase.filter((i) => !isHospital(i)).length,
    }
    const byTrait = new Map<HospitalTrait, number>()
    for (const inst of run({ ...filters, traits: [] })) {
      if (!isHospital(inst)) continue
      for (const t of hospitalTraits(inst, trainedIds)) byTrait.set(t, (byTrait.get(t) ?? 0) + 1)
    }
    const bySub = new Map<string, number>()
    for (const inst of run({ ...filters, subRegions: [] })) {
      if (inst.subRegionId) bySub.set(inst.subRegionId, (bySub.get(inst.subRegionId) ?? 0) + 1)
    }
    return { byCountry, byKind, byTrait, bySub }
  }, [data, filters, ctx, trainedIds])

  if (!data || !counts) return null
  const shownCountries = COUNTRIES.filter((c) => filters.countries.includes(c))
  const both = shownCountries.length > 1
  const activeCount = filters.subRegions.length + filters.traits.length + (filters.kinds.length < 2 ? 1 : 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
          필터
          {activeCount > 0 && (
            <span className="ml-1.5 rounded-full bg-brand px-1.5 py-px font-num text-[10px] text-white">{activeCount}</span>
          )}
        </h2>
        <button
          onClick={clearFilters}
          disabled={activeCount === 0}
          className="rounded px-1.5 py-0.5 text-2xs text-ink-mute underline-offset-2 hover:text-ink hover:underline disabled:opacity-40 disabled:hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          조건 초기화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        <Section title="나라" hint="둘 다 켜면 한 지도에서 함께 봅니다.">
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="나라">
            {COUNTRIES.map((c) => {
              const on = filters.countries.includes(c)
              const only = on && filters.countries.length === 1
              return (
                <Toggle
                  key={c}
                  on={on}
                  disabled={only}
                  title={only ? '나라는 하나 이상 켜 두어야 합니다' : undefined}
                  onClick={() =>
                    setCountries(on ? filters.countries.filter((x) => x !== c) : [...filters.countries, c])
                  }
                  label={COUNTRY_LABEL[c]}
                  count={c === 'JP' && japanState !== 'ready' ? null : counts.byCountry.get(c) ?? 0}
                  loading={c === 'JP' && japanState === 'loading'}
                />
              )
            })}
          </div>
          {japanState === 'error' && (
            <p className="mt-1.5 text-2xs text-alert">일본 자료를 불러오지 못했습니다. 일본을 껐다 다시 켜 보세요.</p>
          )}
        </Section>

        <Section title="기관 종류">
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="기관 종류">
            {(['hospital', 'medicalSchool'] as const).map((k) => {
              const on = filters.kinds.includes(k)
              const only = on && filters.kinds.length === 1
              return (
                <Toggle
                  key={k}
                  on={on}
                  disabled={only}
                  title={only ? '하나 이상 켜 두어야 합니다' : undefined}
                  onClick={() => setKinds(on ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k])}
                  label={k === 'hospital' ? '병원' : '의과대학'}
                  count={counts.byKind[k]}
                />
              )
            })}
          </div>
        </Section>

        {filters.kinds.includes('hospital') && (
          <Section
            title="병원 분류"
            hint="여러 개를 고르면 모두 해당하는 병원만 남습니다. 나라마다 따로 적용됩니다."
          >
            {shownCountries.map((c) => (
              <div key={c} className={both ? 'mb-2' : ''}>
                {both && <p className="mb-1 text-2xs font-medium text-ink-mute">{COUNTRY_LABEL[c]}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {TRAITS_BY_COUNTRY[c].map((t) => (
                    <Chip
                      key={t}
                      on={filters.traits.includes(t)}
                      onClick={() => toggleTrait(t)}
                      label={TRAIT_LABEL[t]}
                      count={counts.byTrait.get(t) ?? 0}
                    />
                  ))}
                </div>
              </div>
            ))}
            <details className="mt-1 text-2xs text-ink-faint">
              <summary className="cursor-pointer select-none text-ink-mute hover:text-ink">분류 기준 보기</summary>
              <dl className="mt-1.5 space-y-1.5">
                {shownCountries.flatMap((c) =>
                  TRAITS_BY_COUNTRY[c].map((t) => (
                    <div key={t}>
                      <dt className="font-medium text-ink-soft">{TRAIT_LABEL[t]}</dt>
                      <dd className="leading-snug">{TRAIT_DEFINITION[t]}</dd>
                    </div>
                  )),
                )}
              </dl>
            </details>
          </Section>
        )}

        <Regions data={data} filters={filters} bySub={counts.bySub} countries={shownCountries} />
      </div>
    </div>
  )
}

function Regions({
  data,
  filters,
  bySub,
  countries,
}: {
  data: Dataset
  filters: Filters
  bySub: Map<string, number>
  countries: Country[]
}) {
  const toggleSubRegion = useStore((s) => s.toggleSubRegion)
  const toggleMacroRegion = useStore((s) => s.toggleMacroRegion)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const selected = useMemo(() => new Set(filters.subRegions), [filters.subRegions])
  const subById = useMemo(() => new Map(data.regions.subRegions.map((s) => [s.id, s])), [data])
  const q = normalizeQuery(query)

  const groups = countries.map((c) => {
    const macros = data.regions.macroRegions.filter((m) => (m.id.startsWith('jp-') ? 'JP' : 'KR') === c)
    const rows = macros
      .map((m) => {
        const subs = m.subRegions.map((id) => subById.get(id)!).filter(Boolean)
        const macroHit = !q || normalizeQuery(m.name + m.officialName).includes(q)
        const subHits = subs.filter((s) => macroHit || normalizeQuery(s.name + (s.note ?? '')).includes(q))
        const total = subs.reduce((a, s) => a + (bySub.get(s.id) ?? 0), 0)
        return { m, subs: subHits, total, visible: macroHit || subHits.length > 0 }
      })
      .filter((r) => r.visible)
    return { c, rows }
  })

  const toggleOpen = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Section title="지역" hint="큰 지역을 누르면 그 안의 지역이 모두 켜집니다. ▸ 를 눌러 펼칩니다.">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="지역 이름으로 찾기 (예: 경기, 東京, 横浜)"
        aria-label="지역 이름으로 찾기"
        className="mb-2 w-full rounded border border-line bg-white px-2 py-1 text-xs placeholder:text-ink-faint focus:border-brand focus:outline-none"
      />
      {groups.map(({ c, rows }) => (
        <div key={c} className="mb-2">
          {countries.length > 1 && (
            <p className="mb-1 text-2xs font-medium text-ink-mute">
              {COUNTRY_LABEL[c]} <span className="text-ink-faint">· {c === 'KR' ? '광역 → 응급의료권역' : '都道府県 → 市区町村'}</span>
            </p>
          )}
          {rows.length === 0 && <p className="px-1.5 text-2xs text-ink-faint">맞는 지역이 없습니다.</p>}
          <ul className="space-y-px">
            {rows.map(({ m, subs, total }) => (
              <MacroRow
                key={m.id}
                macro={m}
                subs={subs}
                total={total}
                // 한국은 권역이 적어 처음부터 펼쳐 두고, 시구정촌이 많은 일본은 접어 둔다. ▶ 로 반대로 바꾼다.
                expanded={(c === 'KR') !== open.has(m.id) || !!q || macroState(m, selected) === 'partial'}
                onExpand={() => toggleOpen(m.id)}
                selected={selected}
                bySub={bySub}
                onToggleMacro={() => toggleMacroRegion(m.id)}
                onToggleSub={toggleSubRegion}
              />
            ))}
          </ul>
        </div>
      ))}
    </Section>
  )
}

function MacroRow({
  macro,
  subs,
  total,
  expanded,
  onExpand,
  selected,
  bySub,
  onToggleMacro,
  onToggleSub,
}: {
  macro: MacroRegion
  subs: Array<{ id: string; name: string; macroRegions: string[] }>
  total: number
  expanded: boolean
  onExpand: () => void
  selected: Set<string>
  bySub: Map<string, number>
  onToggleMacro: () => void
  onToggleSub: (id: string) => void
}) {
  const st = macroState(macro, selected)
  const picked = macro.subRegions.filter((s) => selected.has(s)).length
  return (
    <li>
      <div className="flex items-center rounded hover:bg-paper-sunk">
        <button
          onClick={onExpand}
          aria-expanded={expanded}
          aria-label={`하위 지역 ${expanded ? '접기' : '펼치기'}: ${macro.name}`}
          className="grid h-6 w-5 shrink-0 place-items-center text-ink-faint hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <span className={'text-[10px] transition-transform ' + (expanded ? 'rotate-90' : '')}>▶</span>
        </button>
        <button
          onClick={onToggleMacro}
          aria-pressed={st === 'all'}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <TriBox state={st} />
          <span className="truncate font-medium">{macro.name}</span>
          {picked > 0 && st !== 'all' && (
            <span className="shrink-0 font-num text-[10px] text-brand">
              {picked}/{macro.subRegions.length}
            </span>
          )}
          <span className="ml-auto font-num text-2xs tabular-nums text-ink-faint">{total}</span>
        </button>
      </div>
      {expanded && (
        <ul className="ml-[26px] border-l border-line pl-2">
          {subs.map((sr) => (
            <li key={sr.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-[3px] hover:bg-paper-sunk">
                <input
                  type="checkbox"
                  className="h-[14px] w-[14px] shrink-0 accent-brand"
                  checked={selected.has(sr.id)}
                  onChange={() => onToggleSub(sr.id)}
                />
                <span className="truncate">{sr.name}</span>
                {sr.macroRegions.length > 1 && (
                  <span
                    className="rounded-sm border border-line-strong px-1 text-[10px] text-ink-faint"
                    title={`${sr.macroRegions.length}개 대권역에 함께 속합니다`}
                  >
                    공유
                  </span>
                )}
                <span className="ml-auto font-num text-2xs tabular-nums text-ink-faint">{bySub.get(sr.id) ?? 0}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function TriBox({ state }: { state: 'all' | 'partial' | 'none' }) {
  return (
    <span
      className={
        'inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border transition-colors ' +
        (state === 'all'
          ? 'border-brand bg-brand text-white'
          : state === 'partial'
            ? 'border-brand bg-brand-soft text-brand'
            : 'border-line-strong bg-white text-transparent')
      }
      aria-hidden="true"
    >
      {state === 'all' ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.3 L5 8.6 L9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : state === 'partial' ? (
        <span className="h-[2px] w-[7px] rounded bg-current" />
      ) : null}
    </span>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
      {hint && <p className="mt-1.5 text-2xs leading-snug text-ink-faint">{hint}</p>}
    </section>
  )
}

/** 켜고 끄는 큰 버튼(나라·기관 종류). 켜진 상태가 체크 표시로도 보인다. */
function Toggle({
  on,
  disabled,
  title,
  onClick,
  label,
  count,
  loading,
}: {
  on: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  label: string
  count: number | null
  loading?: boolean
}) {
  return (
    <button
      onClick={() => {
        if (!disabled) onClick()
      }}
      aria-pressed={on}
      aria-disabled={disabled}
      title={title}
      className={
        'flex items-center gap-1.5 rounded border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
        (on ? 'border-brand bg-brand-soft text-ink' : 'border-line bg-white text-ink-mute hover:border-line-strong') +
        (disabled ? ' cursor-default' : '')
      }
    >
      <span
        className={
          'grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] border ' +
          (on ? 'border-brand bg-brand text-white' : 'border-line-strong bg-white')
        }
        aria-hidden="true"
      >
        {on && (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M2.5 6.3 L5 8.6 L9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto font-num text-2xs tabular-nums text-ink-faint">
        {loading ? '…' : count == null ? '' : count}
      </span>
    </button>
  )
}

/** 병원 분류 칩. 숫자는 그 분류를 켰을 때 남는 병원 수다. */
function Chip({ on, onClick, label, count }: { on: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
        (on
          ? 'border-brand bg-brand text-white'
          : count === 0
            ? 'border-line bg-white text-ink-faint'
            : 'border-line-strong bg-white text-ink-soft hover:border-brand/60')
      }
    >
      {label}
      <span className={'font-num text-[10px] tabular-nums ' + (on ? 'text-white/80' : 'text-ink-faint')}>{count}</span>
    </button>
  )
}

export type { Institution }

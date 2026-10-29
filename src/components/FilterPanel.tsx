import { useMemo } from 'react'
import type { HospitalTrait, Institution } from '../types'
import { macroState, TRAIT_DEFINITION, TRAIT_LABEL } from '../lib/domain'
import { useStore } from '../store'

const TRAITS: HospitalTrait[] = ['tertiary', 'secondary', 'university', 'emergency']

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

export function FilterPanel({ shown }: { shown: Institution[] }) {
  const data = useStore((s) => s.data)
  const filters = useStore((s) => s.filters)
  const toggleSubRegion = useStore((s) => s.toggleSubRegion)
  const toggleMacroRegion = useStore((s) => s.toggleMacroRegion)
  const toggleTrait = useStore((s) => s.toggleTrait)
  const setKinds = useStore((s) => s.setKinds)
  const clearFilters = useStore((s) => s.clearFilters)

  const selected = useMemo(() => new Set(filters.subRegions), [filters.subRegions])
  const countBySub = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of shown) if (i.subRegionId) m.set(i.subRegionId, (m.get(i.subRegionId) ?? 0) + 1)
    return m
  }, [shown])

  if (!data) return null
  const subById = new Map(data.regions.subRegions.map((s) => [s.id, s]))
  const kindAll = filters.kinds.length === 2

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">필터</h2>
        <button
          onClick={clearFilters}
          className="rounded px-1.5 py-0.5 text-2xs text-ink-mute underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          초기화
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        <Section title="기관 유형">
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="기관 유형">
            <Seg active={kindAll} onClick={() => setKinds(['hospital', 'medicalSchool'])}>
              전체
            </Seg>
            <Seg active={!kindAll && filters.kinds[0] === 'hospital'} onClick={() => setKinds(['hospital'])}>
              병원
            </Seg>
            <Seg active={!kindAll && filters.kinds[0] === 'medicalSchool'} onClick={() => setKinds(['medicalSchool'])}>
              의과대학
            </Seg>
          </div>
        </Section>

        <Section title="병원 유형 및 특성">
          <ul className="space-y-0.5">
            {TRAITS.map((t) => (
              <li key={t}>
                <label className="group flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-paper-sunk">
                  <input
                    type="checkbox"
                    className="mt-[3px] h-[15px] w-[15px] shrink-0 accent-brand"
                    checked={filters.traits.includes(t)}
                    onChange={() => toggleTrait(t)}
                  />
                  <span className="min-w-0">
                    <span className="block leading-snug">{TRAIT_LABEL[t]}</span>
                    <span className="mt-0.5 block text-2xs leading-snug text-ink-faint">{TRAIT_DEFINITION[t]}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 px-1.5 text-2xs leading-snug text-ink-faint">
            여러 특성을 함께 고르면 모두 해당하는 기관만 남습니다.
          </p>
        </Section>

        <Section title="권역">
          <ul className="space-y-px">
            {data.regions.macroRegions.map((m) => {
              const st = macroState(m, selected)
              return (
                <li key={m.id}>
                  <button
                    onClick={() => toggleMacroRegion(m.id)}
                    aria-pressed={st === 'all'}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-paper-sunk focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <TriBox state={st} />
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-auto font-num text-2xs text-ink-faint">{m.officialName}</span>
                  </button>
                  <ul className="ml-[22px] border-l border-line pl-2">
                    {m.subRegions.map((sid) => {
                      const sr = subById.get(sid)!
                      const dual = sr.macroRegions.length > 1
                      return (
                        <li key={sid}>
                          <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-[3px] hover:bg-paper-sunk">
                            <input
                              type="checkbox"
                              className="h-[14px] w-[14px] shrink-0 accent-brand"
                              checked={selected.has(sid)}
                              onChange={() => toggleSubRegion(sid)}
                            />
                            <span className="truncate">{sr.name}</span>
                            {dual && (
                              <span
                                className="rounded-sm border border-line-strong px-1 text-[10px] text-ink-faint"
                                title={`${sr.macroRegions.length}개 대권역에 함께 속합니다`}
                              >
                                공유
                              </span>
                            )}
                            <span className="ml-auto font-num text-2xs tabular-nums text-ink-faint">
                              {countBySub.get(sid) ?? 0}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  )
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded border px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
        (active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink-soft hover:border-line-strong')
      }
    >
      {children}
    </button>
  )
}

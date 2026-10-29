import { useEffect, useRef, useState } from 'react'
import type { Institution } from '../types'
import { isHospital, rankedSearch } from '../lib/domain'
import { useStore } from '../store'

const AS_OF_LABEL = '2026-10-29'

export function Header({ shown, total }: { shown: Institution[]; total: number }) {
  const query = useStore((s) => s.filters.query)
  const setQuery = useStore((s) => s.setQuery)
  const select = useStore((s) => s.select)
  const filterPanelOpen = useStore((s) => s.filterPanelOpen)
  const setFilterPanelOpen = useStore((s) => s.setFilterPanelOpen)
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchIndex = useStore((s) => s.searchIndex)
  // 현재 지도에 보이는 기관 안에서만 찾는다. 고른 결과가 지도에 없는 일이 생기지 않는다.
  const results = rankedSearch(searchIndex, query, shown)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const choose = (inst: Institution) => {
    select(inst.id)
    setOpen(false)
  }

  return (
    <header className="z-30 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-paper-raised px-3 py-2 md:px-4">
      <button
        onClick={() => setFilterPanelOpen(!filterPanelOpen)}
        aria-expanded={filterPanelOpen}
        aria-label="필터 패널 접기/펼치기"
        className="rounded border border-line p-1.5 text-ink-mute hover:border-line-strong hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:hidden"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-ink">메디컬 맵</h1>
        <p className="hidden truncate text-2xs text-ink-mute sm:block">의과대학 · 전공의 수련병원</p>
      </div>

      <div ref={boxRef} className="relative order-last w-full min-w-0 flex-1 basis-full md:order-none md:basis-auto">
        <label htmlFor="q" className="sr-only">기관 검색</label>
        <input
          id="q"
          ref={inputRef}
          type="search"
          value={query}
          placeholder="기관명 · 약칭 · 지역 · 관련 대학으로 검색  ( / )"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setCursor(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!results.length) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); choose(results[cursor]) }
            else if (e.key === 'Escape') setOpen(false)
          }}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="search-results"
          aria-autocomplete="list"
          className="w-full rounded border border-line bg-paper px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        {open && query.trim() !== '' && (
          <ul
            id="search-results"
            role="listbox"
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded border border-line bg-paper-raised shadow-lg"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2.5 text-xs text-ink-mute">
                현재 필터 안에 맞는 기관이 없습니다. 권역·특성 필터를 지우면 더 넓게 찾습니다.
              </li>
            ) : (
              results.map((r, i) => (
                <li key={r.id} role="option" aria-selected={i === cursor}>
                  <button
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(r)}
                    className={'flex w-full items-center gap-2 px-3 py-1.5 text-left ' + (i === cursor ? 'bg-brand-soft' : '')}
                  >
                    <span
                      className={'h-2 w-2 shrink-0 ' + (isHospital(r) ? 'rounded-full bg-hosp' : 'rounded-[2px] bg-school')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{r.officialName}</span>
                    <span className="shrink-0 text-2xs text-ink-faint">
                      {isHospital(r) ? '병원' : '의과대학'} · {r.sggName ?? '소재지 미확인'}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <dl className="ml-auto hidden shrink-0 items-baseline gap-3 text-2xs text-ink-mute md:flex">
        <div className="flex items-baseline gap-1">
          <dt>표시</dt>
          <dd className="font-num text-sm font-semibold tabular-nums text-ink">{shown.length}</dd>
          <dd className="text-ink-faint">/ {total}</dd>
        </div>
        <div className="flex items-baseline gap-1 border-l border-line pl-3">
          <dt>기준일</dt>
          <dd className="font-num tabular-nums">{AS_OF_LABEL}</dd>
        </div>
      </dl>
    </header>
  )
}

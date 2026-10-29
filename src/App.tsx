import { useEffect, useMemo } from 'react'
import { DetailPanel } from './components/DetailPanel'
import { FilterPanel } from './components/FilterPanel'
import { Header } from './components/Header'
import { Legend } from './components/Legend'
import { MapView } from './components/MapView'
import { StatsBar } from './components/StatsBar'
import { applyFilters } from './lib/domain'
import { selectedInstitution, useStore } from './store'

export default function App() {
  const state = useStore()
  const { status, error, data, filters, trainedIds, searchIndex, filterPanelOpen } = state

  useEffect(() => {
    void state.load()
    const onPop = () => state.applyUrl(window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // 최초 1회만 실행한다. store 액션은 안정적인 참조다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(
    () => (data ? applyFilters(data, filters, { trainedIds, searchIndex }) : []),
    [data, filters, trainedIds, searchIndex],
  )
  const selected = selectedInstitution(state)
  const total = data ? data.hospitals.length + data.schools.length : 0

  if (status === 'loading') return <Skeleton />
  if (status === 'error' || !data) return <ErrorScreen message={error} />

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <Header shown={shown} total={total} />
      <StatsBar shown={shown} />

      <div className="relative flex min-h-0 flex-1">
        {/* 필터: 데스크톱은 고정 열, 좁은 화면은 드로어 */}
        <div
          className={
            'z-20 w-[272px] shrink-0 border-r border-line bg-paper-raised transition-transform ' +
            'max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-xl ' +
            (filterPanelOpen ? 'lg:block' : 'lg:hidden ') +
            (filterPanelOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full')
          }
        >
          <FilterPanel shown={shown} />
        </div>
        {filterPanelOpen && (
          <button
            className="absolute inset-0 z-10 bg-ink/20 lg:hidden"
            aria-label="필터 닫기"
            onClick={() => state.setFilterPanelOpen(false)}
          />
        )}

        <div className="relative min-w-0 flex-1">
          <MapView shown={shown} />
          <Legend />
          <button
            onClick={() => state.setFilterPanelOpen(!filterPanelOpen)}
            className="absolute left-3 top-3 z-10 hidden rounded border border-line bg-paper-raised/95 px-2 py-1 text-2xs text-ink-soft shadow-sm backdrop-blur hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand lg:block"
          >
            {filterPanelOpen ? '필터 접기' : '필터 펼치기'}
          </button>
          {shown.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center px-4">
              <p className="pointer-events-auto max-w-sm rounded border border-line bg-paper-raised/97 p-3 text-center text-xs leading-relaxed text-ink-soft shadow-sm backdrop-blur">
                조건에 맞는 기관이 없습니다. 권역이나 병원 특성을 하나씩 해제해 보세요.
                <button onClick={state.clearFilters} className="ml-1 text-brand underline">
                  필터 초기화
                </button>
              </p>
            </div>
          )}
        </div>

        {/* 상세: 데스크톱은 오른쪽 열, 좁은 화면은 하단 시트 */}
        {selected && (
          <div
            className={
              'z-20 shrink-0 border-line bg-paper-raised ' +
              'lg:w-[370px] lg:border-l ' +
              'max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:top-auto max-lg:h-[55%] max-lg:rounded-t-xl max-lg:border-t max-lg:shadow-2xl'
            }
          >
            <DetailPanel institution={selected} />
          </div>
        )}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex h-dvh flex-col bg-paper" aria-busy="true" aria-live="polite">
      <div className="h-12 shrink-0 border-b border-line bg-paper-raised" />
      <div className="h-10 shrink-0 border-b border-line bg-paper-raised" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[272px] shrink-0 space-y-2 border-r border-line bg-paper-raised p-4 lg:block">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-paper-sunk" />
          ))}
        </div>
        <div className="grid flex-1 place-items-center">
          <p className="text-sm text-ink-mute">데이터를 불러오는 중입니다…</p>
        </div>
      </div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string | null }) {
  return (
    <div className="grid h-dvh place-items-center bg-paper px-6">
      <div className="max-w-md text-center">
        <h1 className="text-base font-semibold text-ink">데이터를 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{message ?? '알 수 없는 오류'}</p>
        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
          개발 서버에서 띄웠다면 <code className="rounded bg-paper-sunk px-1">npm run build:data</code> 로 데이터를 먼저
          생성했는지 확인해 주세요. 배포본이라면 잠시 뒤 새로고침해 보세요.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded border border-brand bg-brand px-3 py-1.5 text-sm text-white"
        >
          새로고침
        </button>
      </div>
    </div>
  )
}

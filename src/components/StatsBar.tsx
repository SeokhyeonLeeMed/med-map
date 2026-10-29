import type { Institution } from '../types'
import { computeStats } from '../lib/domain'
import { useStore } from '../store'

export function StatsBar({ shown }: { shown: Institution[] }) {
  const data = useStore((s) => s.data)
  const trainedIds = useStore((s) => s.trainedIds)
  const filters = useStore((s) => s.filters)
  const removeSubRegion = useStore((s) => s.removeSubRegion)
  const toggleTrait = useStore((s) => s.toggleTrait)
  const clearFilters = useStore((s) => s.clearFilters)
  if (!data) return null

  const s = computeStats(shown, data, trainedIds)
  const subById = new Map(data.regions.subRegions.map((x) => [x.id, x]))
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [
    ...filters.subRegions.map((id) => ({
      key: `r:${id}`,
      label: subById.get(id)?.name ?? id,
      onRemove: () => removeSubRegion(id),
    })),
    ...filters.traits.map((t) => ({
      key: `t:${t}`,
      label: { tertiary: '상급종합', secondary: '2차병원', university: '대학병원', emergency: '권역응급' }[t],
      onRemove: () => toggleTrait(t),
    })),
  ]

  return (
    <div className="shrink-0 border-b border-line bg-paper-raised">
      {/* 좁은 화면에서는 줄바꿈 대신 가로 스크롤로 한 줄을 유지해 지도 높이를 지킨다 */}
      <dl className="flex items-baseline gap-x-4 gap-y-1 overflow-x-auto px-3 py-2 md:flex-wrap md:overflow-visible md:px-4">
        <Item label="기관" value={s.total} strong />
        <Item label="병원" value={s.hospitals} />
        <Item label="의과대학·의전원" value={s.schools} />
        <Item label="상급종합" value={s.tertiary} />
        <Item label="권역응급" value={s.emergency} />
        <Item label="대학병원" value={s.universityHospitals} />
        <Item label="인턴 모집 확인" value={s.withIntern} />
        <Item label="레지던트 모집 확인" value={s.withResident} />
        {s.coordUnverified > 0 && <Item label="좌표 미확인" value={s.coordUnverified} muted />}
      </dl>
      {chips.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-t border-line/70 px-3 py-1.5 md:flex-wrap md:overflow-visible md:px-4">
          <span className="mr-0.5 shrink-0 whitespace-nowrap text-2xs text-ink-faint">적용 중</span>
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={c.onRemove}
              className="group inline-flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-paper px-2 py-0.5 text-2xs text-ink-soft hover:border-brand hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              {c.label}
              <span aria-hidden="true" className="text-ink-faint group-hover:text-brand">×</span>
              <span className="sr-only">필터 해제</span>
            </button>
          ))}
          <button onClick={clearFilters} className="ml-1 text-2xs text-ink-mute underline-offset-2 hover:underline">
            모두 지우기
          </button>
        </div>
      )}
    </div>
  )
}

function Item({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex shrink-0 items-baseline gap-1">
      <dt className={'whitespace-nowrap text-2xs ' + (muted ? 'text-amber-700' : 'text-ink-mute')}>{label}</dt>
      <dd
        className={
          'font-num tabular-nums ' +
          (strong ? 'text-base font-semibold text-ink' : muted ? 'text-sm text-amber-700' : 'text-sm text-ink-soft')
        }
      >
        {value.toLocaleString('ko-KR')}
      </dd>
    </div>
  )
}

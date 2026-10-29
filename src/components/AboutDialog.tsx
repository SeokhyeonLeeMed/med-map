import { useEffect, useRef } from 'react'
import type { Dataset } from '../types'
import { AS_OF, TRAIT_DEFINITION, TRAIT_LABEL } from '../lib/domain'
import { useStore } from '../store'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const data = useStore((s) => s.data)
  const coverage = useStore((s) => s.coverage)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!data) return null
  const extraRegions = data.regions.subRegions.filter((s) => s.addedBeyondPrompt)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-6">
      <button className="absolute inset-0 -z-10" aria-label="닫기" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-t-xl border border-line bg-paper-raised shadow-2xl focus:outline-none sm:rounded-xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-line bg-paper-raised px-5 py-3">
          <h2 id="about-title" className="text-sm font-semibold">데이터 정보</h2>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="rounded p-1.5 text-ink-mute hover:bg-paper-sunk hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="space-y-5 px-5 py-4 text-sm">
          <Section title="수록 범위">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <Num label="기관" value={data.hospitals.length + data.schools.length} />
              <Num label="병원" value={data.hospitals.length} />
              <Num label="의과대학·의전원" value={data.schools.length} />
              <Num label="수련 모집 단위" value={data.trainingUnits.length} />
              <Num label="모집 기록" value={coverage?.counts?.recruitmentRecords ?? 0} />
              <Num label="기관 간 관계" value={data.relations.length} />
              <Num label="진료과목 확인" value={coverage?.counts?.hospitalsWithDepartments ?? 0} />
              <Num label="공식 주소 확인" value={coverage?.counts?.hospitalsWithAddress ?? 0} />
            </dl>
            <p className="mt-2 text-2xs leading-relaxed text-ink-mute">
              데이터 기준일 <strong className="font-num">{AS_OF}</strong>. 값마다 출처와 기준 시점을 따로 기록하므로,
              수련 모집 정보와 병상 수, 행정구역 경계의 기준 시점은 서로 다릅니다.
            </p>
          </Section>

          {coverage && (
            <Section title="전공의 모집 전국 총계">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-line text-2xs text-ink-mute">
                    <th scope="col" className="py-1 text-left font-medium">연도·학기</th>
                    <th scope="col" className="py-1 text-left font-medium">과정 · 지표</th>
                    <th scope="col" className="py-1 text-right font-medium">인원</th>
                    <th scope="col" className="py-1 text-right font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.nationalTotals.map((t, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-1">{t.year} {t.term}</td>
                      <td className="py-1">{t.track} {t.metric}</td>
                      <td className="py-1 text-right font-num tabular-nums">
                        {t.value.toLocaleString('ko-KR')}
                        {t.institutionCount && (
                          <span className="ml-1 text-2xs text-ink-faint">({t.institutionCount}개 기관)</span>
                        )}
                      </td>
                      <td className="py-1 text-right text-2xs text-ink-mute">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-2xs leading-relaxed text-amber-900">
                {coverage.coverageWarning}
              </p>
              {coverage.changeNote && (
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-mute">{coverage.changeNote}</p>
              )}
            </Section>
          )}

          <Section title="병원 특성 분류 기준">
            <dl className="space-y-2">
              {(Object.keys(TRAIT_LABEL) as Array<keyof typeof TRAIT_LABEL>).map((t) => (
                <div key={t}>
                  <dt className="text-xs font-medium">{TRAIT_LABEL[t]}</dt>
                  <dd className="text-2xs leading-relaxed text-ink-mute">{TRAIT_DEFINITION[t]}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="권역 구성">
            <p className="text-2xs leading-relaxed text-ink-mute">
              대권역 {data.regions.macroRegions.length}개는 {String(data.regions.meta.asOf)} 기준 광역자치단체이며,
              세부권역 {data.regions.subRegions.length}개는 보건복지부 응급의료권역을 따릅니다. 각 권역에 속하는 시군구는
              서비스가 정의한 값으로, 256개 시군구 전부가 정확히 하나의 세부권역에 들어갑니다.
            </p>
            {extraRegions.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {extraRegions.map((s) => (
                  <li key={s.id} className="rounded border border-line bg-paper px-2.5 py-2">
                    <p className="text-xs font-medium">{s.name} — 추가한 권역</p>
                    <p className="mt-0.5 text-2xs leading-relaxed text-ink-mute">{s.addedReason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="출처">
            <ul className="space-y-2">
              {data.sources.map((s) => (
                <li key={s.id} className="border-b border-line/60 pb-2 last:border-0">
                  <p className="text-xs leading-snug">{s.title}</p>
                  <p className="mt-0.5 text-2xs text-ink-mute">
                    {s.publisher} · {s.kind}
                    {s.license && ` · ${s.license}`}
                    {s.retrievedOn && ` · ${s.retrievedOn} 확인`}
                  </p>
                  {s.url && (
                    <a className="break-all text-2xs text-brand underline" href={s.url} target="_blank" rel="noreferrer">
                      {s.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="지도 데이터">
            <p className="text-2xs leading-relaxed text-ink-mute">
              행정구역 경계는{' '}
              <a className="text-brand underline" href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">
                admdongkor
              </a>{' '}
              (통계청 SGIS, CC BY 4.0), 기관 주소·좌표는 건강보험심사평가원 공시(공공누리 제1유형)이며 심평원 명부에 없는 일부 기관만 © OpenStreetMap contributors (ODbL) 좌표를 씁니다. 배경 타일 서비스를 쓰지 않으므로
              API 키나 사용량 제한이 없습니다.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  )
}

function Num({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-2xs text-ink-mute">{label}</dt>
      <dd className="font-num text-sm font-semibold tabular-nums">{value.toLocaleString('ko-KR')}</dd>
    </div>
  )
}

export type AboutData = Dataset

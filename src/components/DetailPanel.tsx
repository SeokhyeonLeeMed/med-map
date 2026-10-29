import { useEffect, useMemo, useState } from 'react'
import type { Dataset, Hospital, Institution, MedicalSchool, SourceRef } from '../types'
import {
  activeEmergency,
  activeTertiary,
  isHospital,
  pastEmergency,
  recruitmentFor,
  type RecruitmentSummary,
} from '../lib/domain'
import { useStore } from '../store'

type Tab = '개요' | '수련' | '진료조직' | '관련기관' | '출처'

export function DetailPanel({ institution }: { institution: Institution }) {
  const data = useStore((s) => s.data)!
  const select = useStore((s) => s.select)
  const [tab, setTab] = useState<Tab>('개요')

  // Esc 로 상세 패널을 닫는다. 검색창이나 입력에 포커스가 있을 때는 그쪽이 먼저 처리한다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (e.key !== 'Escape' || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      // 위에 열린 대화상자가 있으면 그쪽이 먼저 닫히도록 둔다.
      if (document.querySelector('[role="dialog"]')) return
      select(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [select])
  const hospital = isHospital(institution)
  // 예방의학과처럼 의과대학이 모집 단위인 경우가 있어, 자료가 있는 대학에도 수련 탭을 둔다.
  const schoolHasTraining = !hospital && (data.recruitment[institution.id]?.length ?? 0) > 0
  const tabs: Tab[] = hospital
    ? ['개요', '수련', '진료조직', '관련기관', '출처']
    : schoolHasTraining
      ? ['개요', '수련', '관련기관', '출처']
      : ['개요', '관련기관', '출처']
  // 병원에서 '진료조직' 탭을 보다가 의과대학으로 넘어가면 그 탭이 없다. 빈 화면 대신 개요를 보여 준다.
  const activeTab: Tab = tabs.includes(tab) ? tab : '개요'

  return (
    <aside className="flex h-full flex-col bg-paper-raised" aria-label="기관 상세 정보">
      <header className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-start gap-3">
          <Logo institution={institution} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug text-ink">{institution.officialName}</h2>
            <p className="mt-0.5 text-2xs text-ink-mute">
              {institution.sggName ?? '소재지 미확인'}
              {hospital && institution.commonName !== institution.officialName && ` · ${institution.commonName}`}
            </p>
          </div>
          <button
            onClick={() => select(null)}
            aria-label="상세 패널 닫기"
            className="-mr-1 -mt-1 rounded p-1.5 text-ink-mute hover:bg-paper-sunk hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <Badges institution={institution} />
      </header>

      <nav className="flex shrink-0 gap-0.5 border-b border-line px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={activeTab === t}
            onClick={() => setTab(t)}
            className={
              '-mb-px border-b-2 px-2.5 py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
              (activeTab === t ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-mute hover:text-ink')
            }
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {activeTab === '개요' && (hospital ? <HospitalOverview h={institution} /> : <SchoolOverview s={institution} />)}
        {activeTab === '수련' && <Training institutionId={institution.id} data={data} />}
        {activeTab === '진료조직' && hospital && <Organization h={institution} data={data} />}
        {activeTab === '관련기관' && <Related institution={institution} data={data} />}
        {activeTab === '출처' && <Sources institution={institution} data={data} />}
      </div>
    </aside>
  )
}

function Logo({ institution }: { institution: Institution }) {
  const [failed, setFailed] = useState(false)
  const label = institution.officialName.slice(0, 2)
  if (!institution.logo || failed) {
    return (
      <div
        className={
          'grid h-10 w-10 shrink-0 place-items-center rounded border text-[11px] font-semibold ' +
          (isHospital(institution)
            ? 'border-brand/25 bg-brand-soft text-brand'
            : 'border-school/25 bg-[#f5efe4] text-school')
        }
        aria-hidden="true"
      >
        {label}
      </div>
    )
  }
  return (
    <img
      src={institution.logo}
      alt={`${institution.officialName} 로고`}
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded border border-line object-contain p-0.5"
    />
  )
}

function Badges({ institution }: { institution: Institution }) {
  if (!isHospital(institution)) {
    return (
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone="school">{institution.schoolKind}</Badge>
      </div>
    )
  }
  const t = activeTertiary(institution)
  const e = activeEmergency(institution)
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {t && <Badge tone="brand">상급종합병원</Badge>}
      {e.length > 0 && <Badge tone="alert">권역응급의료센터</Badge>}
      {institution.universityRelations.length > 0 && <Badge tone="plain">대학병원</Badge>}
      {institution.institutionKind && <Badge tone="plain">{institution.institutionKind}</Badge>}
      {institution.coord.status !== '확인됨' && <Badge tone="warn">좌표 {institution.coord.status}</Badge>}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'brand' | 'alert' | 'plain' | 'school' | 'warn'; children: React.ReactNode }) {
  const cls = {
    brand: 'border-brand/30 bg-brand-soft text-brand',
    alert: 'border-alert/25 bg-[#fbeceb] text-alert',
    plain: 'border-line-strong bg-paper-sunk text-ink-soft',
    school: 'border-school/25 bg-[#f5efe4] text-school',
    warn: 'border-amber-300 bg-amber-50 text-amber-800',
  }[tone]
  return <span className={`rounded-sm border px-1.5 py-0.5 text-2xs font-medium ${cls}`}>{children}</span>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-0.5 border-b border-line/70 py-2 last:border-0">
      <dt className="text-2xs leading-5 text-ink-mute">{label}</dt>
      <dd className="min-w-0 leading-5">{children}</dd>
    </div>
  )
}

function Unknown({ what = '미확인' }: { what?: string }) {
  return <span className="text-ink-faint">{what}</span>
}

function HospitalOverview({ h }: { h: Hospital }) {
  const t = activeTertiary(h)
  const e = activeEmergency(h)
  const past = pastEmergency(h)
  return (
    <dl>
      <Field label="종별">
        {h.hiraKind ? (
          <>
            <span className="font-semibold">{h.hiraKind}</span>
            <span className="ml-1 text-2xs text-ink-mute">심평원 공시 종별 · {h.address.asOf ?? ''} 기준</span>
          </>
        ) : (
          <Unknown what="종별 미확인" />
        )}
      </Field>
      <Field label="지정">
        {t ? (
          <span>
            상급종합병원 <span className="text-2xs text-ink-mute">({t.term}, {t.validFrom}~{t.validTo}, {t.careRegion})</span>
          </span>
        ) : (
          <Unknown what="상급종합병원 지정 없음" />
        )}
      </Field>
      <Field label="권역응급">
        {e.length === 0 ? (
          <Unknown what="현재 지정 없음" />
        ) : (
          <ul className="space-y-0.5">
            {e.map((x) => (
              <li key={x.termId}>
                관할 <strong className="font-semibold">{x.emergencyRegionName}</strong>{' '}
                <span className="text-2xs text-ink-mute">({x.validFrom}~{x.validTo})</span>
                {x.newlyDesignated && <span className="ml-1 text-2xs text-brand">신규</span>}
                {x.pendingUntil && <span className="ml-1 text-2xs text-amber-700">조건부 ~{x.pendingUntil}</span>}
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {past.map((x) => (
              <li key={x.termId} className="text-2xs text-ink-faint">
                지난 지정 · {x.emergencyRegionName} ({x.validFrom}~{x.validTo})
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="주소">
        {h.address.value ? (
          <>
            <span>{h.address.value}</span>
            {h.address.postcode && <span className="ml-1 font-num text-2xs text-ink-mute">({h.address.postcode})</span>}
          </>
        ) : (
          <Unknown what="공식 주소 미확인" />
        )}
        {h.coord.lat != null && (
          <div className="font-num text-2xs text-ink-faint">
            {h.coord.lat.toFixed(5)}, {h.coord.lon!.toFixed(5)}
            {h.coord.precision && h.coord.precision !== 'exact' && ` · ${h.coord.precision}`}
          </div>
        )}
        {h.coord.note && <p className="text-2xs leading-snug text-ink-faint">{h.coord.note}</p>}
      </Field>
      {h.phone && <Field label="전화">{h.phone}</Field>}
      <Field label="병상 수">
        {h.beds.length === 0 ? (
          <Unknown />
        ) : (
          h.beds.map((b, i) => (
            <div key={i} className={i > 0 ? 'mt-1' : ''}>
              <span className="font-num text-[15px] font-semibold tabular-nums">{b.value.toLocaleString('ko-KR')}</span>
              <span className="ml-1 text-2xs text-ink-mute">{b.kind} · {b.asOf} 기준 · {b.status}</span>
              {b.note && <p className="text-2xs leading-snug text-ink-faint">{b.note}</p>}
            </div>
          ))
        )}
        {h.bedDetail && Object.keys(h.bedDetail.breakdown).length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-2xs text-ink-mute">
            {Object.entries(h.bedDetail.breakdown).map(([k, v]) => (
              <li key={k}>
                {k} <span className="font-num tabular-nums text-ink-soft">{v}</span>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="개설일">{h.openedOn ?? <Unknown />}</Field>
      <Field label="연혁">
        {h.history.value ? (
          <span className="text-xs leading-relaxed">
            {h.history.value}
            <span className="ml-1 text-2xs text-ink-mute">({h.history.status})</span>
          </span>
        ) : (
          <Unknown what="서술형 연혁 미확인" />
        )}
      </Field>
      <Field label="홈페이지">{h.homepage ? <a className="text-brand underline" href={h.homepage} target="_blank" rel="noreferrer">{h.homepage}</a> : <Unknown />}</Field>
    </dl>
  )
}

function SchoolOverview({ s }: { s: MedicalSchool }) {
  return (
    <dl>
      <Field label="구분">{s.schoolKind}</Field>
      <Field label="소재지">{s.sggName ?? <Unknown />}</Field>
      <Field label="설립">{s.founded.value ?? <Unknown />}</Field>
      {s.quota.map((q) => (
        <Field key={q.admissionYear} label={`${q.admissionYear}학년도`}>
          {q.value == null ? (
            <Unknown />
          ) : (
            <>
              <span className="font-num text-[15px] font-semibold tabular-nums">{q.value}</span>
              <span className="ml-1 text-2xs text-ink-mute">명 · {q.kind}</span>
            </>
          )}
          {q.note && <p className="text-2xs leading-snug text-ink-faint">{q.note}</p>}
        </Field>
      ))}
      <Field label="대학">
        {s.universityUrl ? <a className="text-brand underline" href={s.universityUrl} target="_blank" rel="noreferrer">{s.universityUrl}</a> : <Unknown />}
      </Field>
      <Field label="의과대학">
        {s.schoolUrl ? <a className="text-brand underline" href={s.schoolUrl} target="_blank" rel="noreferrer">{s.schoolUrl}</a> : <Unknown />}
      </Field>
      <Field label="위치 정밀도">
        <span className="text-2xs text-ink-mute">{s.coord.precision ?? s.coord.status}</span>
        {s.coord.note && <p className="text-2xs leading-snug text-ink-faint">{s.coord.note}</p>}
      </Field>
    </dl>
  )
}

function Training({ institutionId, data }: { institutionId: string; data: Dataset }) {
  const state = useStore((s) => s.recruitmentState)
  const retry = useStore((s) => s.loadRecruitment)
  const summaries = useMemo(() => recruitmentFor(institutionId, data), [institutionId, data])
  const select = useStore((s) => s.select)

  if (state === 'loading' || state === 'idle') {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-xs text-ink-mute">정원·모집 자료를 불러오는 중입니다…</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-paper-sunk" />
        ))}
      </div>
    )
  }
  if (state === 'error') {
    return (
      <p className="rounded border border-alert/30 bg-[#fbeceb] p-3 text-xs leading-relaxed text-alert">
        정원·모집 자료를 불러오지 못했습니다.{' '}
        <button onClick={() => void retry()} className="underline">
          다시 시도
        </button>
      </p>
    )
  }
  if (summaries.length === 0) {
    return (
      <p className="rounded border border-line bg-paper-sunk p-3 text-xs leading-relaxed text-ink-mute">
        이 기관의 전공의 정원·모집 자료를 확보하지 못했습니다. 0명이라는 뜻이 아니라 <strong>자료 미확인</strong> 상태입니다.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {summaries.length > 1 && <YearSummary summaries={summaries} />}
      {summaries.map((s, idx) => (
        // 시점이 여럿이라 가장 최근 것만 펼쳐 두고 나머지는 접는다.
        <details key={`${s.unitId}-${s.year}-${s.term}`} open={idx === 0} className="group">
          <summary className="mb-2 cursor-pointer list-none">
          <h4 className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold">
            <span className="text-ink-faint transition-transform group-open:rotate-90">›</span>
            <span>{s.year}년 {s.term}</span>
            {s.status !== '확인됨' && (
              <span className="rounded-sm border border-amber-300 bg-amber-50 px-1 py-px text-[10px] font-normal text-amber-800">
                {s.status}
              </span>
            )}
            {s.integratedTraining && (
              <span className="rounded-sm border border-line-strong px-1 py-px text-[10px] font-normal text-ink-mute">
                통합수련 · 모집 단위 「{s.unitName}」
              </span>
            )}
            <span className="ml-auto font-num text-2xs font-normal text-ink-mute">
              인턴 {s.intern.quota ?? '—'} · 레지던트 {s.resident.total ?? '—'}
            </span>
          </h4>
          </summary>
          {s.integratedTraining && (
            <p className="mb-2 text-2xs leading-snug text-ink-faint">
              이 수치는 병원 하나가 아니라 통합수련 단위 전체의 모집인원입니다. 소속 병원:{' '}
              {s.memberHospitalIds.map((id, i) => {
                const m = data.hospitals.find((x) => x.id === id)
                return m ? (
                  <span key={id}>
                    {i > 0 && ', '}
                    <button className="text-brand underline" onClick={() => select(id)}>{m.commonName}</button>
                  </span>
                ) : null
              })}
            </p>
          )}
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Stat label={`인턴 ${s.quotaKind}`} value={s.intern.quota} unit="명" unknown={s.intern.quota == null} />
            <Stat label={`레지던트 ${s.quotaKind}`} value={s.resident.total} unit="명" unknown={s.resident.total == null} />
          </div>
          {s.resident.total !== null && !s.resident.specialtyBreakdownKnown && (
            <p className="mb-2 text-2xs leading-snug text-ink-faint">전공과별 내역은 확인하지 못했습니다. 위 수치는 총원입니다.</p>
          )}
          {s.breakdown && (
            <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-ink-mute">
              {Object.entries(s.breakdown).map(([k, v]) => (
                <li key={k}>
                  {k} <span className="font-num tabular-nums text-ink-soft">{v}</span>
                </li>
              ))}
            </ul>
          )}
          {s.resident.bySpecialty.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <caption className="pb-1 text-left text-2xs text-ink-mute">전공과별 {s.quotaKind}</caption>
              <thead>
                <tr className="border-b border-line text-2xs text-ink-mute">
                  <th scope="col" className="py-1 text-left font-medium">전공과</th>
                  <th scope="col" className="py-1 text-right font-medium">{s.quotaKind}</th>
                  <th scope="col" className="py-1 text-right font-medium">탄력운영</th>
                </tr>
              </thead>
              <tbody>
                {s.resident.bySpecialty.map((r) => (
                  <tr key={r.specialty} className="border-b border-line/60">
                    <td className="py-1">{r.specialty}</td>
                    <td className="py-1 text-right font-num tabular-nums">{r.quota}</td>
                    <td className="py-1 text-right text-2xs text-ink-mute">{r.flexible ? '가능' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-2xs leading-snug text-ink-faint">
            {s.quotaKind} 0명은 확인된 값이며 미확인과 다릅니다. 지원자 수·합격자 수·실제 임용 인원은 모두 미확인입니다.
            정원과 실제 모집인원은 서로 다른 지표입니다.
            {s.sourceIds.length > 0 && <> 출처: {s.sourceIds.map((id) => sourceTitle(data, id)).join(' · ')}</>}
          </p>
        </details>
      ))}
    </div>
  )
}

/** 연도별 추이를 한눈에 보는 작은 표. 아래 상세 블록보다 먼저 보여 준다. */
function YearSummary({ summaries }: { summaries: RecruitmentSummary[] }) {
  const rows = [...summaries].sort((a, b) => a.year - b.year || a.term.localeCompare(b.term, 'ko'))
  const max = Math.max(...rows.flatMap((s) => [s.intern.quota ?? 0, s.resident.total ?? 0]), 1)
  return (
    <section className="rounded border border-line bg-paper p-2.5">
      <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">연도별 추이</h4>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-line text-2xs text-ink-mute">
            <th scope="col" className="py-1 text-left font-medium">연도·학기</th>
            <th scope="col" className="py-1 text-left font-medium">지표</th>
            <th scope="col" className="py-1 text-right font-medium">인턴</th>
            <th scope="col" className="py-1 text-right font-medium">레지던트</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={`${s.year}-${s.term}-${s.unitId ?? ''}`} className="border-b border-line/60">
              <td className="py-1 whitespace-nowrap">{s.year} {s.term}</td>
              <td className="py-1 text-2xs text-ink-mute">{s.quotaKind}</td>
              <td className="py-1 text-right">
                <Bar value={s.intern.quota} max={max} />
              </td>
              <td className="py-1 text-right">
                <Bar value={s.resident.total} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-2xs leading-snug text-ink-faint">
        '정원'은 한 해에 배정된 수, '모집인원'은 한 차례 모집에서 뽑는 수입니다. 두 지표를 바로 견주지 마세요.
      </p>
    </section>
  )
}

function Bar({ value, max }: { value: number | null; max: number }) {
  if (value == null) return <span className="text-2xs text-ink-faint">—</span>
  const pct = Math.max(2, Math.round((value / max) * 100))
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="hidden h-1.5 rounded-sm bg-brand/25 sm:block" style={{ width: `${pct * 0.5}px` }} />
      <span className="font-num tabular-nums">{value}</span>
    </span>
  )
}

function sourceTitle(data: Dataset, id: string): string {
  return data.sources.find((s) => s.id === id)?.title ?? id
}

function Stat({ label, value, unit, unknown }: { label: string; value: number | null; unit: string; unknown: boolean }) {
  return (
    <div className="rounded border border-line bg-paper px-2.5 py-2">
      <div className="text-2xs text-ink-mute">{label}</div>
      {unknown ? (
        <div className="mt-0.5 text-sm text-ink-faint">미확인</div>
      ) : (
        <div className="mt-0.5 font-num text-xl font-semibold leading-none tabular-nums text-ink">
          {value}
          <span className="ml-0.5 text-2xs font-normal text-ink-mute">{unit}</span>
        </div>
      )}
    </div>
  )
}

function Organization({ h, data }: { h: Hospital; data: Dataset }) {
  // 모집 공고에 나온 전공과목. 진료과목 전체와 다르므로 따로 표시한다.
  const recruited = useMemo(() => {
    const set = new Set<string>()
    for (const r of data.recruitment[h.id] ?? []) {
      if (r.specialty && r.specialty !== '전공과별 미확인') set.add(r.specialty)
    }
    return set
  }, [h.id, data])

  const depts = h.departments.items
  const withSpecialists = depts.filter((d) => (d.specialists ?? 0) > 0)
  const withoutSpecialists = depts.filter((d) => !d.specialists)
  const st = h.staffing

  return (
    <div className="space-y-4">
      <section>
        <h4 className="mb-1.5 flex items-baseline gap-2 text-xs font-semibold">
          진료과목
          {depts.length > 0 && (
            <span className="font-num text-2xs font-normal text-ink-mute">{depts.length}개 과목</span>
          )}
        </h4>
        {depts.length === 0 ? (
          <p className="text-xs text-ink-faint">{h.departments.status} — 심평원 신고 진료과목을 확인하지 못했습니다.</p>
        ) : (
          <>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-2xs text-ink-mute">
                  <th scope="col" className="py-1 text-left font-medium">과목</th>
                  <th scope="col" className="py-1 text-right font-medium">전문의 수</th>
                  <th scope="col" className="py-1 text-right font-medium">전공의 정원·모집</th>
                </tr>
              </thead>
              <tbody>
                {withSpecialists.map((d) => (
                  <tr key={d.code + d.name} className="border-b border-line/60">
                    <td className="py-1">{d.name}</td>
                    <td className="py-1 text-right font-num tabular-nums">{d.specialists}</td>
                    <td className="py-1 text-right text-2xs text-ink-mute">{recruited.has(d.name) ? '있음' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {withoutSpecialists.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-2xs text-ink-mute">전문의 수가 0으로 신고된 과목 {withoutSpecialists.length}개</p>
                <ul className="flex flex-wrap gap-1">
                  {withoutSpecialists.map((d) => (
                    <li
                      key={d.code + d.name}
                      className="rounded-sm border border-line bg-paper px-1.5 py-0.5 text-2xs text-ink-faint"
                    >
                      {d.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {h.departments.note && (
              <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">{h.departments.note}</p>
            )}
          </>
        )}
      </section>

      <section>
        <h4 className="mb-1.5 text-xs font-semibold">인력</h4>
        {st.status === '미확인' ? (
          <p className="text-xs text-ink-faint">미확인 — 공식 자료로 확인한 인력 수가 없습니다.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="총 의사 수" value={st.totalDoctors ?? null} unit="명" unknown={st.totalDoctors == null} />
              <Stat label="전문의 수" value={st.totalSpecialists ?? null} unit="명" unknown={st.totalSpecialists == null} />
              <Stat label="재직 인턴" value={st.internsOnDuty ?? null} unit="명" unknown={st.internsOnDuty == null} />
              <Stat label="재직 레지던트" value={st.residentsOnDuty ?? null} unit="명" unknown={st.residentsOnDuty == null} />
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">{st.note}</p>
          </>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold">운영 센터</h4>
        <p className="text-xs leading-relaxed text-ink-faint">
          {h.centers.note ?? h.centers.status} 암센터·심뇌혈관센터처럼 병원이 스스로 이름 붙인 센터 조직은
          공식 명부에 없어 아직 수집하지 않았습니다.
        </p>
      </section>
    </div>
  )
}

function Related({ institution, data }: { institution: Institution; data: Dataset }) {
  const select = useStore((s) => s.select)
  const rels = data.relations.filter((r) => r.fromId === institution.id || r.toId === institution.id)
  if (rels.length === 0) return <p className="text-xs text-ink-faint">자료로 확인된 관련 기관이 없습니다.</p>
  const nameOf = (id: string) =>
    data.hospitals.find((h) => h.id === id)?.officialName ?? data.schools.find((s) => s.id === id)?.officialName ?? id
  return (
    <ul className="space-y-1">
      {rels.map((r, i) => {
        const otherId = r.fromId === institution.id ? r.toId : r.fromId
        return (
          <li key={i}>
            <button
              onClick={() => select(otherId)}
              className="flex w-full items-start gap-2 rounded border border-line px-2.5 py-2 text-left hover:border-brand/40 hover:bg-brand-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span className="min-w-0 flex-1 text-xs leading-snug">{nameOf(otherId)}</span>
              <span className="shrink-0 rounded-sm border border-line-strong px-1 py-px text-[10px] text-ink-mute">
                {r.relationType}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Sources({ institution, data }: { institution: Institution; data: Dataset }) {
  const ids = new Set<string>()
  if (isHospital(institution)) {
    if (institution.coord.sourceId) ids.add(institution.coord.sourceId)
    if (institution.address.sourceId) ids.add(institution.address.sourceId)
    for (const x of institution.history.sourceIds ?? [institution.history.sourceId]) if (x) ids.add(x)
    if (institution.departments.sourceId) ids.add(institution.departments.sourceId)
    if (institution.bedDetail) ids.add(institution.bedDetail.sourceId)
    institution.beds.forEach((b) => ids.add(b.sourceId))
    if (institution.designations.tertiary) ids.add(institution.designations.tertiary.sourceId)
    institution.designations.emergency.forEach((e) => ids.add(e.sourceId))
  } else {
    if (institution.coord.sourceId) ids.add(institution.coord.sourceId)
    ids.add(institution.sourceId)
    institution.quota.forEach((q) => ids.add(q.sourceId))
  }
  for (const r of data.recruitment[institution.id] ?? []) ids.add(r.sourceId)
  const list = data.sources.filter((s) => ids.has(s.id))
  return (
    <ul className="space-y-2.5">
      {list.map((s: SourceRef) => (
        <li key={s.id} className="border-b border-line/70 pb-2.5 last:border-0">
          <p className="text-xs font-medium leading-snug">{s.title}</p>
          <p className="mt-0.5 text-2xs text-ink-mute">
            {s.publisher} · {s.kind}
            {s.publishedOn && ` · ${s.publishedOn} 공표`}
            {s.asOf && ` · ${s.asOf} 기준`}
            {s.retrievedOn && ` · ${s.retrievedOn} 확인`}
          </p>
          {s.url && (
            <a className="mt-0.5 block break-all text-2xs text-brand underline" href={s.url} target="_blank" rel="noreferrer">
              {s.url}
            </a>
          )}
          {s.localFile && <p className="mt-0.5 text-2xs text-ink-faint">로컬 자료: {s.localFile}</p>}
          {s.note && <p className="mt-0.5 text-2xs leading-snug text-ink-faint">{s.note}</p>}
        </li>
      ))}
    </ul>
  )
}

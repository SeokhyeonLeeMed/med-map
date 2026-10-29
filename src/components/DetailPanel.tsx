import { useEffect, useMemo, useState } from 'react'
import type { Dataset, Hospital, Institution, MedicalSchool, SourceRef } from '../types'
import { activeEmergency, activeTertiary, isHospital, recruitmentFor } from '../lib/domain'
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
  const schoolHasTraining =
    !hospital && data.recruitment.some((r) => r.medicalSchoolIds.includes(institution.id))
  const tabs: Tab[] = hospital
    ? ['개요', '수련', '진료조직', '관련기관', '출처']
    : schoolHasTraining
      ? ['개요', '수련', '관련기관', '출처']
      : ['개요', '관련기관', '출처']

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
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              '-mb-px border-b-2 px-2.5 py-2 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ' +
              (tab === t ? 'border-brand font-semibold text-ink' : 'border-transparent text-ink-mute hover:text-ink')
            }
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm">
        {tab === '개요' && (hospital ? <HospitalOverview h={institution} /> : <SchoolOverview s={institution} />)}
        {tab === '수련' && <Training institutionId={institution.id} data={data} />}
        {tab === '진료조직' && hospital && <Organization h={institution} data={data} />}
        {tab === '관련기관' && <Related institution={institution} data={data} />}
        {tab === '출처' && <Sources institution={institution} data={data} />}
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
  return (
    <dl>
      <Field label="종별·지정">
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
                {x.pendingUntil && <span className="ml-1 text-2xs text-amber-700">조건부 ~{x.pendingUntil}</span>}
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="주소">
        <Unknown what="공식 주소 미확인" />
        {h.coord.lat != null && (
          <span className="ml-1 font-num text-2xs text-ink-faint">
            {h.coord.lat.toFixed(4)}, {h.coord.lon!.toFixed(4)}
            {h.coord.precision && h.coord.precision !== 'exact' && ` · ${h.coord.precision}`}
          </span>
        )}
      </Field>
      <Field label="병상 수">
        {h.beds.length === 0 ? (
          <Unknown />
        ) : (
          h.beds.map((b, i) => (
            <div key={i}>
              <span className="font-num text-[15px] font-semibold tabular-nums">{b.value.toLocaleString('ko-KR')}</span>
              <span className="ml-1 text-2xs text-ink-mute">{b.kind} · {b.asOf} 기준 · {b.status}</span>
              {b.note && <p className="text-2xs leading-snug text-ink-faint">{b.note}</p>}
            </div>
          ))
        )}
      </Field>
      <Field label="연혁">
        <Unknown />
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
  const summaries = useMemo(() => recruitmentFor(institutionId, data), [institutionId, data])
  const select = useStore((s) => s.select)
  if (summaries.length === 0) {
    return (
      <p className="rounded border border-line bg-paper-sunk p-3 text-xs leading-relaxed text-ink-mute">
        이 병원의 전공의 모집 자료를 확보하지 못했습니다. 모집 인원이 0명이라는 뜻이 아니라 <strong>자료 미확인</strong> 상태입니다.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {summaries.map((s) => (
        <section key={`${s.unitId}-${s.year}-${s.term}`}>
          <h4 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold">
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
          </h4>
          {s.coverageWarning && (
            <p className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-2xs leading-snug text-amber-900">
              {s.coverageWarning}
            </p>
          )}
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
            <Stat label="인턴 모집인원" value={s.intern.quota} unit="명" unknown={s.intern.quota == null} />
            <Stat label="레지던트 모집인원" value={s.resident.total} unit="명" unknown={s.resident.total == null} />
          </div>
          {s.resident.total !== null && !s.resident.specialtyBreakdownKnown && (
            <p className="mb-2 text-2xs leading-snug text-ink-faint">전공과별 내역은 확인하지 못했습니다. 위 수치는 총원입니다.</p>
          )}
          {s.resident.bySpecialty.length > 0 && (
            <table className="w-full border-collapse text-xs">
              <caption className="pb-1 text-left text-2xs text-ink-mute">전공과별 모집인원</caption>
              <thead>
                <tr className="border-b border-line text-2xs text-ink-mute">
                  <th scope="col" className="py-1 text-left font-medium">전공과</th>
                  <th scope="col" className="py-1 text-right font-medium">모집인원</th>
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
            모집인원 0명은 확인된 값이며 미확인과 다릅니다. 지원자 수·합격자 수·실제 임용 인원은 모두 미확인입니다.
            {s.sourceIds.length > 0 && <> 출처: {s.sourceIds.map((id) => sourceTitle(data, id)).join(' · ')}</>}
          </p>
        </section>
      ))}
    </div>
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
  // 모집 공고에 나온 전공과목. 병원이 운영하는 진료과 전체와 같지 않다.
  const recruitedSpecialties = useMemo(() => {
    const set = new Set<string>()
    for (const r of data.recruitment) {
      if (!r.hospitalIds.includes(h.id) || !r.specialty) continue
      if (r.specialty === '전공과별 미확인') continue
      set.add(r.specialty)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [h.id, data])

  return (
    <div className="space-y-3">
      <section>
        <h4 className="mb-1 text-xs font-semibold">운영 센터</h4>
        <p className="text-xs text-ink-faint">{h.centers.status} — 공식 자료로 확인한 센터 목록이 없습니다.</p>
      </section>
      <section>
        <h4 className="mb-1 text-xs font-semibold">세부 전문과</h4>
        <p className="text-xs text-ink-faint">{h.departments.status} — 병원 공식 진료 조직을 아직 수집하지 않았습니다.</p>
      </section>
      <section>
        <h4 className="mb-1 text-xs font-semibold">센터·전문과별 근무 인원</h4>
        <p className="text-xs leading-relaxed text-ink-faint">{h.staffing.note ?? h.staffing.status}</p>
      </section>
      {recruitedSpecialties.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-semibold">모집 공고로 확인된 전공과목</h4>
          <ul className="flex flex-wrap gap-1">
            {recruitedSpecialties.map((sp) => (
              <li key={sp} className="rounded-sm border border-line-strong bg-paper px-1.5 py-0.5 text-2xs text-ink-soft">
                {sp}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
            레지던트를 모집한 과목일 뿐, 병원이 운영하는 진료과 전체가 아닙니다. 모집인원은 「수련」 탭에 있습니다.
          </p>
        </section>
      )}
      <p className="rounded border border-line bg-paper-sunk p-2.5 text-2xs leading-relaxed text-ink-mute">
        센터·전문과 조직과 근무 인원은 병원 공식 자료로 확인된 것만 싣습니다. 홈페이지에 조직이 있다는 사실만으로
        인원을 추정하지 않습니다.
      </p>
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
    institution.beds.forEach((b) => ids.add(b.sourceId))
    if (institution.designations.tertiary) ids.add(institution.designations.tertiary.sourceId)
    institution.designations.emergency.forEach((e) => ids.add(e.sourceId))
  } else {
    if (institution.coord.sourceId) ids.add(institution.coord.sourceId)
    ids.add(institution.sourceId)
    institution.quota.forEach((q) => ids.add(q.sourceId))
  }
  for (const r of data.recruitment) {
    if (r.hospitalIds.includes(institution.id) || r.medicalSchoolIds.includes(institution.id)) ids.add(r.sourceId)
  }
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

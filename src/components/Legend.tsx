import { useState } from 'react'

export function Legend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[15rem]">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="rounded border border-line bg-paper-raised/95 px-2 py-1 text-2xs font-medium text-ink-soft shadow-sm backdrop-blur hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        범례 {open ? '접기' : '펼치기'}
      </button>
      {open && (
        <dl className="mt-1 space-y-1.5 rounded border border-line bg-paper-raised/97 p-2.5 text-2xs shadow-sm backdrop-blur">
          <Row swatch={<span className="h-[11px] w-[11px] rounded-full border-2 border-white bg-hosp shadow" />}>
            병원
          </Row>
          <Row swatch={<span className="h-[11px] w-[11px] rounded-[2px] border-2 border-white bg-school shadow" />}>
            의과대학 · 의학전문대학원
          </Row>
          <Row
            swatch={
              <span className="grid h-[15px] w-[15px] place-items-center rounded-full border border-hosp">
                <span className="h-[9px] w-[9px] rounded-full border border-white bg-hosp" />
              </span>
            }
          >
            상급종합병원 (바깥 테두리)
          </Row>
          <Row
            swatch={
              <span className="relative h-[11px] w-[11px] rounded-full border-2 border-white bg-hosp shadow">
                <span className="absolute -right-1 -top-1 h-[6px] w-[6px] rounded-full border border-white bg-alert" />
              </span>
            }
          >
            권역응급의료센터 (붉은 점)
          </Row>
          <p className="border-t border-line pt-1.5 leading-snug text-ink-faint">
            모양과 표식으로도 구별되므로 색을 구분하지 못해도 읽을 수 있습니다. 라벨은 확대 수준에 따라 겹치지 않는 만큼만 표시됩니다.
          </p>
        </dl>
      )}
    </div>
  )
}

function Row({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid w-4 shrink-0 place-items-center" aria-hidden="true">
        {swatch}
      </span>
      <span className="text-ink-soft">{children}</span>
    </div>
  )
}

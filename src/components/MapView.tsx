import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Institution } from '../types'
import { activeEmergency, activeTertiary, highlightedSgg, isHospital, universityGroups } from '../lib/domain'
import { allIconSpecs, drawIcon, iconId } from '../lib/mapIcons'
import { BOTH_BOUNDS, buildStyle, JAPAN_BOUNDS, KOREA_BOUNDS } from '../lib/mapStyle'
import { useStore } from '../store'

const BASE = import.meta.env.BASE_URL

/**
 * 시군구 경계(약 1.3 MB)는 권역 하이라이트에서만 다시 쓰므로 한 번만 받아 둔다.
 * 필터나 선택이 바뀔 때마다 받고 파싱하면 화면이 버벅인다.
 */
let sggPromise: Promise<GeoJSON.FeatureCollection> | null = null
function loadSgg(): Promise<GeoJSON.FeatureCollection> {
  sggPromise ??= fetch(`${BASE}geo/sgg.json`).then((r) => {
    if (!r.ok) throw new Error(`geo/sgg.json HTTP ${r.status}`)
    return r.json() as Promise<GeoJSON.FeatureCollection>
  })
  sggPromise.catch(() => {
    sggPromise = null // 실패하면 다음 번에 다시 시도한다
  })
  return sggPromise
}

/**
 * 일본 경계(도도부현·시구정촌)는 일본을 처음 켤 때 한 번만 받는다.
 * 한국 경계와 같은 속성 이름(sggcd·sidocd)으로 맞춰 하이라이트 코드를 그대로 쓴다.
 * 시구정촌 코드는 한국 시군구 코드와 숫자가 겹칠 수 있어 'jp' 를 붙인다.
 */
let jpPromise: Promise<{ pref: GeoJSON.FeatureCollection; muni: GeoJSON.FeatureCollection }> | null = null
function loadJapanGeo() {
  const get = (name: string) =>
    fetch(`${BASE}geo/${name}`).then((r) => {
      if (!r.ok) throw new Error(`geo/${name} HTTP ${r.status}`)
      return r.json() as Promise<GeoJSON.FeatureCollection>
    })
  jpPromise ??= Promise.all([get('jp_pref.json'), get('jp_muni.json')]).then(([pref, muni]) => {
    for (const f of pref.features) f.properties = { ...f.properties, sidocd: `jp${f.properties?.prefCode}` }
    for (const f of muni.features) {
      f.properties = { ...f.properties, sggcd: `jp${f.properties?.code}`, sidocd: `jp${f.properties?.prefCode}` }
    }
    return { pref, muni }
  })
  jpPromise.catch(() => {
    jpPromise = null
  })
  return jpPromise
}

/** 하이라이트할 코드에 맞는 경계. 일본 코드가 섞여 있으면 일본 경계도 받는다. */
async function boundaryFeatures(codes: Set<string>): Promise<GeoJSON.FeatureCollection> {
  const needJp = [...codes].some((c) => c.startsWith('jp'))
  const needKr = [...codes].some((c) => !c.startsWith('jp'))
  const parts = await Promise.all([
    needKr ? loadSgg() : null,
    needJp ? loadJapanGeo().then((g) => g.muni) : null,
  ])
  return {
    type: 'FeatureCollection',
    features: parts.flatMap((gj) => (gj ? sggFeatures(gj, codes).features : [])),
  }
}

function boundsFor(countries: string[]): [[number, number], [number, number]] {
  if (countries.includes('KR') && countries.includes('JP')) return BOTH_BOUNDS
  return countries.includes('JP') ? JAPAN_BOUNDS : KOREA_BOUNDS
}

function sggFeatures(gj: GeoJSON.FeatureCollection, codes: Set<string>): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: gj.features.filter((f) => codes.has(String(f.properties?.sggcd))) }
}

interface LabelBox {
  id: string
  name: string
  x: number
  y: number
  selected: boolean
}

/** 화면 좌표에서 겹치는 라벨을 솎아낸다. 중요한 기관부터 자리를 잡는다. */
function placeLabels(
  candidates: Array<{ id: string; name: string; x: number; y: number; rank: number; selected: boolean }>,
  width: number,
  height: number,
  limit: number,
): LabelBox[] {
  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  const out: LabelBox[] = []
  const sorted = [...candidates].sort((a, b) => Number(b.selected) - Number(a.selected) || a.rank - b.rank)
  for (const c of sorted) {
    if (out.length >= limit) break
    if (c.x < -40 || c.y < -20 || c.x > width + 40 || c.y > height + 20) continue
    const w = c.name.length * 11 + 12
    const h = 18
    const box = { x1: c.x - w / 2, y1: c.y + 10, x2: c.x + w / 2, y2: c.y + 10 + h }
    const hit = placed.some((p) => !(box.x2 < p.x1 || box.x1 > p.x2 || box.y2 < p.y1 || box.y1 > p.y2))
    if (hit && !c.selected) continue
    placed.push(box)
    out.push({ id: c.id, name: c.name, x: c.x, y: c.y, selected: c.selected })
  }
  return out
}

export function MapView({ shown }: { shown: Institution[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const [labels, setLabels] = useState<LabelBox[]>([])
  const [mapError, setMapError] = useState<string | null>(null)
  const [emergencyRegions, setEmergencyRegions] = useState<string[]>([])

  const data = useStore((s) => s.data)
  const selectedId = useStore((s) => s.selectedId)
  const flyToken = useStore((s) => s.flyToken)
  const subRegions = useStore((s) => s.filters.subRegions)
  const countries = useStore((s) => s.filters.countries)
  const select = useStore((s) => s.select)

  const features = useMemo(() => {
    // 의과·치과대학이 같은 캠퍼스에 있는 대학은 마커 하나(대학 이름)로 합친다.
    // 다른 캠퍼스면 단과대학마다 따로 두고 이름에 단과대학을 붙인다.
    const groups = data ? universityGroups(data.schools) : new Map()
    const shownIds = new Set(shown.map((i) => i.id))
    const merged = new Map<string, { name: string; memberIds: string[] }>()
    const hidden = new Set<string>()
    for (const g of new Set(groups.values())) {
      if (!g.sameCampus) continue
      const visible = g.members.filter((m: Institution) => shownIds.has(m.id))
      if (visible.length < 2) continue
      // 지금 고른 단과대학이 있으면 그 마커를 대표로 둔다(선택 표시와 좌표가 맞도록).
      const lead = visible.find((m: Institution) => m.id === selectedId) ?? visible[0]
      merged.set(lead.id, { name: g.universityName, memberIds: visible.map((m: Institution) => m.id) })
      for (const m of visible) if (m.id !== lead.id) hidden.add(m.id)
    }
    const placed = shown.filter((i) => i.coord.lat != null && i.coord.lon != null && !hidden.has(i.id))
    const offsets = spreadCoincident(placed)
    return placed
      .map((i) => {
        const hospital = isHospital(i)
        const group = merged.get(i.id)
        // 일본 特定機能病院은 한국 상급종합병원과 같은 진한 표식으로 그린다(범례에 함께 적는다).
        const tertiary = hospital ? !!activeTertiary(i) || !!i.jp?.tokutei : false
        const emergency = hospital ? activeEmergency(i).length > 0 : false
        const name = hospital ? i.commonName || i.officialName : group ? group.name : `${i.universityName} ${i.schoolKind}`
        const selected = group ? group.memberIds.includes(selectedId ?? '') : i.id === selectedId
        // 중요한 기관일수록 작은 값 → 라벨과 아이콘에서 우선권을 갖는다.
        const rank = (tertiary ? 0 : emergency ? 1 : hospital ? 2 : 1.5) * 1000 - (hospital ? i.beds[0]?.value ?? 0 : 0) / 100
        return {
          type: 'Feature' as const,
          id: i.id,
          properties: {
            id: i.id,
            name,
            rank,
            sortKey: rank,
            selected,
            icon: iconId({
              kind: hospital ? 'hospital' : 'school',
              tertiary,
              emergency,
              // 의과·치과를 합친 대학 마커는 의과 표식을 쓴다.
              dental: i.discipline === 'dental' && !group,
              selected,
            }),
          },
          geometry: { type: 'Point' as const, coordinates: offsets.get(i.id) ?? [i.coord.lon!, i.coord.lat!] },
        }
      })
  }, [shown, selectedId, data])

  // 지도 초기화 (한 번만)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let map: MlMap
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(BASE),
        bounds: boundsFor(useStore.getState().filters.countries),
        fitBoundsOptions: { padding: 36 },
        minZoom: 3,
        maxZoom: 17,
        attributionControl: false,
      })
    } catch (e) {
      setMapError(e instanceof Error ? e.message : '지도를 초기화하지 못했습니다')
      return
    }
    mapRef.current = map
    // 나침반: 지도를 돌리거나(오른쪽 끌기·두 손가락) 기울인 뒤 누르면 북쪽이 위로 오게 되돌린다.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right')
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '경계: <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">admdongkor</a> (통계청 SGIS, CC BY 4.0) · 国土数値情報 N03 (国土交通省) · 기관 정보·좌표: 건강보험심사평가원 (공공누리 제1유형), 医療情報ネット (厚生労働省, CC BY 4.0), 일부 좌표 © OpenStreetMap contributors (ODbL)',
      }),
      'bottom-left',
    )
    map.on('error', (e) => {
      const msg = (e as unknown as { error?: Error }).error?.message
      if (msg) setMapError(msg)
    })
    map.on('load', () => {
      for (const spec of allIconSpecs()) {
        const id = iconId(spec)
        if (!map.hasImage(id)) map.addImage(id, drawIcon(spec), { pixelRatio: 2 })
      }
      setReady(true)
    })
    map.on('click', 'institutions', (e) => {
      const f = e.features?.[0]
      if (f?.properties?.id) select(String(f.properties.id), false)
    })
    map.on('mouseenter', 'institutions', () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'institutions', () => {
      map.getCanvas().style.cursor = ''
    })
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [select])

  // 일본을 켜면 일본 경계를 채운다. 끄면 비운다(그리기 부담을 줄이고, 꺼진 나라가 보이지 않게).
  const showJp = countries.includes('JP')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const pref = map.getSource('jp-pref') as maplibregl.GeoJSONSource | undefined
    const muni = map.getSource('jp-muni') as maplibregl.GeoJSONSource | undefined
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
    if (!showJp) {
      pref?.setData(empty)
      muni?.setData(empty)
      return
    }
    let cancelled = false
    loadJapanGeo()
      .then((g) => {
        if (cancelled) return
        pref?.setData(g.pref)
        muni?.setData(g.muni)
      })
      .catch((e) => setMapError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [showJp, ready])

  // 나라 선택이 바뀌면 그 나라가 화면에 꽉 차게 옮긴다. 처음 그릴 때는 이미 맞춰 두었으므로 건너뛴다.
  const countryKey = [...countries].sort().join(',')
  const lastCountryKey = useRef(countryKey)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || lastCountryKey.current === countryKey) return
    lastCountryKey.current = countryKey
    map.fitBounds(boundsFor(countryKey.split(',')), { padding: 36, duration: 700, bearing: map.getBearing() })
  }, [countryKey, ready])

  // 마커 갱신
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('institutions') as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features })
  }, [features, ready])

  // 권역 하이라이트
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !data) return
    const codes = highlightedSgg(data.regions, new Set(subRegions))
    const src = map.getSource('highlight') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    if (codes.size === 0) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    let cancelled = false
    boundaryFeatures(codes)
      .then((fc) => {
        if (!cancelled) src.setData(fc)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [subRegions, ready, data])

  // 권역응급의료센터를 고르면 그 센터가 맡은 공식 관할 권역을 지도에 칠한다.
  // 기관이 있는 지리적 권역이나 필터로 고른 권역과는 다른 개념이므로 색을 달리한다.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !data) return
    const src = map.getSource('emergency-region') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const hospital = data.hospitals.find((h) => h.id === selectedId)
    const regionIds = hospital
      ? [...new Set(activeEmergency(hospital).map((e) => e.emergencyRegionId).filter(Boolean))]
      : []
    setEmergencyRegions(
      hospital ? [...new Set(activeEmergency(hospital).map((e) => e.emergencyRegionName))] : [],
    )
    if (regionIds.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const codes = highlightedSgg(data.regions, new Set(regionIds as string[]))
    let cancelled = false
    boundaryFeatures(codes)
      .then((fc) => {
        if (!cancelled) src.setData(fc)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedId, ready, data])

  // 선택한 기관이 화면 밖이면 그 위치로 옮긴다. 패널 폭만큼 치우쳐 보이지 않도록 보정한다.
  // 기관을 새로 고를 때(flyToken 변화)만 움직인다. 필터를 바꿀 때마다 지도가 튀지 않게 shown 에는 묶지 않는다.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selectedId || flyToken === 0 || !data) return
    const target: Institution | undefined =
      data.hospitals.find((h) => h.id === selectedId) ?? data.schools.find((s) => s.id === selectedId)
    if (target?.coord.lat == null || target.coord.lon == null) return
    const point: [number, number] = [target.coord.lon, target.coord.lat]
    // 상세 패널에 가린 영역 밖으로 보이도록 화면 중심을 옮긴다.
    // 넓은 화면은 오른쪽 패널만큼, 좁은 화면은 아래 시트만큼 비켜 둔다.
    const canvas = map.getCanvas()
    const wide = window.matchMedia('(min-width: 1024px)').matches
    const offset: [number, number] = wide ? [0, 0] : [0, -canvas.clientHeight * 0.22]
    // 단과대학 탭을 바꿨을 때는 화면 안에 있어도 그 단과대학을 가운데로 옮긴다.
    if (useStore.getState().flyCenter || !map.getBounds().contains(point) || map.getZoom() < 9) {
      map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 10.5), offset, duration: 650 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, flyToken, ready])

  // 라벨 배치
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const recompute = () => {
      const canvas = map.getCanvas()
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const zoom = map.getZoom()
      const limit = zoom < 7 ? 14 : zoom < 9 ? 30 : zoom < 11 ? 60 : 140
      const cands = features.map((f) => {
        const p = map.project(f.geometry.coordinates as [number, number])
        return {
          id: String(f.properties.id),
          name: String(f.properties.name),
          x: p.x,
          y: p.y,
          rank: Number(f.properties.rank),
          selected: Boolean(f.properties.selected),
        }
      })
      setLabels(placeLabels(cands, w, h, limit))
    }
    recompute()
    map.on('move', recompute)
    map.on('resize', recompute)
    return () => {
      map.off('move', recompute)
      map.off('resize', recompute)
    }
  }, [features, ready, selectedId])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="map" />
      {mapError && (
        <div className="pointer-events-auto absolute inset-x-4 top-4 z-20 rounded border border-alert/30 bg-white/95 p-3 text-sm text-alert shadow-sm">
          지도를 불러오지 못했습니다. {mapError}
          <button className="ml-2 underline" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      )}
      {emergencyRegions.length > 0 && (
        <p
          data-testid="emergency-region-caption"
          className="pointer-events-none absolute right-3 top-3 z-10 rounded border border-alert/30 bg-paper-raised/95 px-2 py-1 text-2xs text-alert shadow-sm backdrop-blur"
        >
          권역응급의료센터 관할 권역 <strong className="font-semibold">{emergencyRegions.join(' · ')}</strong>
        </p>
      )}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {labels.map((l) => (
          <span
            key={l.id}
            className={
              'absolute -translate-x-1/2 whitespace-nowrap rounded px-1 text-2xs leading-[1.35] ' +
              (l.selected
                ? 'bg-brand text-white font-semibold shadow-sm'
                : 'bg-paper/85 text-ink-soft font-medium')
            }
            style={{ left: l.x, top: l.y + 10 }}
          >
            {l.name}
          </span>
        ))}
      </div>
    </div>
  )
}


/**
 * 좌표가 완전히 겹치는 기관들을 작은 원 위로 흩어 놓는다.
 *
 * 시군구 대표점을 쓰는 의과대학들처럼 같은 점에 모이면 하나만 눌리기 때문이다.
 * 표시 전용 보정이며 데이터의 좌표는 그대로 두고, 상세 패널에는 원래 값을 보여 준다.
 */
function spreadCoincident(items: Institution[]): Map<string, [number, number]> {
  const groups = new Map<string, Institution[]>()
  for (const i of items) {
    const key = `${i.coord.lat!.toFixed(4)},${i.coord.lon!.toFixed(4)}`
    groups.set(key, [...(groups.get(key) ?? []), i])
  }
  const out = new Map<string, [number, number]>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const radius = 0.0016 // 약 160 m
    group.forEach((inst, idx) => {
      const angle = (2 * Math.PI * idx) / group.length
      out.set(inst.id, [
        inst.coord.lon! + radius * Math.cos(angle) * 1.25,
        inst.coord.lat! + radius * Math.sin(angle),
      ])
    })
  }
  return out
}

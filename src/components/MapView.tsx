import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Institution } from '../types'
import { activeEmergency, activeTertiary, highlightedSgg, isHospital } from '../lib/domain'
import type { Institution as Inst } from '../types'
import { allIconSpecs, drawIcon, iconId } from '../lib/mapIcons'
import { buildStyle, KOREA_BOUNDS } from '../lib/mapStyle'
import { useStore } from '../store'

const BASE = import.meta.env.BASE_URL

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

  const data = useStore((s) => s.data)
  const selectedId = useStore((s) => s.selectedId)
  const flyToken = useStore((s) => s.flyToken)
  const subRegions = useStore((s) => s.filters.subRegions)
  const select = useStore((s) => s.select)

  const features = useMemo(() => {
    const placed = shown.filter((i) => i.coord.lat != null && i.coord.lon != null)
    const offsets = spreadCoincident(placed)
    return placed
      .map((i) => {
        const hospital = isHospital(i)
        const tertiary = hospital ? !!activeTertiary(i) : false
        const emergency = hospital ? activeEmergency(i).length > 0 : false
        const name = hospital ? i.commonName || i.officialName : `${i.universityName} ${i.schoolKind}`
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
            icon: iconId({
              kind: hospital ? 'hospital' : 'school',
              tertiary,
              emergency,
              selected: i.id === selectedId,
            }),
          },
          geometry: { type: 'Point' as const, coordinates: offsets.get(i.id) ?? [i.coord.lon!, i.coord.lat!] },
        }
      })
  }, [shown, selectedId])

  // 지도 초기화 (한 번만)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let map: MlMap
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildStyle(BASE),
        bounds: KOREA_BOUNDS,
        fitBoundsOptions: { padding: 36 },
        minZoom: 5,
        maxZoom: 17,
        attributionControl: false,
      })
    } catch (e) {
      setMapError(e instanceof Error ? e.message : '지도를 초기화하지 못했습니다')
      return
    }
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '경계: <a href="https://github.com/vuski/admdongkor" target="_blank" rel="noreferrer">admdongkor</a> (통계청 SGIS, CC BY 4.0) · 좌표: © OpenStreetMap contributors (ODbL)',
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
    fetch(`${BASE}geo/sgg.json`)
      .then((r) => r.json())
      .then((gj: GeoJSON.FeatureCollection) => {
        src.setData({
          type: 'FeatureCollection',
          features: gj.features.filter((f) => codes.has(String(f.properties?.sggcd))),
        })
      })
      .catch(() => undefined)
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
    if (regionIds.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const codes = highlightedSgg(data.regions, new Set(regionIds as string[]))
    let cancelled = false
    fetch(`${BASE}geo/sgg.json`)
      .then((r) => r.json())
      .then((gj: GeoJSON.FeatureCollection) => {
        if (cancelled) return
        src.setData({
          type: 'FeatureCollection',
          features: gj.features.filter((f) => codes.has(String(f.properties?.sggcd))),
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedId, ready, data])

  // 선택한 기관이 화면 밖이면 그 위치로 옮긴다. 패널 폭만큼 치우쳐 보이지 않도록 보정한다.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !selectedId || flyToken === 0) return
    const target = shown.find((i) => i.id === selectedId)
    if (!target?.coord.lat || !target.coord.lon) return
    const point: [number, number] = [target.coord.lon, target.coord.lat]
    // 상세 패널에 가린 영역 밖으로 보이도록 화면 중심을 옮긴다.
    // 넓은 화면은 오른쪽 패널만큼, 좁은 화면은 아래 시트만큼 비켜 둔다.
    const canvas = map.getCanvas()
    const wide = window.matchMedia('(min-width: 1024px)').matches
    const offset: [number, number] = wide ? [0, 0] : [0, -canvas.clientHeight * 0.22]
    if (!map.getBounds().contains(point) || map.getZoom() < 9) {
      map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 10.5), offset, duration: 650 })
    }
  }, [selectedId, flyToken, ready, shown])

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
          selected: f.properties.id === selectedId,
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
function spreadCoincident(items: Inst[]): Map<string, [number, number]> {
  const groups = new Map<string, Inst[]>()
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

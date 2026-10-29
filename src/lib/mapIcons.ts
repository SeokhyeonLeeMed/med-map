/**
 * 마커 아이콘을 캔버스로 만들어 MapLibre 에 등록한다.
 *
 * 외부 스프라이트나 글리프 서버를 쓰지 않으므로 API 키도, 사용량 제한도 없다.
 * 모양(원/사각)으로 기관 유형을, 바깥 테두리로 상급종합병원을,
 * 오른쪽 위 점으로 권역응급의료센터를 구별한다. 색만으로 구별하지 않는다.
 */

export const ICON_PX = 44 // 아이콘 원본 크기. 지도에서는 icon-size 로 줄여 쓴다.

export interface IconSpec {
  kind: 'hospital' | 'school'
  tertiary: boolean
  emergency: boolean
  selected: boolean
}

export function iconId(spec: IconSpec): string {
  return [
    spec.kind,
    spec.tertiary ? 't' : '-',
    spec.emergency ? 'e' : '-',
    spec.selected ? 's' : '-',
  ].join('')
}

export function allIconSpecs(): IconSpec[] {
  const out: IconSpec[] = []
  for (const kind of ['hospital', 'school'] as const)
    for (const tertiary of [false, true])
      for (const emergency of [false, true])
        for (const selected of [false, true]) out.push({ kind, tertiary, emergency, selected })
  return out
}

const FILL = { hospital: '#1f5f4f', school: '#8a5a1f' }
const SELECTED_FILL = { hospital: '#0f3b31', school: '#5c3a12' }

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function drawIcon(spec: IconSpec): ImageData {
  const size = ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스 2D 컨텍스트를 만들 수 없습니다')

  const cx = size / 2
  const core = spec.selected ? 11 : 9
  const fill = (spec.selected ? SELECTED_FILL : FILL)[spec.kind]

  if (spec.selected) {
    ctx.beginPath()
    ctx.arc(cx, cx, core + 7, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(31, 95, 79, 0.16)'
    ctx.fill()
  }

  // 상급종합병원: 바깥에 한 겹 더 두른 테두리
  if (spec.tertiary) {
    ctx.beginPath()
    ctx.arc(cx, cx, core + 4.5, 0, Math.PI * 2)
    ctx.strokeStyle = fill
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  ctx.save()
  ctx.shadowColor = 'rgba(16, 24, 32, 0.28)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  if (spec.kind === 'hospital') {
    ctx.beginPath()
    ctx.arc(cx, cx, core, 0, Math.PI * 2)
  } else {
    roundedRect(ctx, cx - core, cx - core, core * 2, core * 2, 3.5)
  }
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()

  ctx.lineWidth = spec.selected ? 2.6 : 2
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  // 권역응급의료센터: 오른쪽 위 작은 점
  if (spec.emergency) {
    const bx = cx + core * 0.78
    const by = cx - core * 0.78
    ctx.beginPath()
    ctx.arc(bx, by, 4.4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(bx, by, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#a8342a'
    ctx.fill()
  }

  return ctx.getImageData(0, 0, size, size)
}

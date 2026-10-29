import type { StyleSpecification } from 'maplibre-gl'

/**
 * 외부 타일 서비스를 쓰지 않는 지도 스타일.
 *
 * 배경 + 행정구역 경계 GeoJSON 만으로 지도를 그린다. API 키도 사용량 제한도 없고,
 * 정적 호스팅에 그대로 올릴 수 있다. 라벨은 글리프 서버가 필요 없도록
 * 지도 위 DOM 요소로 따로 그린다(MapLabels).
 */
export function buildStyle(base: string): StyleSpecification {
  return {
    version: 8,
    // glyphs 는 넣지 않는다. 텍스트 레이어가 없으므로 글리프 서버가 필요 없고,
    // 키를 undefined 로 두면 스타일 검증에서 거부된다.
    sources: {
      sido: { type: 'geojson', data: `${base}geo/sido.json` },
      sgg: { type: 'geojson', data: `${base}geo/sgg.json` },
      highlight: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'emergency-region': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      institutions: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e4e9e7' } },

      // 육지 면. 바다와 또렷이 갈리도록 밝게 두고 가장자리에 옅은 테두리를 준다.
      {
        id: 'sido-fill',
        type: 'fill',
        source: 'sido',
        paint: { 'fill-color': '#fcfcfa', 'fill-opacity': 1 },
      },
      {
        id: 'coastline',
        type: 'line',
        source: 'sido',
        paint: { 'line-color': '#c4cdc8', 'line-width': 1, 'line-opacity': 0.9 },
      },

      // 선택한 권역 하이라이트
      {
        id: 'region-highlight',
        type: 'fill',
        source: 'highlight',
        paint: { 'fill-color': '#1f5f4f', 'fill-opacity': 0.1 },
      },
      {
        id: 'region-highlight-line',
        type: 'line',
        source: 'highlight',
        paint: { 'line-color': '#1f5f4f', 'line-width': 1.4, 'line-opacity': 0.55 },
      },

      // 선택한 권역응급의료센터의 공식 관할 권역. 필터 하이라이트와 색을 달리해 섞이지 않게 한다.
      {
        id: 'emergency-region-fill',
        type: 'fill',
        source: 'emergency-region',
        paint: { 'fill-color': '#a8342a', 'fill-opacity': 0.09 },
      },
      {
        id: 'emergency-region-line',
        type: 'line',
        source: 'emergency-region',
        paint: { 'line-color': '#a8342a', 'line-width': 1.6, 'line-opacity': 0.6, 'line-dasharray': [3, 2] },
      },

      // 시군구 경계: 확대할수록 또렷해진다
      {
        id: 'sgg-line',
        type: 'line',
        source: 'sgg',
        paint: {
          'line-color': '#b9beb6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.2, 8, 0.5, 10, 0.9, 13, 1.3],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, 0.25, 9, 0.7, 11, 1],
        },
      },

      // 시도 경계: 축소했을 때 가장 또렷하고, 확대하면 한 발 물러선다
      {
        id: 'sido-line',
        type: 'line',
        source: 'sido',
        paint: {
          'line-color': ['interpolate', ['linear'], ['zoom'], 6, '#6f7a72', 11, '#98a3b0'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 7, 1.3, 10, 1.8, 13, 2.2],
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 1, 11, 0.8, 14, 0.55],
        },
      },

      // 기관 마커. 확대 배율에 정비례하지 않도록 최소·최대 크기를 두고 보간한다.
      {
        id: 'institutions',
        type: 'symbol',
        source: 'institutions',
        layout: {
          'icon-image': ['get', 'icon'],
          // 확대 배율에 정비례하지 않도록 양 끝을 눌러 둔다: 가장 축소해도 보이고, 가장 확대해도 커지지 않는다.
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.52, 8, 0.66, 11, 0.82, 14, 0.96, 17, 1.04],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'sortKey'],
        },
      },
    ],
  }
}

/** 첫 화면 범위. 기관이 있는 본토와 제주를 꽉 채운다. 울릉·독도는 밀어서 볼 수 있다. */
export const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [125.3, 33.05],
  [129.75, 38.65],
]

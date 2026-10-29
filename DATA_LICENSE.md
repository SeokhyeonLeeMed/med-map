# 데이터 출처와 라이선스

이 저장소의 **코드**는 MIT 라이선스(`LICENSE`)를 따릅니다. 데이터는 아래 조건을 따릅니다.

## 행정구역 경계 — `public/geo/`

- 출처: [vuski/admdongkor](https://github.com/vuski/admdongkor) (스냅샷 `ver20261001`)
- 원자료: 통계청 SGIS 행정구역경계 (공공누리 제1유형)
- 라이선스: CC BY 4.0
- 조건: 출처 표시. 지도 하단 어트리뷰션에 표기되어 있습니다.

## 기관 좌표 — `public/data/hospitals.json`, `medical-schools.json` 의 `coord`

- 출처: OpenStreetMap (Overpass API, Nominatim)
- 라이선스: ODbL 1.0, © OpenStreetMap contributors
- 조건: 출처 표시, 동일 조건 변경 허락. 지도 하단 어트리뷰션에 표기되어 있습니다.

## 공공기관 발표 자료에서 옮긴 수치

보건복지부 상급종합병원 지정 명단, 권역응급의료센터 선정 명단, 전공의 모집인원,
교육부 의과대학 정원, 건강보험심사평가원 병상 수.

사실 자료를 옮긴 것이며, 각 값에 출처 ID·기준일·확인일을 붙여
`data/sources.json` 과 `public/data/sources.json` 에 기록했습니다.
각 기관의 공공누리 조건을 확인하고 쓰시기 바랍니다.

## 원자료 파일

보건복지부 모집 공고 PDF 와 메디컬 목록 엑셀 원본은 **저장소에 포함되어 있지 않습니다.**
재배포 조건을 확인하지 않았기 때문입니다. 데이터를 다시 만들려면 README 의
"데이터 다시 만들기"를 참고해 원자료를 직접 준비하세요.

## 기관 로고 — `public/logos/`

병원·대학 로고는 각 기관의 **상표**입니다. 재배포 허락을 확인하지 못해
`.gitignore` 로 제외했고, 저장소와 배포본에는 포함되지 않습니다.
로고가 없는 기관은 화면에서 공통 기본 표식으로 그려집니다.

로고를 공개 배포에 포함하려면 각 기관의 허락을 먼저 확인하세요.

## 서체

Pretendard (SIL Open Font License 1.1) — jsDelivr CDN 에서 불러옵니다.

## 지도 라이브러리

MapLibre GL JS (BSD-3-Clause)

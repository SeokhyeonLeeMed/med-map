import type { Hospital, HospitalNetwork, MedicalSchool, Regions, Relation, SourceRef } from '../types'

/** public/data/jp.json 의 모양(scripts/jp_build.py 가 만든다) */
export interface JapanFile {
  meta: { country: 'JP'; asOf: string; note: string; counts: Record<string, number> }
  hospitals: Hospital[]
  schools: MedicalSchool[]
  relations: Relation[]
  networks: HospitalNetwork[]
  regions: Regions
  sources: SourceRef[]
}

/** 일본 의료인 수 항목. 원자료 열 이름 앞부분(…Full = 상근, …Part = 비상근 상근 환산) */
export const JP_STAFF_ROWS: Array<{ key: string; label: string }> = [
  { key: 'doctors', label: '의사 (医師)' },
  { key: 'dentists', label: '치과의사 (歯科医師)' },
  { key: 'nurses', label: '간호사 (看護師)' },
  { key: 'assistNurses', label: '준간호사 (准看護師)' },
  { key: 'pharmacists', label: '약사 (薬剤師)' },
]

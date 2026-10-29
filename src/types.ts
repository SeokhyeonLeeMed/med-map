/** 데이터 모델. public/data/*.json 의 구조와 1:1 로 맞춘다. */

export type VerificationStatus = '확인됨' | '일부확인' | '미확인' | '자료 간 불일치' | '해당 없음'

/** 값을 모를 수 있는 항목은 모두 이 꼴로 감싼다. 미확인과 실제 0을 혼동하지 않기 위해서다. */
export interface Sourced<T> {
  value?: T
  status: VerificationStatus
  sourceId?: string
  asOf?: string
  note?: string
}

export interface Coord {
  lat?: number
  lon?: number
  sourceId?: string
  status: VerificationStatus
  /** 'exact' | '시군구 대표점' | 'approximate' */
  precision?: string
  asOf?: string
  note?: string
}

export interface BedCount {
  kind: string
  value: number
  sourceId: string
  asOf: string
  status: VerificationStatus
  note?: string
}

export interface TertiaryDesignation {
  value: string
  term: string
  careRegion: string
  validFrom: string
  validTo: string
  sourceId: string
  status: VerificationStatus
}

export interface EmergencyDesignation {
  termId: string
  emergencyRegionId: string | null
  emergencyRegionName: string
  validFrom: string
  validTo: string
  newlyDesignated: boolean
  pendingUntil?: string | null
  /** 가장 나중 지정 기수인지. 이 값이 참인 것만 '현재 지정'으로 센다. */
  isCurrent: boolean
  sourceId: string
  status: VerificationStatus
}

export interface UniversityRelation {
  schoolId: string
  universityName: string
  relationType: string
}

export interface Address {
  value?: string
  postcode?: string | null
  sourceId?: string
  asOf?: string
  status: VerificationStatus
}

export interface Department {
  name: string
  code: string
  /** 그 과목의 전문의 수. 의사 수·교수 수와 다른 지표다. */
  specialists: number | null
}

export interface DepartmentBlock {
  status: VerificationStatus
  sourceId?: string
  asOf?: string
  items: Department[]
  note?: string
}

export interface Staffing {
  status: VerificationStatus
  sourceId?: string
  asOf?: string
  metric?: string
  totalDoctors?: number | null
  totalSpecialists?: number | null
  residentsOnDuty?: number | null
  internsOnDuty?: number | null
  note?: string
}

export interface BedDetail {
  total: number
  breakdown: Record<string, number>
  sourceId: string
  asOf: string
  status: VerificationStatus
  note?: string
}

export interface Hospital {
  id: string
  type: 'hospital'
  officialName: string
  commonName: string
  preferredName?: string
  aliases: string[]
  variantNames?: string[]
  coord: Coord
  sgg: string | null
  sggName?: string
  subRegionId: string | null
  macroRegionIds: string[]
  address: Address
  phone?: string | null
  openedOn?: string | null
  /** 심평원 종별: 상급종합 · 종합병원 · 병원 등. 공식 분류다. */
  hiraKind: string | null
  /** 요양기관이 아닌 수련기관(보건대학원·연구원 등)일 때만 채워진다. */
  institutionKind?: string
  /** 같은 이름의 다른 기관이 있어 표시명에 소재지를 덧붙였는지 */
  nameDisambiguated?: boolean
  hiraId?: string
  beds: BedCount[]
  bedDetail: BedDetail | null
  designations: {
    tertiary: TertiaryDesignation | null
    emergency: EmergencyDesignation[]
  }
  universityRelations: UniversityRelation[]
  homepage: string | null
  logo: string | null
  /** 출처가 여럿이면 sourceIds 에 모두 적는다. */
  history: Sourced<string> & { sourceIds?: string[] }
  centers: { status: VerificationStatus; items: unknown[]; note?: string }
  departments: DepartmentBlock
  staffing: Staffing
}

export interface Quota {
  admissionYear: number
  kind: string
  value: number | null
  sourceId: string
  asOf: string
  status: VerificationStatus
  note?: string
}

export interface MedicalSchool {
  id: string
  type: 'medicalSchool'
  officialName: string
  universityName: string
  schoolKind: string
  aliases: string[]
  sgg: string | null
  sggName: string | null
  subRegionId: string | null
  macroRegionIds: string[]
  coord: Coord
  universityUrl: string | null
  schoolUrl: string | null
  founded: Sourced<string>
  quota: Quota[]
  logo: string | null
  sourceId: string
  asOf: string
}

export type Institution = Hospital | MedicalSchool

export interface Relation {
  fromId: string
  fromType: 'medicalSchool' | 'hospital'
  toId: string
  toType: 'medicalSchool' | 'hospital'
  relationType: string
  sourceId: string
  asOf: string
  status: VerificationStatus
}

export interface TrainingUnit {
  id: string
  name: string
  rawNames: string[]
  recruitRegion: string
  hospitalIds: string[]
  medicalSchoolIds: string[]
  unmatchedHospitals: string[]
  integratedTraining: boolean
  note?: string | null
}

/**
 * 한 기관의 모집 기록 한 줄.
 *
 * 파일에서는 비어 있는 칸을 싣지 않으므로 대부분의 필드가 선택적이다.
 * '정원'(한 해 배정)과 '모집인원'(한 차례 모집)은 다른 지표라 quotaKind 로 구별한다.
 */
export interface RecruitmentRecord {
  year: number
  term: string
  track: '인턴' | '레지던트'
  quotaKind: string
  quota: number
  specialty?: string
  quotaBreakdown?: Record<string, number>
  flexible?: boolean
  integratedTraining?: boolean
  mojaAgreement?: boolean
  /** 통합수련 단위의 수치인 경우 그 단위 */
  unitId?: string
  unitName?: string
  unitHospitalIds?: string[]
  sourceId: string
  asOf: string
  status: VerificationStatus
  note?: string
}

/** 기관 ID → 그 기관의 모집 기록. 상세 패널을 처음 열 때 받아 온다. */
export type RecruitmentByInstitution = Record<string, RecruitmentRecord[]>

export interface RecruitmentFile {
  meta: { note: string; unverified: string; records: number }
  byInstitution: RecruitmentByInstitution
}

export interface SubRegion {
  id: string
  order: number
  name: string
  macroRegions: string[]
  sgg: string[]
  note?: string
  addedBeyondPrompt?: boolean
  addedReason?: string
}

export interface MacroRegion {
  id: string
  name: string
  sidocd: string
  officialName: string
  subRegions: string[]
}

export interface Regions {
  meta: Record<string, unknown>
  macroRegions: MacroRegion[]
  subRegions: SubRegion[]
}

export interface SourceRef {
  id: string
  title: string
  publisher: string
  kind: string
  url?: string
  mirrorUrl?: string
  localFile?: string
  license?: string
  publishedOn?: string
  asOf?: string
  retrievedOn?: string
  note?: string
}

export interface NationalTotal {
  year: number
  term: string
  track: string
  metric: string
  value: number
  institutionCount?: number
  sourceId: string
  status: VerificationStatus
  note?: string
}

export interface Coverage {
  nationalTotals: NationalTotal[]
  coverageWarning: string
  note: string
  changeNote?: string
  /** 빌드 시점 집계. 모집 기록을 지연 로딩하더라도 수록 범위를 정확히 보여 주기 위해 둔다. */
  counts?: Record<string, number>
}

/** 기관별 '어느 해 어떤 과정의 모집 자료가 있는가'. 첫 화면은 이것만으로 그린다. */
export interface TrainingIndexEntry {
  tracks: string[]
  years: number[]
}
export type TrainingIndex = Record<string, TrainingIndexEntry>

export interface Dataset {
  hospitals: Hospital[]
  schools: MedicalSchool[]
  relations: Relation[]
  trainingUnits: TrainingUnit[]
  trainingIndex: TrainingIndex
  /** 상세 패널을 처음 열 때 받아 온다. 그 전에는 빈 객체다. */
  recruitment: RecruitmentByInstitution
  regions: Regions
  sources: SourceRef[]
}

/** 병원 특성 필터 키. 공식 지정과 서비스 편의 분류를 섞지 않도록 의미를 분리해 둔다. */
export type HospitalTrait = 'tertiary' | 'secondary' | 'university' | 'emergency'

export interface Filters {
  subRegions: string[]
  kinds: Array<'hospital' | 'medicalSchool'>
  traits: HospitalTrait[]
  query: string
}

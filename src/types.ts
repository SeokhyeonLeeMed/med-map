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
  sourceId: string
  status: VerificationStatus
}

export interface UniversityRelation {
  schoolId: string
  universityName: string
  relationType: string
}

export interface Hospital {
  id: string
  type: 'hospital'
  officialName: string
  commonName: string
  preferredName?: string
  aliases: string[]
  coord: Coord
  sgg: string | null
  sggName?: string
  subRegionId: string | null
  macroRegionIds: string[]
  beds: BedCount[]
  designations: {
    tertiary: TertiaryDesignation | null
    emergency: EmergencyDesignation[]
  }
  universityRelations: UniversityRelation[]
  homepage: string | null
  logo: string | null
  history: Sourced<string>
  centers: { status: VerificationStatus; items: unknown[]; note?: string }
  departments: { status: VerificationStatus; items: unknown[]; note?: string }
  staffing: { status: VerificationStatus; note?: string }
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

export interface RecruitmentRecord {
  /** 모집 단위를 아는 경우. 2023년 일부 자료처럼 단위를 모르면 null 이고 hospitalIds 로만 잇는다. */
  trainingUnitId: string | null
  year: number
  term: string
  track: '인턴' | '레지던트'
  specialty: string | null
  quotaKind: string
  quota: number
  flexible: boolean
  integratedTraining: boolean
  mojaAgreement: boolean
  appliedCount: { status: VerificationStatus; value?: number }
  matchedCount: { status: VerificationStatus; value?: number }
  sourceId: string
  asOf: string
  status: VerificationStatus
  /** 2023년처럼 전체 명단을 확보하지 못한 자료에 붙는 경고 */
  coverageWarning?: string | null
  note?: string | null
  hospitalIds: string[]
  /** 예방의학과처럼 의과대학이 모집 단위인 경우 */
  medicalSchoolIds: string[]
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
}

export interface Dataset {
  hospitals: Hospital[]
  schools: MedicalSchool[]
  relations: Relation[]
  trainingUnits: TrainingUnit[]
  recruitment: RecruitmentRecord[]
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

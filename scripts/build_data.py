# -*- coding: utf-8 -*-
"""원자료 + 큐레이션 → public/data/*.json (앱이 읽는 최종 데이터).

입력
  .cache/extracted/*.json   extract_sources.py 결과
  data/regions.json         권역 정의
  data/designations.json    상급종합·권역응급의료센터 공식 지정
  data/sources.json         출처 목록
  data/curation/*.json      사람이 확정한 좌표·별칭·수련 모집 단위 매핑

원칙
  - 확인하지 못한 값은 0이나 빈 문자열로 채우지 않고 status="미확인" 으로 남긴다.
  - 모든 핵심 값에는 sourceId 와 기준일(asOf)을 붙인다.
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import core, display_name, normalize  # noqa: E402
from romanize import slug  # noqa: E402
from geo_match import SggIndex  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACT = os.path.join(ROOT, ".cache", "extracted")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "data")

UNVERIFIED = "미확인"
VERIFIED = "확인됨"
PARTIAL = "일부확인"


def read(*parts: str):
    return json.load(io.open(os.path.join(*parts), encoding="utf-8"))


def write(obj, name: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    n = len(obj) if isinstance(obj, list) else len(obj.get("items", obj))
    print(f"  {name}: {n}건, {os.path.getsize(path) // 1024} KB")


class Build:
    def __init__(self) -> None:
        self.regions = read(DATA, "regions.json")
        self.designations = read(DATA, "designations.json")
        self.coords = read(DATA, "curation", "coordinates.json")
        self.extra_hospitals = read(DATA, "curation", "extra-hospitals.json")["hospitals"]
        self.canonical_name = read(DATA, "curation", "hospital-aliases.json")["canonical"]
        self.school_coords = read(DATA, "curation", "school-coordinates.json")["schools"]
        self.relation_fixes = read(DATA, "curation", "relation-corrections.json")
        self.logos = self.load_logos()
        self.recruit2023 = read(DATA, "recruitment-2023.json")
        self.schools_raw = read(EXTRACT, "xlsx_schools.json")["schools"]
        self.intern = read(EXTRACT, "recruit_2026h2_intern.json")
        self.resident = read(EXTRACT, "recruit_2026h2_resident.json")
        self.geo = read(ROOT, ".cache", "geo_match.json")
        self.sgg_index = SggIndex(os.path.join(ROOT, "public", "geo", "sgg.json"))

        self.sgg_to_sub = {}
        for sr in self.regions["subRegions"]:
            for code in sr["sgg"]:
                self.sgg_to_sub[code] = sr["id"]
        self.sub_to_macro = {sr["id"]: sr["macroRegions"] for sr in self.regions["subRegions"]}
        self.sido_to_macro = {m["sidocd"]: m["id"] for m in self.regions["macroRegions"]}

        self.sgg_name = {}
        for f in read(ROOT, "public", "geo", "sgg.json")["features"]:
            p = f["properties"]
            self.sgg_name[p["sggcd"]] = f'{p["sidonm"]} {p["sggnm"]}'

        self.hospitals: dict[str, dict] = {}   # coreKey -> record
        self.by_core: dict[str, str] = {}      # coreKey -> hospitalId
        self.school_ids: dict[str, str] = {}   # coreKey -> medicalSchoolId
        self.taken_ids: set[str] = set()
        self.warnings: list[str] = []

    def load_logos(self) -> dict[str, str]:
        """manifest 에 있고 public/logos/ 에 실제로 복사된 로고만 연결한다.

        파일이 없는데 경로만 적어 두면 화면에 깨진 이미지가 뜨므로, 실물이 있는 것만 쓴다.
        로고가 없는 기관은 화면에서 공통 기본 표식으로 그려진다.
        """
        path = os.path.join(DATA, "curation", "logo-manifest.json")
        if not os.path.exists(path):
            return {}
        entries = json.load(io.open(path, encoding="utf-8")).get("entries", {})
        out = {}
        for iid, e in entries.items():
            name = e.get("fileName")
            if not name:
                continue
            ext = os.path.splitext(name)[1].lower()
            rel = f"logos/{iid}{ext}"
            if os.path.exists(os.path.join(ROOT, "public", rel)):
                out[iid] = rel
        return out

    # ---------------------------------------------------------- 병원

    def hospital_for(self, raw_name: str, create: bool = True) -> dict | None:
        canonical = self.canonical_name.get(raw_name.strip())
        key = core(canonical or raw_name)
        if canonical and canonical != raw_name:
            rec = self.hospitals.get(key)
            if rec is None and create:
                rec = self.hospital_for(canonical)
            if rec is not None and raw_name not in rec["sourceNames"]:
                rec["sourceNames"].append(raw_name)
            if rec is not None:
                rec["preferredName"] = canonical
                return rec
        if key in self.hospitals:
            rec = self.hospitals[key]
            if raw_name not in rec["sourceNames"]:
                rec["sourceNames"].append(raw_name)
            return rec
        if not create:
            return None
        # 병합 키(core)는 표기 차이를 흡수하느라 많이 줄어들므로, ID 는 원래 이름에서 만든다.
        hid = slug("h", normalize(canonical or raw_name), self.taken_ids)
        rec = {
            "id": hid,
            "type": "hospital",
            "officialName": raw_name,
            "sourceNames": [raw_name],
            "aliases": [],
            "coord": None,
            "sgg": None,
            "subRegionId": None,
            "macroRegionIds": [],
            "beds": [],
            "designations": {"tertiary": None, "emergency": []},
            "universityRelations": [],
            "homepage": None,
            "logo": None,
            "history": {"status": UNVERIFIED},
            "centers": {"status": UNVERIFIED, "items": []},
            "departments": {"status": UNVERIFIED, "items": []},
            "staffing": {"status": UNVERIFIED, "note": "센터·전문과별 근무 인원은 공식 자료로 확인된 기관이 없어 모두 미확인이다."},
        }
        self.hospitals[key] = rec
        self.by_core[key] = hid
        return rec

    def pick_official_name(self) -> None:
        """여러 출처 표기 중 가장 긴(법인격 포함) 이름을 공식 명칭으로, 나머지는 별칭으로."""
        for rec in self.hospitals.values():
            names = sorted(set(rec["sourceNames"]), key=lambda s: (-len(s), s))
            rec["officialName"] = names[0]
            rec["commonName"] = display_name(rec["officialName"])
            rec["aliases"] = sorted({n for n in names if n != rec["officialName"]} | set(rec["aliases"]))

    def add_extra_hospitals(self) -> None:
        """공고에만 나오는 수련병원을 등록하고, 손으로 확인한 좌표를 좌표표에 합친다."""
        for e in self.extra_hospitals:
            self.hospital_for(e["name"])
            if e["name"] not in self.coords:
                self.coords[e["name"]] = e

    def attach_location(self) -> None:
        for rec in self.hospitals.values():
            name = rec["officialName"]
            manual = None
            for src_name in rec["sourceNames"]:
                if src_name in self.coords:
                    manual = self.coords[src_name]
                    break
            if manual and manual.get("lat") is not None:
                lat, lon, src = manual["lat"], manual["lon"], manual.get("source", "src-osm")
                precision = manual.get("precision", "exact")
            else:
                cands = []
                for src_name in rec["sourceNames"]:
                    cands += self.geo.get(src_name, {}).get("candidates", [])
                best = max(cands, key=lambda c: c["score"], default=None)
                if best and best["score"] >= 0.6:
                    lat, lon, src, precision = best["lat"], best["lon"], "src-osm", "exact"
                else:
                    rec["coord"] = {"status": UNVERIFIED}
                    self.warnings.append(f"좌표 미확인: {name}")
                    continue
            code, _ = self.sgg_index.code_at(lon, lat)
            rec["coord"] = {
                "lat": lat, "lon": lon, "sourceId": src,
                "status": VERIFIED if precision == "exact" else PARTIAL,
                "precision": precision,
                "asOf": "2026-10-29",
            }
            if code:
                rec["sgg"] = code
                rec["sggName"] = self.sgg_name.get(code)
                sub = self.sgg_to_sub.get(code)
                rec["subRegionId"] = sub
                rec["macroRegionIds"] = self.sub_to_macro.get(sub, [])
            else:
                self.warnings.append(f"좌표가 어느 시군구에도 들어가지 않음: {name}")

    def attach_designations(self) -> None:
        d = self.designations
        t = d["sangjongType"]
        for care_region, names in t["byCareRegion"].items():
            for n in names:
                rec = self.hospital_for(n, create=False) or self.hospital_for(n)
                rec["designations"]["tertiary"] = {
                    "value": "상급종합병원",
                    "term": t["term"],
                    "careRegion": care_region,
                    "validFrom": t["validFrom"],
                    "validTo": t["validTo"],
                    "sourceId": t["sourceId"],
                    "status": VERIFIED,
                }
        for term in d["regionalEmergencyCenters"]:
            for e in term["entries"]:
                rec = self.hospital_for(e["name"], create=False) or self.hospital_for(e["name"])
                rec["designations"]["emergency"].append(
                    {
                        "termId": term["termId"],
                        "emergencyRegionId": self.emergency_region_id(e["emergencyRegion"]),
                        "emergencyRegionName": e["emergencyRegion"],
                        "validFrom": term["validFrom"],
                        "validTo": term["validTo"],
                        "newlyDesignated": e.get("new", False),
                        "pendingUntil": e.get("pendingUntil"),
                        "sourceId": term["sourceId"],
                        "status": VERIFIED,
                    }
                )

    def emergency_region_id(self, name: str) -> str | None:
        for sr in self.regions["subRegions"]:
            if sr["name"] == name:
                return sr["id"]
        self.warnings.append(f"응급의료권역 이름을 세부권역에서 찾지 못함: {name}")
        return None

    # ---------------------------------------------------------- 의과대학

    def build_schools(self) -> tuple[list, list]:
        schools, relations = [], []
        taken: set[str] = set()
        for s in self.schools_raw:
            uni = s["university"]
            kind = s["schoolKind"]
            sid = slug("ms", core(uni) + ("의전원" if kind == "의학전문대학원" else ""), taken)
            code = self.resolve_sgg(s["sido"], s["sgg"])
            sub = self.sgg_to_sub.get(code) if code else None
            rec = {
                "id": sid,
                "type": "medicalSchool",
                "officialName": f"{uni} {kind}",
                "universityName": uni,
                "schoolKind": kind,
                "aliases": [uni, kind, f"{uni}{kind}"],
                "sgg": code,
                "sggName": self.sgg_name.get(code) if code else None,
                "subRegionId": sub,
                "macroRegionIds": self.sub_to_macro.get(sub, []) if sub else [],
                "coord": self.school_coord(f"{uni} 의과대학", code),
                "universityUrl": s["universityUrl"],
                "schoolUrl": s["deptUrl"],
                "founded": {"value": s["founded"], "sourceId": "src-xlsx-medical-list", "status": VERIFIED if s["founded"] else UNVERIFIED},
                "quota": [
                    {
                        "admissionYear": 2026,
                        "kind": "의과대학 입학정원",
                        "value": s["quota2026"],
                        "sourceId": "src-moe-quota-2027",
                        "asOf": "2026-03",
                        "status": VERIFIED if s["quota2026"] is not None else UNVERIFIED,
                        "note": "2024학년도 기준 정원(2026학년도 모집 기준). 의예과 모집인원·대학 전체 입학정원과 다른 값이다.",
                    },
                    {
                        "admissionYear": 2027,
                        "kind": "의과대학 입학정원 (배정안)",
                        "value": s["quota2027"],
                        "sourceId": "src-moe-quota-2027",
                        "asOf": "2026-03",
                        "status": VERIFIED if s["quota2027"] is not None else UNVERIFIED,
                    },
                ],
                "logo": None,
                "sourceId": "src-xlsx-medical-list",
                "asOf": "2026-09-22",
            }
            schools.append(rec)
            self.school_ids[core(rec["officialName"])] = sid
            for h in s["relatedHospitals"]:
                if "동물병원" in h["rawName"]:
                    continue
                hosp = self.hospital_for(h["rawName"])
                if h["beds"] is not None and not any(b["value"] == h["beds"] for b in hosp["beds"]):
                    hosp["beds"].append(
                        {
                            "kind": "병상 수",
                            "value": h["beds"],
                            "sourceId": "src-hira-beds",
                            "asOf": "2026-09-22",
                            "status": PARTIAL,
                            "note": "허가병상·운영병상·가동병상 구분은 원자료에 없어 확인하지 못했다.",
                        }
                    )
                rel = h["relation"] or UNVERIFIED
                relations.append(
                    {
                        "fromId": sid,
                        "fromType": "medicalSchool",
                        "toId": hosp["id"],
                        "toType": "hospital",
                        "relationType": {"부속": "부속병원", "협력": "교육협력병원", "위탁운영": "위탁운영병원"}.get(rel, rel),
                        "sourceId": "src-xlsx-medical-list",
                        "asOf": "2026-09-22",
                        "status": VERIFIED if h["relation"] else UNVERIFIED,
                    }
                )
                if rel in ("부속", "협력", "위탁운영"):
                    hosp["universityRelations"].append({"schoolId": sid, "universityName": uni, "relationType": rel})
        relations = self.finish_relations(relations, schools)
        return schools, relations

    def finish_relations(self, relations: list[dict], schools: list[dict]) -> list[dict]:
        """같은 관계가 두 번 들어가지 않게 하고, 원자료에서 빠진 관계를 보완한다."""
        seen, out = set(), []
        for rel in relations:
            key = (rel["fromId"], rel["toId"], rel["relationType"])
            if key in seen:
                continue
            seen.add(key)
            out.append(rel)

        by_name = {s["officialName"]: s for s in schools}
        for fix in self.relation_fixes["add"]:
            school = by_name.get(fix["school"])
            hosp = self.hospital_for(fix["hospital"], create=False)
            if school is None or hosp is None:
                self.warnings.append(f"보완 관계를 적용하지 못함: {fix['school']} ↔ {fix['hospital']}")
                continue
            key = (school["id"], hosp["id"], fix["relationType"])
            if key in seen:
                continue
            seen.add(key)
            out.append(
                {
                    "fromId": school["id"], "fromType": "medicalSchool",
                    "toId": hosp["id"], "toType": "hospital",
                    "relationType": fix["relationType"],
                    "sourceId": "src-xlsx-medical-list",
                    "asOf": "2026-09-22",
                    "status": fix["status"],
                    "note": fix["note"],
                }
            )
            hosp["universityRelations"].append(
                {"schoolId": school["id"], "universityName": school["universityName"], "relationType": "부속"}
            )
        return out

    def school_coord(self, query: str, sgg_code: str | None) -> dict:
        """캠퍼스 좌표를 확인한 대학은 그 값을, 나머지는 소재 시군구 대표점을 쓰고 정밀도를 밝힌다."""
        hit = self.school_coords.get(query)
        if hit:
            return {
                "lat": hit["lat"], "lon": hit["lon"], "sourceId": hit["source"],
                "precision": "exact", "status": VERIFIED, "asOf": "2026-10-29",
            }
        if sgg_code:
            lon, lat = self.sgg_index.representative_point(sgg_code)
            if lon is not None:
                return {
                    "lat": round(lat, 6), "lon": round(lon, 6), "sourceId": "src-admdongkor",
                    "precision": "시군구 대표점", "status": PARTIAL, "asOf": "2026-10-01",
                    "note": "캠퍼스 좌표를 확인하지 못해 소재 시군구의 대표점을 썼다. 실제 캠퍼스 위치와 다르다.",
                }
        return {"status": UNVERIFIED}

    def resolve_sgg(self, sido: str | None, sgg: str | None) -> str | None:
        if not sido or not sgg:
            return None
        want = (sido.strip(), sgg.strip().replace(" ", ""))
        for code, label in self.sgg_name.items():
            sd, gg = label.split(" ", 1)
            if sd == want[0] and (gg == want[1] or gg.startswith(want[1])):
                return code
        return None

    # ---------------------------------------------------------- 수련 모집

    def build_recruitment(self) -> tuple[list, list]:
        """모집 단위(trainingUnit)는 기관과 다르다. 통합수련 병원은 한 단위에 여러 기관이 묶인다."""
        mapping = read(DATA, "curation", "training-units.json")["units"]
        by_key = {(u["region"], u["rawName"]): u for u in mapping}
        units, records = {}, []
        for payload, kind, src in (
            (self.intern, "인턴", "src-mohw-recruit-2026h2-intern"),
            (self.resident, "레지던트", "src-mohw-recruit-2026h2-resident"),
        ):
            for r in payload["records"]:
                if "_unparsed" in r:
                    continue
                key = (r["region"], r["hospitalRaw"])
                m = by_key.get(key)
                if not m:
                    self.warnings.append(f"수련 모집 단위 미매핑: {key}")
                    continue
                uid = m["id"]
                if uid not in units:
                    unmatched = [n for n in m["hospitals"] if core(n) not in self.by_core]
                    for n in unmatched:
                        self.warnings.append(f"모집 단위가 가리키는 병원이 레지스트리에 없음: {n}")
                    units[uid] = {
                        "id": uid,
                        "name": m["name"],
                        "rawNames": [],
                        "recruitRegion": r["region"],
                        "hospitalIds": [h for h in (self.by_core.get(core(n)) for n in m["hospitals"]) if h],
                        "medicalSchoolIds": [
                            s for s in (self.school_ids.get(core(n)) for n in m.get("medicalSchools", [])) if s
                        ],
                        "unmatchedHospitals": unmatched,
                        "integratedTraining": m.get("integratedTraining", False),
                        "note": m.get("note"),
                    }
                if r["hospitalRaw"] not in units[uid]["rawNames"]:
                    units[uid]["rawNames"].append(r["hospitalRaw"])
                records.append(
                    {
                        "trainingUnitId": uid,
                        "hospitalIds": units[uid]["hospitalIds"],
                        "medicalSchoolIds": units[uid]["medicalSchoolIds"],
                        "year": payload["year"],
                        "term": payload["half"],
                        "track": kind,
                        "specialty": None if kind == "인턴" else r["specialty"],
                        "quotaKind": "모집인원",
                        "quota": r["quota"],
                        "flexible": r["flexible"],
                        "integratedTraining": r["integratedTraining"],
                        "mojaAgreement": r["mojaAgreement"],
                        "appliedCount": {"status": UNVERIFIED},
                        "matchedCount": {"status": UNVERIFIED},
                        "sourceId": src,
                        "asOf": payload.get("asOf", "2026-08-30"),
                        "status": VERIFIED,
                    }
                )
        records += self.build_recruitment_2023(units)
        return list(units.values()), records

    def build_recruitment_2023(self, units: dict) -> list[dict]:
        """2023년 자료. 공고 원문을 못 구해 전국 총계와 일부 병원 수치만 싣는다.

        모집 단위를 모르는 항목은 병원 ID 로 직접 잇고, 통합수련 단위는 공고 약칭으로 찾는다.
        """
        doc = self.recruit2023
        out: list[dict] = []

        def make(entry, hospital_ids, unit_id, specialty=None, quota=None):
            return {
                "trainingUnitId": unit_id,
                "hospitalIds": hospital_ids,
                "medicalSchoolIds": [],
                "year": entry["year"],
                "term": entry["term"],
                "track": entry["track"],
                "specialty": specialty,
                "quotaKind": "모집인원",
                "quota": entry["quota"] if quota is None else quota,
                "flexible": False,
                "integratedTraining": unit_id is not None and units.get(unit_id, {}).get("integratedTraining", False),
                "mojaAgreement": False,
                "appliedCount": {"status": UNVERIFIED},
                "matchedCount": {"status": UNVERIFIED},
                "sourceId": entry["sourceId"],
                "asOf": "2023",
                "status": entry["status"],
                "note": entry.get("note"),
                # 전체 명단을 확보하지 못한 것은 하반기 자료다. 상반기 병원 공고분에는 붙이지 않는다.
                "coverageWarning": doc["coverageWarning"] if entry["term"] == "하반기" else None,
            }

        for entry in doc["byHospital"] + doc["firstHalfByHospital"]:
            hid = self.by_core.get(core(entry["hospital"]))
            if not hid:
                self.warnings.append(f"2023 자료의 병원을 찾지 못함: {entry['hospital']}")
                continue
            by_spec = entry.get("bySpecialty")
            if by_spec:
                for s2 in by_spec:
                    out.append(make(entry, [hid], None, s2["specialty"], s2["quota"]))
            else:
                out.append(make(entry, [hid], None, None if entry["track"] == "인턴" else "전공과별 미확인"))

        raw_to_unit = {(u["recruitRegion"], raw): u["id"] for u in units.values() for raw in u["rawNames"]}
        for entry in doc["byTrainingUnit"]:
            uid = raw_to_unit.get((entry["region"], entry["unitRawName"]))
            if not uid:
                self.warnings.append(f"2023 자료의 모집 단위를 찾지 못함: {entry['unitRawName']}")
                continue
            out.append(
                make(entry, units[uid]["hospitalIds"], uid, None if entry["track"] == "인턴" else "전공과별 미확인")
            )
        print(f"  2023 모집 레코드 {len(out)}건 (출처 원문 미확보, 일부확인)")
        return out

    # ---------------------------------------------------------- 실행

    def run(self) -> int:
        self.attach_designations()
        self.add_extra_hospitals()
        schools, relations = self.build_schools()
        self.pick_official_name()
        self.attach_location()

        units, recruitment = self.build_recruitment()

        hospitals = sorted(self.hospitals.values(), key=lambda h: h["officialName"])
        for h in hospitals:
            # 어떤 표기들이 한 기관으로 묶였는지 남겨 둔다. 검수와 검색에 함께 쓰인다.
            h["variantNames"] = sorted(set(h.pop("sourceNames", [])))
            h["logo"] = self.logos.get(h["id"])
        for s in schools:
            s["logo"] = self.logos.get(s["id"])
        linked = sum(1 for x in hospitals + schools if x["logo"])
        print(f"  로고 연결 {linked}/{len(hospitals) + len(schools)}"
              + ("" if linked else " (public/logos/ 가 비어 있습니다. `python scripts/build_logos.py --copy`)"))

        write(hospitals, "hospitals.json")
        write(schools, "medical-schools.json")
        write(relations, "institution-relations.json")
        write(units, "training-units.json")
        write(recruitment, "residency-recruitment.json")
        write(self.regions, "regions.json")
        write(read(DATA, "sources.json"), "sources.json")
        write(
            {
                "nationalTotals": self.recruit2023["nationalTotals"],
                "coverageWarning": self.recruit2023["coverageWarning"],
                "note": self.recruit2023["_note"],
            },
            "recruitment-coverage.json",
        )

        if self.warnings:
            print(f"\n  경고 {len(self.warnings)}건")
            for w in sorted(set(self.warnings))[:40]:
                print(f"    - {w}")
        return 0


if __name__ == "__main__":
    sys.exit(Build().run())

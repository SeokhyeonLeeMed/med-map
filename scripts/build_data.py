# -*- coding: utf-8 -*-
"""원자료 + 큐레이션 → public/data/*.json (앱이 읽는 최종 데이터).

입력
  .cache/extracted/*.json    extract_sources.py · extract_quota.py 결과
  .cache/hira/hospitals.json build_hira_index.py 결과 (심평원 병원급 색인)
  .cache/hira_match.json     match_hira.py 결과 (기관명 ↔ 심평원 매칭)
  data/regions.json          권역 정의
  data/designations.json     상급종합·권역응급의료센터 공식 지정
  data/sources.json          출처 목록
  data/curation/*.json       사람이 확정한 좌표·별칭·수련 모집 단위 매핑

원칙
  - 확인하지 못한 값은 0이나 빈 문자열로 채우지 않고 status="미확인" 으로 남긴다.
  - 모든 핵심 값에는 sourceId 와 기준일(asOf)을 붙인다.
  - 정원·재직 인원·전문의 수는 서로 다른 지표이므로 섞지 않는다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_match import SggIndex  # noqa: E402
from normalize import core, display_name, normalize  # noqa: E402
from romanize import slug  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTRACT = os.path.join(ROOT, ".cache", "extracted")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "public", "data")

UNVERIFIED = "미확인"
VERIFIED = "확인됨"
PARTIAL = "일부확인"

HIRA_SOURCE = "src-hira-file-2026"
HIRA_AS_OF = "2026-09-30"


def read(*parts: str):
    return json.load(io.open(os.path.join(*parts), encoding="utf-8"))


def read_opt(*parts: str):
    path = os.path.join(*parts)
    return read(path) if os.path.exists(path) else None


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
        self.schools_raw = read(EXTRACT, "xlsx_schools.json")["schools"]
        self.intern = read(EXTRACT, "recruit_2026h2_intern.json")
        self.resident = read(EXTRACT, "recruit_2026h2_resident.json")
        self.quota_years = read_opt(EXTRACT, "quota_by_year.json")
        self.recruit2023_extra = read(DATA, "recruitment-2023.json")
        self.geo = read_opt(ROOT, ".cache", "geo_match.json") or {}
        self.geo_batch = read_opt(ROOT, ".cache", "geocode_batch.json") or {}
        self.sgg_index = SggIndex(os.path.join(ROOT, "public", "geo", "sgg.json"))

        hira_rows = read_opt(ROOT, ".cache", "hira", "hospitals.json") or []
        self.hira = {r["hiraId"]: r for r in hira_rows}
        self.hira_match = read_opt(ROOT, ".cache", "hira_match.json") or {}
        self.logos = self.load_logos()

        self.sgg_to_sub = {}
        for sr in self.regions["subRegions"]:
            for code in sr["sgg"]:
                self.sgg_to_sub[code] = sr["id"]
        self.sub_to_macro = {sr["id"]: sr["macroRegions"] for sr in self.regions["subRegions"]}

        self.sgg_name = {}
        for f in read(ROOT, "public", "geo", "sgg.json")["features"]:
            p = f["properties"]
            self.sgg_name[p["sggcd"]] = f'{p["sidonm"]} {p["sggnm"]}'

        self.hospitals: dict[str, dict] = {}
        self.by_core: dict[str, str] = {}
        self.school_ids: dict[str, str] = {}
        self.taken_ids: set[str] = set()
        self.warnings: list[str] = []

    def load_logos(self) -> dict[str, str]:
        """manifest 에 있고 public/logos/ 에 실제로 복사된 로고만 연결한다."""
        path = os.path.join(DATA, "curation", "logo-manifest.json")
        if not os.path.exists(path):
            return {}
        entries = read(path).get("entries", {})
        out = {}
        for iid, e in entries.items():
            name = e.get("fileName")
            if not name:
                continue
            # 실제로 복사된 확장자는 manifest 의 copiedExt 에 적혀 있다(build_logos.py 참고).
            ext = e.get("copiedExt") or os.path.splitext(name)[1].lower()
            rel = f"logos/{iid}{ext}"
            if os.path.exists(os.path.join(ROOT, "public", rel)):
                out[iid] = rel
        return out

    # ---------------------------------------------------------- 병원 레지스트리

    def hospital_for(self, raw_name: str, create: bool = True) -> dict | None:
        canonical = self.canonical_name.get(raw_name.strip())
        key = core(canonical or raw_name)
        if canonical and canonical != raw_name:
            rec = self.hospitals.get(key)
            if rec is None and create:
                rec = self.hospital_for(canonical)
            if rec is not None:
                if raw_name not in rec["sourceNames"]:
                    rec["sourceNames"].append(raw_name)
                rec["preferredName"] = canonical
            return rec
        if key in self.hospitals:
            rec = self.hospitals[key]
            if raw_name not in rec["sourceNames"]:
                rec["sourceNames"].append(raw_name)
            return rec
        if not create:
            return None
        hid = slug("h", normalize(raw_name), self.taken_ids)
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
            "address": {"status": UNVERIFIED},
            "phone": None,
            "homepage": None,
            "openedOn": None,
            "hiraKind": None,
            "beds": [],
            "bedDetail": None,
            "designations": {"tertiary": None, "emergency": []},
            "universityRelations": [],
            "logo": None,
            "history": {"status": UNVERIFIED},
            "centers": {"status": UNVERIFIED, "items": [], "note": "운영 센터 목록은 공식 자료로 확인하지 못했다."},
            "departments": {"status": UNVERIFIED, "items": []},
            "staffing": {"status": UNVERIFIED},
        }
        self.hospitals[key] = rec
        self.by_core[key] = hid
        return rec

    def pick_official_name(self) -> None:
        for rec in self.hospitals.values():
            names = sorted(set(rec["sourceNames"]), key=lambda s: (-len(s), s))
            hira = self.hira_row(rec)
            # 심평원 요양기관명이 있으면 그것을 공식 명칭으로 삼는다.
            rec["officialName"] = hira["name"] if hira else names[0]
            rec["commonName"] = display_name(rec["officialName"])
            rec["aliases"] = sorted({n for n in names if n != rec["officialName"]} | set(rec["aliases"]))

    def hira_row(self, rec: dict) -> dict | None:
        for name in rec["sourceNames"]:
            m = self.hira_match.get(name)
            if m and m.get("hiraId"):
                row = self.hira.get(m["hiraId"])
                if row:
                    return row
        return None

    def attach_hira(self) -> None:
        """심평원 자료로 주소·좌표·종별·진료과목·병상·인력을 채운다."""
        filled = 0
        for rec in self.hospitals.values():
            row = self.hira_row(rec)
            if row is None:
                continue
            filled += 1
            rec["hiraId"] = row["hiraId"]
            rec["hiraKind"] = row["kind"]
            rec["phone"] = row.get("phone")
            rec["homepage"] = row.get("homepage") or None
            rec["openedOn"] = row.get("openedOn")
            rec["address"] = {
                "value": row["address"],
                "postcode": row.get("postcode"),
                "sourceId": HIRA_SOURCE,
                "asOf": HIRA_AS_OF,
                "status": VERIFIED,
            }
            if row.get("lat") and row.get("lon"):
                rec["coord"] = {
                    "lat": round(row["lat"], 6),
                    "lon": round(row["lon"], 6),
                    "sourceId": HIRA_SOURCE,
                    "status": VERIFIED,
                    "precision": "exact",
                    "asOf": HIRA_AS_OF,
                }
            depts = row.get("departments") or []
            if depts:
                known = [d for d in depts if d.get("specialists") is not None]
                rec["departments"] = {
                    "status": VERIFIED,
                    "sourceId": HIRA_SOURCE,
                    "asOf": HIRA_AS_OF,
                    "items": [
                        {"name": d["name"], "code": d["code"], "specialists": d.get("specialists")}
                        for d in depts
                    ],
                    "note": "심평원에 신고된 진료과목이다. 과목이 있다고 해서 그 과목에 전문의가 있는 것은 아니다.",
                }
                rec["staffing"] = {
                    "status": VERIFIED if known else PARTIAL,
                    "sourceId": HIRA_SOURCE,
                    "asOf": HIRA_AS_OF,
                    "metric": "과목별 전문의 수",
                    "totalDoctors": row.get("doctors"),
                    "totalSpecialists": row.get("specialists"),
                    "residentsOnDuty": row.get("residents"),
                    "internsOnDuty": row.get("interns"),
                    "note": (
                        "심평원이 집계한 과목별 전문의 수다. 의사 수·교수 수·전체 직원 수와 다르고, "
                        "재직 중인 인턴·레지던트 수는 모집 정원과 다른 값이다."
                    ),
                }
            if row.get("bedTotal"):
                rec["bedDetail"] = {
                    "total": row["bedTotal"],
                    "breakdown": row.get("beds") or {},
                    "sourceId": HIRA_SOURCE,
                    "asOf": HIRA_AS_OF,
                    "status": VERIFIED,
                    "note": "일반입원실(상급·일반), 중환자실, 정신과, 격리병실, 무균치료실 병상의 합계다. 허가병상과는 다를 수 있다.",
                }
        print(f"  심평원 연결 {filled}/{len(self.hospitals)}곳")

    def merge_by_hira(self) -> dict[str, str]:
        """심평원 요양기관이 같으면 한 기관이다. 표기가 달라 따로 잡힌 레코드를 합친다.

        반환값은 '사라진 ID → 남은 ID' 표이며, 이미 만들어 둔 관계 레코드를 고치는 데 쓴다.
        """
        by_hira: dict[str, list[tuple[str, dict]]] = {}
        for key, rec in self.hospitals.items():
            hid = rec.get("hiraId")
            if hid:
                by_hira.setdefault(hid, []).append((key, rec))

        remap: dict[str, str] = {}
        for group in by_hira.values():
            if len(group) < 2:
                continue
            # 이름이 긴(법인격까지 적힌) 쪽을 남긴다.
            group.sort(key=lambda kv: (-len(kv[1]["officialName"]), kv[0]))
            keep_key, keep = group[0]
            for key, rec in group[1:]:
                remap[rec["id"]] = keep["id"]
                keep["sourceNames"] = sorted(set(keep["sourceNames"]) | set(rec["sourceNames"]))
                keep["aliases"] = sorted(set(keep["aliases"]) | set(rec["aliases"]))
                keep["universityRelations"] += [
                    r for r in rec["universityRelations"] if r not in keep["universityRelations"]
                ]
                for b in rec["beds"]:
                    if not any(x["value"] == b["value"] and x["kind"] == b["kind"] for x in keep["beds"]):
                        keep["beds"].append(b)
                if keep["designations"]["tertiary"] is None:
                    keep["designations"]["tertiary"] = rec["designations"]["tertiary"]
                seen_terms = {(e["termId"], e["emergencyRegionName"]) for e in keep["designations"]["emergency"]}
                for e in rec["designations"]["emergency"]:
                    if (e["termId"], e["emergencyRegionName"]) not in seen_terms:
                        keep["designations"]["emergency"].append(e)
                del self.hospitals[key]
                # 합쳐진 이름으로 찾아도 남은 레코드가 나오게 한다.
                self.hospitals[key] = keep
                self.by_core[key] = keep["id"]
        if remap:
            print(f"  같은 요양기관으로 확인되어 {len(remap)}건 병합")
        return remap

    @staticmethod
    def apply_remap(relations: list[dict], remap: dict[str, str]) -> list[dict]:
        seen, out = set(), []
        for rel in relations:
            rel = dict(rel)
            rel["toId"] = remap.get(rel["toId"], rel["toId"])
            rel["fromId"] = remap.get(rel["fromId"], rel["fromId"])
            key = (rel["fromId"], rel["toId"], rel["relationType"])
            if key in seen:
                continue
            seen.add(key)
            out.append(rel)
        return out

    def attach_location(self) -> None:
        """심평원에서 좌표를 못 받은 기관만 보조 출처로 채운다."""
        for rec in self.hospitals.values():
            if rec.get("coord") and rec["coord"].get("lat") is not None:
                self.set_region(rec)
                continue
            manual = None
            for src_name in rec["sourceNames"]:
                manual = self.coords.get(src_name) or self.geo_batch.get(src_name)
                if manual:
                    break
            lat = lon = None
            src, precision = None, "exact"
            if manual and manual.get("lat") is not None:
                lat, lon = manual["lat"], manual["lon"]
                src = manual.get("source") or "src-osm"
                precision = manual.get("precision", "exact")
            else:
                cands = []
                for src_name in rec["sourceNames"]:
                    cands += self.geo.get(src_name, {}).get("candidates", [])
                best = max(cands, key=lambda c: c["score"], default=None)
                if best and best["score"] >= 0.6:
                    lat, lon, src = best["lat"], best["lon"], "src-osm"
            if lat is None:
                rec["coord"] = {"status": UNVERIFIED}
                self.warnings.append(f"좌표 미확인: {rec['officialName']}")
                continue
            rec["coord"] = {
                "lat": lat, "lon": lon, "sourceId": src,
                "status": VERIFIED if precision == "exact" else PARTIAL,
                "precision": precision, "asOf": "2026-10-29",
            }
            if manual and manual.get("note"):
                rec["coord"]["note"] = manual["note"]
            self.set_region(rec)

    def set_region(self, rec: dict) -> None:
        c = rec.get("coord") or {}
        if c.get("lat") is None:
            return
        code, _ = self.sgg_index.code_at(c["lon"], c["lat"])
        if not code:
            self.warnings.append(f"좌표가 어느 시군구에도 들어가지 않음: {rec['officialName']}")
            return
        rec["sgg"] = code
        rec["sggName"] = self.sgg_name.get(code)
        sub = self.sgg_to_sub.get(code)
        rec["subRegionId"] = sub
        rec["macroRegionIds"] = self.sub_to_macro.get(sub, [])

    def attach_designations(self) -> None:
        d = self.designations
        # 가장 나중에 시작하는 기수가 '현재 지정'이다. 새 기수 시행일이 아직 안 왔어도
        # 교체가 확정된 옛 기수를 현재로 보여 주지 않기 위해 전체에서 한 번만 정한다.
        self.current_emc_term = max(
            d["regionalEmergencyCenters"], key=lambda t: t["validFrom"]
        )["termId"]
        t = d["sangjongType"]
        for care_region, names in t["byCareRegion"].items():
            for n in names:
                rec = self.hospital_for(n)
                rec["designations"]["tertiary"] = {
                    "value": "상급종합병원", "term": t["term"], "careRegion": care_region,
                    "validFrom": t["validFrom"], "validTo": t["validTo"],
                    "sourceId": t["sourceId"], "status": VERIFIED,
                }
        for term in d["regionalEmergencyCenters"]:
            for e in term["entries"]:
                rec = self.hospital_for(e["name"])
                rec["designations"]["emergency"].append(
                    {
                        "termId": term["termId"],
                        "emergencyRegionId": self.emergency_region_id(e["emergencyRegion"]),
                        "emergencyRegionName": e["emergencyRegion"],
                        "validFrom": term["validFrom"], "validTo": term["validTo"],
                        "newlyDesignated": e.get("new", False),
                        "pendingUntil": e.get("pendingUntil"),
                        "isCurrent": term["termId"] == self.current_emc_term,
                        "sourceId": term["sourceId"], "status": VERIFIED,
                    }
                )

    def emergency_region_id(self, name: str) -> str | None:
        for sr in self.regions["subRegions"]:
            if sr["name"] == name:
                return sr["id"]
        self.warnings.append(f"응급의료권역 이름을 세부권역에서 찾지 못함: {name}")
        return None

    def add_extra_hospitals(self) -> None:
        for e in self.extra_hospitals:
            rec = self.hospital_for(e["name"])
            if e.get("kind"):
                # 요양기관이 아닌 수련기관(보건대학원·연구원 등)임을 밝혀 둔다.
                rec["institutionKind"] = e["kind"]
            if e["name"] not in self.coords:
                self.coords[e["name"]] = e
            if e.get("address") and rec["address"].get("status") != VERIFIED:
                # 심평원 명부에 없는 기관은 기관 공식 안내의 주소를 쓴다.
                rec["address"] = {
                    "value": e["address"], "postcode": None,
                    "sourceId": e["addressSource"], "asOf": "2026-10-30", "status": VERIFIED,
                }
            if e.get("historySource"):
                srcs = e["historySource"] if isinstance(e["historySource"], list) else [e["historySource"]]
                rec["history"] = {
                    "value": e["history"], "status": PARTIAL, "sourceId": srcs[0],
                    "sourceIds": srcs, "asOf": "2026-10-30",
                }

    def quota_names(self) -> set[str]:
        if not self.quota_years:
            return set()
        names: set[str] = set()
        for y in self.quota_years["years"]:
            names |= {x["hospitalRaw"] for x in y["interns"]}
            names |= {x["hospitalRaw"] for x in y["residents"]}
        return names

    def add_quota_hospitals(self) -> None:
        """정원 공고(2023~2026)에 나오는 수련병원 전체를 레지스트리에 넣는다."""
        before = len(self.hospitals)
        for n in sorted(self.quota_names()):
            if n.strip().endswith(("의과대학", "의학전문대학원")):
                continue  # 의과대학 단위는 학교 쪽에서 다룬다
            self.hospital_for(n)
        years = [y["year"] for y in (self.quota_years or {"years": []})["years"]]
        print(f"  정원 공고({'·'.join(map(str, years))})로 {len(self.hospitals) - before}곳 신규 등록")

    # ---------------------------------------------------------- 의과대학

    def build_schools(self) -> tuple[list, list]:
        schools, relations = [], []
        taken: set[str] = set()
        for s in self.schools_raw:
            uni, kind = s["university"], s["schoolKind"]
            sid = slug("ms", core(uni) + ("의전원" if kind == "의학전문대학원" else ""), taken)
            code = self.resolve_sgg(s["sido"], s["sgg"])
            coord = self.school_coord(f"{uni} 의과대학", code)
            if coord.get("precision") in ("exact", "approximate"):
                # 지도 위치와 권역 필터가 어긋나지 않도록 소재 시군구는 좌표로 정한다.
                at, _ = self.sgg_index.code_at(coord["lon"], coord["lat"])
                if at and at != code:
                    listed = self.sgg_name.get(code) if code else "없음"
                    msg = f"메디컬 목록 엑셀의 소재지는 {listed}이지만 지도 위치는 {self.sgg_name.get(at)}다. 권역은 지도 위치로 정했다."
                    if self.sgg_name.get(at, " ").split(" ")[0] != (listed or " ").split(" ")[0]:
                        msg = f"시도가 다르다. {msg}"
                    coord["note"] = f"{coord['note']} {msg}" if coord.get("note") else msg
                    code = at
            sub = self.sgg_to_sub.get(code) if code else None
            rec = {
                "id": sid, "type": "medicalSchool",
                "officialName": f"{uni} {kind}",
                "universityName": uni, "schoolKind": kind,
                "aliases": [uni, kind, f"{uni}{kind}"],
                "sgg": code, "sggName": self.sgg_name.get(code) if code else None,
                "subRegionId": sub,
                "macroRegionIds": self.sub_to_macro.get(sub, []) if sub else [],
                "coord": coord,
                "universityUrl": s["universityUrl"], "schoolUrl": s["deptUrl"],
                "founded": {
                    "value": s["founded"], "sourceId": "src-xlsx-medical-list",
                    "status": VERIFIED if s["founded"] else UNVERIFIED,
                },
                "quota": [
                    {
                        "admissionYear": 2026, "kind": "의과대학 입학정원", "value": s["quota2026"],
                        "sourceId": "src-moe-quota-2027", "asOf": "2026-03",
                        "status": VERIFIED if s["quota2026"] is not None else UNVERIFIED,
                        "note": "2024학년도 기준 정원(2026학년도 모집 기준). 의예과 모집인원·대학 전체 입학정원과 다른 값이다.",
                    },
                    {
                        "admissionYear": 2027, "kind": "의과대학 입학정원 (배정안)", "value": s["quota2027"],
                        "sourceId": "src-moe-quota-2027", "asOf": "2026-03",
                        "status": VERIFIED if s["quota2027"] is not None else UNVERIFIED,
                    },
                ],
                "logo": None, "sourceId": "src-xlsx-medical-list", "asOf": "2026-09-22",
            }
            schools.append(rec)
            # 캠퍼스 표기가 빠진 이름으로도 찾을 수 있게 해 둔다.
            # (예: 공고의 '동국대학교의과대학' → '동국대학교(WISE) 의과대학')
            bare = re.sub(r"\([^)]*\)", "", uni).strip()
            campus = re.sub(r"[()]", "", uni).replace("WISE", "").replace("미래", "원주").strip()
            for key in {
                core(rec["officialName"]), core(uni + " 의과대학"), core(uni + "의과대학"),
                core(bare + "의과대학"), core(campus + "의과대학"),
            }:
                if key:
                    self.school_ids.setdefault(key, sid)
            for h in s["relatedHospitals"]:
                if "동물병원" in h["rawName"]:
                    continue
                hosp = self.hospital_for(h["rawName"])
                if h["beds"] is not None and not any(b["value"] == h["beds"] for b in hosp["beds"]):
                    hosp["beds"].append(
                        {
                            "kind": "병상 수", "value": h["beds"], "sourceId": "src-hira-beds",
                            "asOf": "2026-09-22", "status": PARTIAL,
                            "note": "메디컬 목록 엑셀을 통해 간접 수집한 값이다. 심평원 원자료 합계와 다를 수 있다.",
                        }
                    )
                rel = h["relation"] or UNVERIFIED
                relations.append(
                    {
                        "fromId": sid, "fromType": "medicalSchool",
                        "toId": hosp["id"], "toType": "hospital",
                        "relationType": {"부속": "부속병원", "협력": "교육협력병원", "위탁운영": "위탁운영병원"}.get(rel, rel),
                        "sourceId": "src-xlsx-medical-list", "asOf": "2026-09-22",
                        "status": VERIFIED if h["relation"] else UNVERIFIED,
                    }
                )
                if rel in ("부속", "협력", "위탁운영"):
                    hosp["universityRelations"].append(
                        {"schoolId": sid, "universityName": uni, "relationType": rel}
                    )
        relations = self.finish_relations(relations, schools)
        return schools, relations

    def finish_relations(self, relations: list[dict], schools: list[dict]) -> list[dict]:
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
                    "relationType": fix["relationType"], "sourceId": "src-xlsx-medical-list",
                    "asOf": "2026-09-22", "status": fix["status"], "note": fix["note"],
                }
            )
            hosp["universityRelations"].append(
                {"schoolId": school["id"], "universityName": school["universityName"], "relationType": "부속"}
            )
        return out

    def school_coord(self, query: str, sgg_code: str | None) -> dict:
        hit = self.school_coords.get(query)
        if hit:
            precision = hit.get("precision", "exact")
            out = {
                "lat": hit["lat"], "lon": hit["lon"], "sourceId": hit["source"],
                "precision": precision, "status": VERIFIED if precision == "exact" else PARTIAL,
                "asOf": "2026-10-30" if hit.get("osm") or precision != "exact" else "2026-10-29",
            }
            if hit.get("note"):
                out["note"] = hit["note"]
            return out
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
                m = by_key.get((r["region"], r["hospitalRaw"]))
                if not m:
                    self.warnings.append(f"수련 모집 단위 미매핑: {(r['region'], r['hospitalRaw'])}")
                    continue
                uid = m["id"]
                if uid not in units:
                    rows = [(n, self.hospital_for(n, create=False)) for n in m["hospitals"]]
                    units[uid] = {
                        "id": uid, "name": m["name"], "rawNames": [], "recruitRegion": r["region"],
                        "hospitalIds": [h["id"] for _, h in rows if h],
                        "medicalSchoolIds": [
                            s for s in (self.school_ids.get(core(n)) for n in m.get("medicalSchools", [])) if s
                        ],
                        "unmatchedHospitals": [n for n, h in rows if not h],
                        "integratedTraining": m.get("integratedTraining", False),
                        "note": m.get("note"),
                    }
                    for n in units[uid]["unmatchedHospitals"]:
                        self.warnings.append(f"모집 단위가 가리키는 병원이 레지스트리에 없음: {n}")
                if r["hospitalRaw"] not in units[uid]["rawNames"]:
                    units[uid]["rawNames"].append(r["hospitalRaw"])
                records.append(
                    {
                        "trainingUnitId": uid,
                        "hospitalIds": units[uid]["hospitalIds"],
                        "medicalSchoolIds": units[uid]["medicalSchoolIds"],
                        "year": payload["year"], "term": payload["half"], "track": kind,
                        "specialty": None if kind == "인턴" else r["specialty"],
                        "quotaKind": "모집인원", "quota": r["quota"],
                        "flexible": r["flexible"], "integratedTraining": r["integratedTraining"],
                        "mojaAgreement": r["mojaAgreement"],
                        "appliedCount": {"status": UNVERIFIED}, "matchedCount": {"status": UNVERIFIED},
                        "sourceId": src, "asOf": "2026-08-30", "status": VERIFIED,
                    }
                )
        records += self.build_quota_records()
        return list(units.values()), records

    def build_quota_records(self) -> list[dict]:
        """연도별 정원(공식 공고). 기관별·전공과별 전량."""
        if not self.quota_years:
            self.warnings.append("정원 자료가 없습니다. scripts/extract_quota.py 를 먼저 실행하세요.")
            return []
        out: list[dict] = []

        def ids_for(raw: str) -> tuple[list[str], list[str]]:
            if raw.strip().endswith(("의과대학", "의학전문대학원")):
                sid = self.school_ids.get(core(raw))
                if not sid:
                    self.warnings.append(f"정원 자료의 의과대학을 찾지 못함: {raw}")
                    return [], []
                return [], [sid]
            rec = self.hospital_for(raw, create=False)
            if rec is None:
                self.warnings.append(f"정원 자료의 병원을 찾지 못함: {raw}")
                return [], []
            return [rec["id"]], []

        for y in self.quota_years["years"]:
            year = y["year"]
            src = f"src-kha-quota-{year}"
            for track, rows in (("인턴", y["interns"]), ("레지던트", y["residents"])):
                for x in rows:
                    hids, sids = ids_for(x["hospitalRaw"])
                    if not hids and not sids:
                        continue
                    out.append(self.quota_record(hids, sids, year, track, x, src))
        return out

    @staticmethod
    def quota_record(hids: list[str], sids: list[str], year: int, track: str, x: dict, src: str) -> dict:
        breakdown = {
            "기본정원": x.get("baseQuota"),
            "미충원 별도정원": x.get("unfilledQuota"),
            "정책적 별도정원": x.get("policyQuota"),
            "별도정원": x.get("extraQuota"),
            "감원": x.get("reductionQuota"),
            "사후정원": x.get("deferredQuota"),
        }
        return {
            "trainingUnitId": None,
            "hospitalIds": hids,
            "medicalSchoolIds": sids,
            "year": year, "term": "상반기", "track": track,
            "specialty": x.get("specialty"),
            "quotaKind": "정원", "quota": x["total"],
            "quotaBreakdown": breakdown,
            "flexible": bool(x.get("flexible")),
            "integratedTraining": False, "mojaAgreement": False,
            "appliedCount": {"status": UNVERIFIED}, "matchedCount": {"status": UNVERIFIED},
            "sourceId": src, "asOf": str(year), "status": VERIFIED,
            "note": x.get("note"),
        }

    def national_totals(self) -> list[dict]:
        """연도별 정원 합계를 공고 원문에서 직접 집계한다."""
        if not self.quota_years:
            return []
        out = []
        for y in self.quota_years["years"]:
            for track, rows, label in (
                ("인턴", y["interns"], "인턴"),
                ("레지던트", y["residents"], "레지던트 1년차"),
            ):
                if not rows:
                    continue
                out.append(
                    {
                        "year": y["year"], "term": "상반기", "track": label, "metric": "정원",
                        "value": sum(r["total"] for r in rows),
                        "institutionCount": len({r["hospitalRaw"] for r in rows}),
                        "sourceId": f"src-kha-quota-{y['year']}",
                        "status": VERIFIED,
                    }
                )
        return out

    def group_recruitment(self, records: list[dict], units: list[dict]) -> dict:
        """모집 기록을 기관별로 묶는다.

        상세 패널은 언제나 '한 기관의 기록'만 쓰므로 기관 ID 로 바로 찾을 수 있게 둔다.
        레코드마다 기관 ID 배열을 되풀이하지 않아 파일도 작아진다. 통합수련 단위의 기록은
        소속 병원마다 한 벌씩 들어가되 어느 단위의 수치인지 unitName 으로 밝힌다.
        비어 있는 칸(거짓인 플래그, 값 없는 정원 내역)은 싣지 않는다.
        """
        unit_name = {u["id"]: u["name"] for u in units}
        by_inst: dict[str, list[dict]] = {}
        for r in records:
            slim: dict = {
                "year": r["year"], "term": r["term"], "track": r["track"],
                "quotaKind": r["quotaKind"], "quota": r["quota"],
                "sourceId": r["sourceId"], "asOf": r["asOf"], "status": r["status"],
            }
            if r.get("specialty"):
                slim["specialty"] = r["specialty"]
            for flag in ("flexible", "integratedTraining", "mojaAgreement"):
                if r.get(flag):
                    slim[flag] = True
            if r.get("note"):
                slim["note"] = r["note"]
            breakdown = {k: v for k, v in (r.get("quotaBreakdown") or {}).items() if v}
            if breakdown:
                slim["quotaBreakdown"] = breakdown
            uid = r.get("trainingUnitId")
            if uid:
                slim["unitId"] = uid
                slim["unitName"] = unit_name.get(uid, uid)
            targets = list(r.get("hospitalIds") or []) + list(r.get("medicalSchoolIds") or [])
            if uid and len(r.get("hospitalIds") or []) > 1:
                slim["unitHospitalIds"] = r["hospitalIds"]
            for iid in targets:
                by_inst.setdefault(iid, []).append(slim if len(targets) == 1 else dict(slim))
        return {
            "meta": {
                "note": (
                    "기관 ID 로 묶은 전공의 모집 기록. '정원'과 '모집인원'은 서로 다른 지표이므로 "
                    "quotaKind 로 구별한다."
                ),
                "unverified": "지원자 수·합격자 수·실제 임용 인원은 모든 기록에서 미확인이다.",
                "records": len(records),
            },
            "byInstitution": by_inst,
        }

    @staticmethod
    def recruitment_index(records: list[dict]) -> dict:
        """첫 화면에서 쓰는 가벼운 색인.

        '이 기관에 어느 해 어떤 과정의 모집 자료가 있는가'만 담는다. 전체 모집 기록은
        상세 패널을 열 때 따로 받아 가므로, 지도와 통계는 이 작은 파일만으로 그린다.
        """
        by_inst: dict[str, dict[str, list]] = {}
        for r in records:
            for iid in list(r.get("hospitalIds") or []) + list(r.get("medicalSchoolIds") or []):
                e = by_inst.setdefault(iid, {"tracks": [], "years": []})
                if r["track"] not in e["tracks"]:
                    e["tracks"].append(r["track"])
                if r["year"] not in e["years"]:
                    e["years"].append(r["year"])
        for e in by_inst.values():
            e["years"].sort(reverse=True)
            e["tracks"].sort()
        return by_inst

    # ---------------------------------------------------------- 실행

    def run(self) -> int:
        self.attach_designations()
        self.add_extra_hospitals()
        self.add_quota_hospitals()
        schools, relations = self.build_schools()
        self.pick_official_name()
        self.attach_hira()
        relations = self.apply_remap(relations, self.merge_by_hira())
        self.pick_official_name()
        self.attach_location()
        units, recruitment = self.build_recruitment()

        unique: dict[str, dict] = {}
        for rec in self.hospitals.values():
            unique.setdefault(rec["id"], rec)
        hospitals = sorted(unique.values(), key=lambda h: h["officialName"])

        # 같은 이름의 다른 기관이 있으면(서울·대구 누네안과병원 등) 표시명에 소재지를 덧붙인다.
        by_name: dict[str, list[dict]] = {}
        for rec in hospitals:
            by_name.setdefault(rec["commonName"], []).append(rec)
        for name, group in by_name.items():
            if len(group) < 2:
                continue
            for rec in group:
                where = (rec.get("sggName") or "").split(" ")[-1]
                if where:
                    rec["commonName"] = f"{name} ({where})"
                    rec["nameDisambiguated"] = True
        for h in hospitals:
            h["variantNames"] = sorted(set(h.pop("sourceNames", [])))
            h["logo"] = self.logos.get(h["id"])
            if h.get("bedDetail"):
                # 심평원 합계를 1차 값으로 올리고, 엑셀 경유 값은 뒤에 남겨 둔다.
                primary = {
                    "kind": "병상 수 (심평원 시설 신고 합계)", "value": h["bedDetail"]["total"],
                    "sourceId": HIRA_SOURCE, "asOf": HIRA_AS_OF, "status": VERIFIED,
                    "note": h["bedDetail"]["note"],
                }
                h["beds"] = [primary] + [b for b in h["beds"] if b["value"] != primary["value"]]
        for s in schools:
            s["logo"] = self.logos.get(s["id"])

        with_dept = sum(1 for h in hospitals if h["departments"]["status"] == VERIFIED)
        with_addr = sum(1 for h in hospitals if h["address"].get("status") == VERIFIED)

        write(hospitals, "hospitals.json")
        write(schools, "medical-schools.json")
        write(relations, "institution-relations.json")
        write(units, "training-units.json")
        write(self.group_recruitment(recruitment, units), "residency-recruitment.json")
        write(self.recruitment_index(recruitment), "recruitment-index.json")
        write(self.regions, "regions.json")
        write(read(DATA, "sources.json"), "sources.json")
        write(
            {
                "nationalTotals": self.national_totals() + self.recruit2023_extra["nationalTotals"],
                "coverageWarning": self.recruit2023_extra["coverageWarning"],
                "note": self.recruit2023_extra["_note"],
                "changeNote": self.recruit2023_extra.get("changeNote"),
                "counts": {
                    "recruitmentRecords": len(recruitment),
                    "hospitals": len(hospitals),
                    "schools": len(schools),
                    "trainingUnits": len(units),
                    "relations": len(relations),
                    "hospitalsWithDepartments": with_dept,
                    "hospitalsWithAddress": with_addr,
                },
            },
            "recruitment-coverage.json",
        )

        linked = sum(1 for x in hospitals + schools if x["logo"])
        print(
            f"  로고 {linked}/{len(hospitals) + len(schools)}"
            f" · 진료과목 {with_dept}/{len(hospitals)}"
            f" · 주소 {with_addr}/{len(hospitals)}"
        )
        if self.warnings:
            print(f"\n  경고 {len(self.warnings)}건")
            for w in sorted(set(self.warnings))[:30]:
                print(f"    - {w}")
        return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(Build().run())

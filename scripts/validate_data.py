# -*- coding: utf-8 -*-
"""public/data/*.json 참조 무결성·필수 필드 검사.

검출 항목
  중복 기관 ID / 존재하지 않는 관련 기관 ID / 유효하지 않은 좌표 / 잘못된 권역 ID /
  출처 없는 핵심 데이터 / 잘못된 로고 경로 / 필수 필드 누락 / 같은 기관의 중복 레코드 /
  모집 인원·모집 연도 누락 / 센터·전문과 관계 불일치 / 수련 모집 단위 연결 끊김

종료 코드: 오류가 하나라도 있으면 1.
"""
from __future__ import annotations

import io
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
PUBLIC = os.path.join(ROOT, "public")

# 대한민국 본토·부속도서를 넉넉히 감싸는 범위
LAT_RANGE = (32.5, 39.0)
LON_RANGE = (124.0, 132.5)


class Report:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []

    def error(self, check: str, msg: str) -> None:
        self.errors.append((check, msg))

    def warn(self, check: str, msg: str) -> None:
        self.warnings.append((check, msg))

    def render(self) -> str:
        lines = ["", "=" * 72, " 데이터 검증 결과", "=" * 72]
        for title, items, mark in (("오류", self.errors, "✗"), ("경고", self.warnings, "!")):
            lines.append("")
            if not items:
                lines.append(f"  {title} 없음")
                continue
            by_check: dict[str, list[str]] = defaultdict(list)
            for check, msg in items:
                by_check[check].append(msg)
            lines.append(f"  {title} {len(items)}건")
            for check, msgs in by_check.items():
                lines.append(f"    [{check}] {len(msgs)}건")
                for m in msgs[:12]:
                    lines.append(f"      {mark} {m}")
                if len(msgs) > 12:
                    lines.append(f"      … 외 {len(msgs) - 12}건")
        lines.append("")
        lines.append("=" * 72)
        verdict = "통과" if not self.errors else "실패"
        lines.append(f" 판정: {verdict} (오류 {len(self.errors)} · 경고 {len(self.warnings)})")
        lines.append("=" * 72)
        return "\n".join(lines)


def load(name: str):
    return json.load(io.open(os.path.join(DATA, name), encoding="utf-8"))


def main() -> int:
    r = Report()
    try:
        hospitals = load("hospitals.json")
        schools = load("medical-schools.json")
        relations = load("institution-relations.json")
        units = load("training-units.json")
        recruitment_doc = load("residency-recruitment.json")
        recruitment = [
            {**r, "_inst": iid}
            for iid, rows in recruitment_doc["byInstitution"].items()
            for r in rows
        ]
        regions = load("regions.json")
        sources = load("sources.json")["sources"]
    except FileNotFoundError as exc:
        print(f"데이터 파일이 없습니다: {exc.filename}")
        print("먼저 `npm run build:geo` 와 `npm run build:data` 를 실행하세요.")
        return 1

    source_ids = {s["id"] for s in sources}
    sub_ids = {s["id"] for s in regions["subRegions"]}
    macro_ids = {m["id"] for m in regions["macroRegions"]}
    sgg_codes = {
        f["properties"]["sggcd"]
        for f in json.load(io.open(os.path.join(PUBLIC, "geo", "sgg.json"), encoding="utf-8"))["features"]
    }

    # ── 권역 ─────────────────────────────────────────────────────────
    mapped = [c for s in regions["subRegions"] for c in s["sgg"]]
    for code, n in Counter(mapped).items():
        if n > 1:
            r.error("권역", f"시군구 {code} 가 {n}개 세부권역에 중복 포함")
    for code in sgg_codes - set(mapped):
        r.error("권역", f"어느 세부권역에도 속하지 않는 시군구: {code}")
    for code in set(mapped) - sgg_codes:
        r.error("권역", f"존재하지 않는 시군구 코드: {code}")
    for m in regions["macroRegions"]:
        for sid in m["subRegions"]:
            if sid not in sub_ids:
                r.error("권역", f"대권역 {m['id']} 가 없는 세부권역 {sid} 를 가리킴")
            elif m["id"] not in next(s for s in regions["subRegions"] if s["id"] == sid)["macroRegions"]:
                r.error("권역", f"대권역 {m['id']} ↔ 세부권역 {sid} 역참조 불일치")

    # ── 기관 ─────────────────────────────────────────────────────────
    all_ids: list[str] = []
    name_seen: dict[tuple, str] = {}
    for inst in hospitals + schools:
        iid = inst.get("id")
        all_ids.append(iid)
        kind = inst.get("type")
        for field in ("id", "type", "officialName"):
            if not inst.get(field):
                r.error("필수 필드", f"{iid}: {field} 누락")
        # 같은 이름의 다른 기관이 실제로 있다(예: 서울·대구 누네안과병원).
        # 소재 시군구까지 같을 때만 중복으로 본다.
        name = inst["officialName"]
        name_key = (name, inst.get("sgg"))
        if name_key in name_seen and name_seen[name_key] != iid:
            r.error(
                "중복 레코드",
                f"같은 공식 명칭·같은 시군구의 기관이 둘: {inst['officialName']} "
                f"({name_seen[name_key]}, {iid})",
            )
        name_seen[name_key] = iid

        sub = inst.get("subRegionId")
        if sub is not None and sub not in sub_ids:
            r.error("권역 ID", f"{name}: 알 수 없는 세부권역 {sub}")
        for mid in inst.get("macroRegionIds", []):
            if mid not in macro_ids:
                r.error("권역 ID", f"{name}: 알 수 없는 대권역 {mid}")
        if inst.get("sgg") and inst["sgg"] not in sgg_codes:
            r.error("권역 ID", f"{name}: 알 수 없는 시군구 {inst['sgg']}")

        coord = inst.get("coord") or {}
        if coord.get("status") == "미확인":
            r.warn("좌표", f"{name}: 좌표 미확인")
        else:
            lat, lon = coord.get("lat"), coord.get("lon")
            if lat is None or lon is None:
                r.error("좌표", f"{name}: 좌표 상태가 '{coord.get('status')}' 인데 값이 없음")
            elif not (LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]):
                r.error("좌표", f"{name}: 대한민국 범위를 벗어난 좌표 {lat},{lon}")
            elif not coord.get("sourceId"):
                r.error("출처", f"{name}: 좌표에 출처가 없음")
            elif coord["sourceId"] not in source_ids:
                r.error("출처", f"{name}: 알 수 없는 출처 {coord['sourceId']}")

        logo = inst.get("logo")
        if logo:
            path = os.path.join(PUBLIC, logo.lstrip("/"))
            if not os.path.exists(path):
                r.error("로고", f"{name}: 로고 파일 없음 {logo}")

        if kind == "hospital":
            for b in inst.get("beds", []):
                if b.get("sourceId") not in source_ids:
                    r.error("출처", f"{name}: 병상 수 출처 불명 {b.get('sourceId')}")
                if not b.get("asOf"):
                    r.error("기준일", f"{name}: 병상 수에 기준일 없음")
            for field in ("address", "history", "departments"):
                v = inst.get(field) or {}
                if v.get("value") is None and not v.get("items"):
                    continue
                for sid in v.get("sourceIds") or [v.get("sourceId")]:
                    if sid not in source_ids:
                        r.error("출처", f"{name}: {field} 출처 불명 {sid}")
            t = inst["designations"].get("tertiary")
            if t and t.get("sourceId") not in source_ids:
                r.error("출처", f"{name}: 상급종합 지정 출처 불명")
            for e in inst["designations"].get("emergency", []):
                if e.get("sourceId") not in source_ids:
                    r.error("출처", f"{name}: 권역응급 지정 출처 불명")
                if e.get("emergencyRegionId") and e["emergencyRegionId"] not in sub_ids:
                    r.error("권역 ID", f"{name}: 알 수 없는 응급의료권역 {e['emergencyRegionId']}")
            for key in ("centers", "departments"):
                block = inst.get(key) or {}
                if block.get("status") == "확인됨" and not block.get("items"):
                    r.error("조직 일관성", f"{name}: {key} 가 '확인됨' 인데 항목이 비어 있음")
                if block.get("items") and block.get("status") == "미확인":
                    r.error("조직 일관성", f"{name}: {key} 항목이 있는데 상태가 '미확인'")
        else:
            if inst.get("sourceId") not in source_ids:
                r.error("출처", f"{name}: 기관 출처 불명")
            for q in inst.get("quota", []):
                if not q.get("admissionYear"):
                    r.error("기준일", f"{name}: 정원에 모집 연도 없음")
                if q.get("value") is not None and q.get("sourceId") not in source_ids:
                    r.error("출처", f"{name}: 정원 출처 불명")
                if q.get("value") is None and q.get("status") != "미확인":
                    r.error("미확인 처리", f"{name}: 정원 값이 없는데 상태가 '{q.get('status')}'")

    for iid, n in Counter(all_ids).items():
        if n > 1:
            r.error("중복 ID", f"기관 ID 중복: {iid} ({n}회)")
    known = set(all_ids)

    # ── 관계 ─────────────────────────────────────────────────────────
    seen_rel = set()
    for rel in relations:
        for side in ("fromId", "toId"):
            if rel[side] not in known:
                r.error("참조 무결성", f"관계가 없는 기관을 가리킴: {rel[side]}")
        key = (rel["fromId"], rel["toId"], rel["relationType"])
        if key in seen_rel:
            r.warn("중복 레코드", f"같은 관계가 두 번: {key}")
        seen_rel.add(key)
        if rel.get("sourceId") not in source_ids:
            r.error("출처", f"관계에 출처 없음: {rel['fromId']}→{rel['toId']}")

    # ── 수련 모집 ────────────────────────────────────────────────────
    unit_ids = set()
    for u in units:
        if u["id"] in unit_ids:
            r.error("중복 ID", f"모집 단위 ID 중복: {u['id']}")
        unit_ids.add(u["id"])
        for hid in u["hospitalIds"]:
            if hid not in known:
                r.error("참조 무결성", f"모집 단위 {u['name']} 가 없는 병원 {hid} 를 가리킴")
        for sid in u.get("medicalSchoolIds", []):
            if sid not in known:
                r.error("참조 무결성", f"모집 단위 {u['name']} 가 없는 의과대학 {sid} 를 가리킴")
        if not u["hospitalIds"] and not u.get("medicalSchoolIds"):
            r.warn("모집 단위", f"어느 기관과도 이어지지 않은 모집 단위: {u['name']}")
        for raw in u.get("unmatchedHospitals", []):
            r.warn("모집 단위", f"{u['name']}: 레지스트리에 없는 병원 표기 '{raw}'")

    seen_rec: dict[tuple, int] = {}
    for rec in recruitment:
        uid = rec.get("unitId")
        inst = rec["_inst"]
        if uid is not None and uid not in unit_ids:
            r.error("참조 무결성", f"모집 기록이 없는 단위를 가리킴: {uid}")
        if inst not in known:
            r.error("참조 무결성", f"모집 기록이 없는 기관에 붙어 있음: {inst}")
        if uid is None:
            # 한 기관의 같은 해·과정·과목에 기록이 둘이면, 서로 다른 기관이 잘못 합쳐진 것이다.
            key = (inst, rec.get("year"), rec.get("term"), rec.get("track"), rec.get("specialty"))
            seen_rec[key] = seen_rec.get(key, 0) + 1
        if rec.get("year") is None:
            r.error("기준일", f"모집 기록에 연도 없음: {uid or inst}")
        if rec.get("quota") is None:
            r.error("미확인 처리", f"모집 인원이 비어 있음 (0과 미확인을 구별해야 함): {uid or inst}")
        if rec.get("track") == "레지던트" and not rec.get("specialty"):
            r.error("필수 필드", f"레지던트 기록에 전공과목 없음: {uid or inst}")
        if rec.get("sourceId") not in source_ids:
            r.error("출처", f"모집 기록 출처 불명: {uid or inst}")

    name_of = {i["id"]: i.get("officialName", i["id"]) for i in hospitals + schools}
    for key, n in seen_rec.items():
        if n > 1:
            inst, year, term, track, specialty = key
            r.error(
                "중복 레코드",
                f"{name_of.get(inst, inst)}: {year} {term} {track} {specialty or ''} 기록이 {n}건. "
                "서로 다른 기관이 하나로 합쳐졌을 수 있다",
            )

    print(r.render())
    print(f"\n  기관 {len(hospitals) + len(schools)} (병원 {len(hospitals)} · 의과대학 {len(schools)})")
    print(f"  관계 {len(relations)} · 모집 단위 {len(units)} · 모집 기록 {len(recruitment)}")
    print(f"  세부권역 {len(regions['subRegions'])} · 대권역 {len(regions['macroRegions'])} · 출처 {len(sources)}")
    return 1 if r.errors else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

# -*- coding: utf-8 -*-
"""기관명 → 심평원 요양기관 매칭.

1) 정규화 이름이 정확히 같은 기관을 먼저 찾고,
2) 여럿이면 종별(상급종합 > 종합병원 > 병원)과 병상 수로 고른다.
3) 정확히 같은 이름이 없으면 토큰 F1 로 가장 가까운 기관을 찾되,
   이름에 적힌 지역과 소재지가 어긋나면 점수를 깎는다.

임계값 아래는 자동으로 붙이지 않고 미확인으로 남긴다.
수동 지정은 data/curation/hira-overrides.json 이 우선한다.
"""
from __future__ import annotations

import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_match import score  # noqa: E402
from normalize import core, match_key, normalize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIRA_JSON = os.path.join(ROOT, ".cache", "hira", "hospitals.json")
OVERRIDES = os.path.join(ROOT, "data", "curation", "hira-overrides.json")

ACCEPT = 0.80
KIND_RANK = {"상급종합": 0, "종합병원": 1, "병원": 2, "요양병원": 3, "정신병원": 4, "치과병원": 5, "한방병원": 6}

SIDO_ALIASES = {
    "서울": ["서울"], "부산": ["부산"], "대구": ["대구"], "인천": ["인천"],
    "광주": ["광주"], "대전": ["대전"], "울산": ["울산"], "세종": ["세종"],
    "경기": ["경기"], "강원": ["강원"], "충북": ["충북", "충청북"], "충남": ["충남", "충청남"],
    "전북": ["전북", "전라북"], "전남": ["전남", "전라남"], "경북": ["경북", "경상북"],
    "경남": ["경남", "경상남"], "제주": ["제주"],
}


class HiraIndex:
    def __init__(self, path: str = HIRA_JSON):
        self.rows: list[dict] = json.load(io.open(path, encoding="utf-8"))
        self.by_core: dict[str, list[dict]] = {}
        self.by_norm: dict[str, list[dict]] = {}
        self.by_key: dict[str, list[dict]] = {}
        for r in self.rows:
            self.by_core.setdefault(core(r["name"]), []).append(r)
            self.by_norm.setdefault(normalize(r["name"]), []).append(r)
            self.by_key.setdefault(match_key(r["name"]), []).append(r)
        self.overrides: dict[str, str | None] = {}
        self.override_reasons: dict[str, str] = {}
        if os.path.exists(OVERRIDES):
            doc = json.load(io.open(OVERRIDES, encoding="utf-8"))
            self.overrides = doc.get("byName", {})
            self.override_reasons = doc.get("reasons", {})
        self.by_id = {r["hiraId"]: r for r in self.rows}
        self.by_exact_name: dict[str, list[dict]] = {}
        for r in self.rows:
            self.by_exact_name.setdefault(r["name"], []).append(r)

    @staticmethod
    def _rank(row: dict) -> tuple[int, int]:
        """같은 이름이 여럿이면 종별이 높고 병상이 많은 쪽을 고른다."""
        return (KIND_RANK.get(row["kind"], 9), -(row.get("bedTotal") or 0))

    def _region_ok(self, name: str, row: dict) -> bool | None:
        """이름에 적힌 지역과 소재 시도가 맞는지. 지역 표기가 없으면 None."""
        for sido, aliases in SIDO_ALIASES.items():
            if any(a in name for a in aliases):
                return any(a in (row.get("sido") or "") for a in aliases)
        return None

    def lookup(self, name: str) -> tuple[dict | None, str, float]:
        if name in self.overrides:
            forced = self.overrides[name]
            if forced is None:
                return None, "manual-none", 0.0
            # "요양기관명|시도" 로 적으면 같은 이름이 여럿일 때 시도로 가린다.
            wanted_name, _, wanted_sido = forced.partition("|")
            hits = self.by_exact_name.get(wanted_name, [])
            if wanted_sido:
                hits = [r for r in hits if wanted_sido in (r.get("sido") or "")]
            if not hits:
                byid = self.by_id.get(forced)
                if byid:
                    return byid, "manual", 1.0
                print(f"  !! 수동 지정한 심평원 기관명을 찾지 못했습니다: {name} → {forced}")
                return None, "manual-missing", 0.0
            if len(hits) > 1:
                print(f"  !! 수동 지정이 여러 기관에 걸립니다(시도를 덧붙이세요): {name} → {forced}")
            return sorted(hits, key=self._rank)[0], "manual", 1.0

        for table, how, keyfn in (
            (self.by_norm, "exact", normalize),
            (self.by_key, "org", match_key),
            (self.by_core, "core", core),
        ):
            hits = table.get(keyfn(name))
            if hits:
                if len(hits) == 1:
                    return hits[0], how, 1.0
                regional = [h for h in hits if self._region_ok(name, h) is True]
                pool = regional or hits
                return sorted(pool, key=self._rank)[0], f"{how}-multi", 1.0

        # 법인 표기를 뗀 이름이 상대 이름 안에 통째로 들어 있으면 같은 기관으로 본다.
        key = match_key(name)
        if len(key) >= 4:
            contained = [r for k, rows in self.by_key.items() if key in k for r in rows]
            regional = [r for r in contained if self._region_ok(name, r) is True]
            pool = regional or contained
            pool = [r for r in pool if r["kind"] in ("상급종합", "종합병원", "병원")] or pool
            if pool:
                return sorted(pool, key=self._rank)[0], "contains", 0.95

        best, best_score = None, 0.0
        for row in self.rows:
            s = score(name, row["name"])
            if s <= best_score:
                continue
            if self._region_ok(name, row) is False:
                s *= 0.7
            best, best_score = row, s
        if best and best_score >= ACCEPT:
            return best, "fuzzy", round(best_score, 3)
        return None, "none", round(best_score, 3)


def collect_names() -> list[str]:
    """build_data.py 가 병원 레지스트리를 만들 때 쓰는 기관명 전부.

    빌드 결과물(public/data)이 아니라 원천 파일에서 모으므로, 처음 받은 저장소에서도
    추출 → 매칭 → 조립 순서로 돌릴 수 있다. 의과대학 단위(예방의학과)는 병원이 아니라 뺀다.
    """
    def opt(*parts: str):
        path = os.path.join(ROOT, *parts)
        return json.load(io.open(path, encoding="utf-8")) if os.path.exists(path) else None

    names: set[str] = set()
    quota = opt(".cache", "extracted", "quota_by_year.json")
    for y in (quota or {}).get("years", []):
        names |= {x["hospitalRaw"] for x in y["interns"] + y["residents"]}
    for s in (opt(".cache", "extracted", "xlsx_schools.json") or {}).get("schools", []):
        names |= {h["rawName"] for h in s["relatedHospitals"] if "동물병원" not in h["rawName"]}
    designations = opt("data", "designations.json") or {}
    for group in designations.get("sangjongType", {}).get("byCareRegion", {}).values():
        names |= set(group)
    for term in designations.get("regionalEmergencyCenters", []):
        names |= {e["name"] for e in term["entries"]}
    names |= {e["name"] for e in (opt("data", "curation", "extra-hospitals.json") or {}).get("hospitals", [])}
    for u in (opt("data", "curation", "training-units.json") or {}).get("units", []):
        names |= set(u.get("hospitals", []))
    aliases = (opt("data", "curation", "hospital-aliases.json") or {}).get("canonical", {})
    names |= set(aliases) | set(aliases.values())
    names |= set((opt("data", "curation", "hira-overrides.json") or {}).get("byName", {}))
    return sorted(n for n in names if n and not n.strip().endswith(("의과대학", "의학전문대학원")))


def main(argv: list[str]) -> int:
    # 인자로 이름 목록 파일을 주면 그것을, 아니면 원천 파일에서 모은 전체 목록을 쓴다.
    names: list[str] = json.load(io.open(argv[0], encoding="utf-8")) if argv else collect_names()
    if not names:
        print("  !! 매칭할 기관명이 없습니다. 먼저 `npm run build:extract` 로 원자료를 추출하세요.")
        return 1
    idx = HiraIndex()
    out, stats = {}, {}
    for n in names:
        row, how, s = idx.lookup(n)
        stats[how] = stats.get(how, 0) + 1
        out[n] = {
            "how": how,
            "score": s,
            "hiraId": row["hiraId"] if row else None,
            "matchedName": row["name"] if row else None,
            "kind": row["kind"] if row else None,
            "sggName": row["sggName"] if row else None,
            "address": row["address"] if row else None,
        }
    dest = os.path.join(ROOT, ".cache", "hira_match.json")
    json.dump(out, io.open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    matched = sum(1 for v in out.values() if v["hiraId"])
    print(f"대상 {len(names)}건 · 매칭 {matched}건 · {stats}")
    print(f"→ {dest}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

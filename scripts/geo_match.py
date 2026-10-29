# -*- coding: utf-8 -*-
"""OSM 병원 중 대상 기관의 좌표 후보를 고르고, 좌표가 속한 시군구 코드를 붙인다.

- 기관명은 토큰 유사도로 비교하되, 소재 시군구를 아는 기관은 그 경계 안의 후보만 본다.
- 결과는 '후보'이며 확정값이 아니다. 사람이 검수한 뒤 data/hospitals.json 으로 승격한다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import normalize  # noqa: E402

GENERIC = ["의과대학부속", "의과대학", "대학교병원", "대학병원", "대학교", "대학", "부속", "병원", "의료원"]


def tokens(name: str) -> set[str]:
    """기관을 구별하는 2글자 이상 조각들."""
    s = normalize(name)
    for g in GENERIC:
        s = s.replace(g, " ")
    parts = [p for p in re.split(r"\s+", s) if len(p) >= 2]
    grams = set()
    for p in parts:
        grams.add(p)
        for i in range(len(p) - 1):
            grams.add(p[i : i + 2])
    return grams


HOSPITAL_SUFFIX = ("병원", "의료원", "의료센터")
# 이름이 비슷해도 종별이 다르면 같은 기관이 아니다.
WRONG_KIND = ("한의원", "한방병원", "치과", "요양병원", "보건소", "보건지소", "의원", "동물")


def score(a: str, b: str) -> float:
    """대칭 F1. 한쪽에만 있는 조각도 벌점이 되므로 '양산병원' 같은 축약 오탐을 거른다."""
    if not any(s in b for s in HOSPITAL_SUFFIX):
        return 0.0
    if any(w in b for w in WRONG_KIND) and not any(w in a for w in WRONG_KIND):
        return 0.0
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    if not inter:
        return 0.0
    precision = inter / len(tb)
    recall = inter / len(ta)
    return 2 * precision * recall / (precision + recall)


class SggIndex:
    """좌표 → 시군구 코드."""

    def __init__(self, path: str):
        gj = json.load(io.open(path, encoding="utf-8"))
        self.geoms, self.codes, self.names = [], [], []
        for f in gj["features"]:
            self.geoms.append(shape(f["geometry"]))
            self.codes.append(f["properties"]["sggcd"])
            self.names.append(f["properties"]["sidonm"] + " " + f["properties"]["sggnm"])
        self.tree = STRtree(self.geoms)

    def representative_point(self, code: str) -> tuple[float | None, float | None]:
        """시군구 경계 안에 반드시 들어가는 대표점. 오목한 모양에서도 밖으로 나가지 않는다."""
        try:
            i = self.codes.index(code)
        except ValueError:
            return None, None
        p = self.geoms[i].representative_point()
        return p.x, p.y

    def code_at(self, lon: float, lat: float) -> tuple[str, str] | tuple[None, None]:
        p = Point(lon, lat)
        for i in self.tree.query(p):
            if self.geoms[i].covers(p):
                return self.codes[i], self.names[i]
        return None, None


def main(argv: list[str]) -> int:
    targets = json.load(io.open(argv[0], encoding="utf-8"))
    osm = json.load(io.open(os.path.join(ROOT, ".cache", "osm_hospitals.json"), encoding="utf-8"))
    idx = SggIndex(os.path.join(ROOT, "public", "geo", "sgg.json"))

    for o in osm:
        o["sgg"], o["sggName"] = idx.code_at(o["lon"], o["lat"])

    by_sgg: dict[str, list[dict]] = {}
    for o in osm:
        if o["sgg"]:
            by_sgg.setdefault(o["sgg"], []).append(o)

    out = {}
    for t in targets:
        name = t["name"] if isinstance(t, dict) else t
        want = t.get("sgg") if isinstance(t, dict) else None
        pool = by_sgg.get(want, []) if want else osm
        ranked = sorted(((score(name, o["name"]), o) for o in pool), key=lambda x: -x[0])
        out[name] = {
            "scopedTo": want,
            "candidates": [
                {"score": round(s, 3), **{k: o[k] for k in ("name", "lat", "lon", "sgg", "sggName", "addr", "osm")}}
                for s, o in ranked[:5]
                if s > 0
            ],
        }
    dest = os.path.join(ROOT, ".cache", "geo_match.json")
    json.dump(out, io.open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    hit = sum(1 for v in out.values() if v["candidates"] and v["candidates"][0]["score"] >= 0.6)
    print(f"대상 {len(out)}건, 1순위 점수 0.6 이상 {hit}건 → {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

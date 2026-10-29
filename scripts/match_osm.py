# -*- coding: utf-8 -*-
"""OSM(OpenStreetMap) 병원 데이터에서 대상 기관의 좌표·주소 후보를 찾는다.

OSM은 ODbL 라이선스이며, 여기서는 좌표·주소 '후보'를 뽑는 용도로만 쓴다.
채택된 값은 data/hospitals.json 의 coordSource 에 출처를 남긴다.
자동 매칭 결과를 그대로 신뢰하지 않고, 사람이 검수한 뒤 승격한다.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import core, normalize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OSM_CACHE = os.path.join(CACHE, "osm_hospitals.json")

OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
(
  node["amenity"="hospital"](area.kr);
  way["amenity"="hospital"](area.kr);
  relation["amenity"="hospital"](area.kr);
);
out center tags;
"""


def load_osm() -> list[dict]:
    if os.path.exists(OSM_CACHE):
        return json.load(io.open(OSM_CACHE, encoding="utf-8"))
    os.makedirs(CACHE, exist_ok=True)
    req = urllib.request.Request(
        OVERPASS,
        data=urllib.parse.urlencode({"data": QUERY}).encode(),
        headers={"User-Agent": "medmap-data-build/0.1 (https://github.com/SeokhyeonLeeMed/medmap)"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        payload = json.load(r)
    rows = []
    for e in payload["elements"]:
        t = e.get("tags", {})
        lat = e.get("lat") or (e.get("center") or {}).get("lat")
        lon = e.get("lon") or (e.get("center") or {}).get("lon")
        if lat is None or not t.get("name"):
            continue
        rows.append(
            {
                "osm": f'{e["type"]}/{e["id"]}',
                "name": t["name"],
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "addr": t.get("addr:full")
                or " ".join(
                    filter(
                        None,
                        [
                            t.get("addr:province"),
                            t.get("addr:city"),
                            t.get("addr:district"),
                            t.get("addr:street"),
                            t.get("addr:housenumber"),
                        ],
                    )
                )
                or None,
                "website": t.get("website") or t.get("contact:website"),
            }
        )
    json.dump(rows, io.open(OSM_CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return rows


def build_index(rows: list[dict]) -> tuple[dict, dict]:
    exact, loose = {}, {}
    for r in rows:
        exact.setdefault(normalize(r["name"]), []).append(r)
        loose.setdefault(core(r["name"]), []).append(r)
    return exact, loose


def lookup(name: str, exact: dict, loose: dict) -> tuple[str, list[dict]]:
    n, c = normalize(name), core(name)
    if n in exact:
        return "exact", exact[n]
    if c in loose:
        return "core", loose[c]
    hits = [r for key, rs in loose.items() if c and (c in key or key in c) for r in rs]
    if hits:
        return "substring", hits
    return "none", []


def main(argv: list[str]) -> int:
    rows = load_osm()
    exact, loose = build_index(rows)
    print(f"OSM 병원 {len(rows)}건 로드")
    names = json.load(io.open(argv[0], encoding="utf-8")) if argv else []
    result = {}
    stats = {"exact": 0, "core": 0, "substring": 0, "none": 0}
    for nm in names:
        kind, hits = lookup(nm, exact, loose)
        stats[kind] += 1
        result[nm] = {"match": kind, "candidates": hits[:4]}
    print("  매칭:", stats)
    out = os.path.join(CACHE, "osm_match.json")
    json.dump(result, io.open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("  →", out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

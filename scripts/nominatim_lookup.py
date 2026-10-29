# -*- coding: utf-8 -*-
"""Nominatim(OSM) 지오코딩 — 자동 매칭에서 남은 소수 기관만 조회한다.

Nominatim 이용 정책을 지킨다: 식별 가능한 User-Agent, 초당 1건 이하.
https://operations.osmfoundation.org/policies/nominatim/
결과는 후보일 뿐이며, 사람이 검수한 뒤 data/hospitals.json 으로 승격한다.
"""
from __future__ import annotations

import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "medmap-data-build/0.1 (github.com/SeokhyeonLeeMed/medmap; research project)"
ENDPOINT = "https://nominatim.openstreetmap.org/search"


def search(query: str, limit: int = 5) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "countrycodes": "kr", "limit": limit, "addressdetails": 1}
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main(argv: list[str]) -> int:
    queries = json.load(io.open(argv[0], encoding="utf-8"))
    out = {}
    for i, q in enumerate(queries):
        if i:
            time.sleep(1.1)  # 이용 정책: 초당 1건 이하
        try:
            hits = search(q)
        except Exception as exc:  # noqa: BLE001
            print(f"  !! {q}: {exc}")
            out[q] = {"error": str(exc)}
            continue
        out[q] = [
            {
                "name": h.get("name") or h.get("display_name", "").split(",")[0],
                "display": h.get("display_name"),
                "lat": round(float(h["lat"]), 6),
                "lon": round(float(h["lon"]), 6),
                "type": h.get("type"),
            }
            for h in hits
        ]
        top = out[q][0]["name"] if out[q] else "없음"
        print(f"  {q} -> {top}")
    dest = os.path.join(ROOT, ".cache", "nominatim.json")
    json.dump(out, io.open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("→", dest)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

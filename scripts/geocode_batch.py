# -*- coding: utf-8 -*-
"""아직 좌표가 없는 기관을 한꺼번에 지오코딩한다.

1) OSM(Overpass 로 받아 둔 전국 병원 6천여 건) 에서 이름이 충분히 일치하는 후보를 찾고,
2) 못 찾으면 Nominatim 으로 조회한다(이용 정책: 식별 가능한 User-Agent, 초당 1건 이하).

결과는 .cache/geocode_batch.json 에 쌓이고, 사람이 검수해
data/curation/coordinates.json 으로 승격한다. 자동 결과를 그대로 쓰지 않는다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_match import SggIndex, score  # noqa: E402
from nominatim_lookup import search  # noqa: E402
from normalize import core, display_name  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
RESULT = os.path.join(CACHE, "geocode_batch.json")

ACCEPT = 0.78  # 이 점수 아래는 사람이 봐야 한다

# 기관명에 들어 있는 지역 힌트. 후보를 그 지역으로 좁히는 데만 쓴다.
REGION_HINTS = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원",
    "충북", "충남", "전북", "전남", "경북", "경남", "제주", "충청", "전라", "경상",
]


def load_osm(idx: SggIndex) -> list[dict]:
    rows = json.load(io.open(os.path.join(CACHE, "osm_hospitals.json"), encoding="utf-8"))
    for r in rows:
        if "sggName" not in r:
            r["sgg"], r["sggName"] = idx.code_at(r["lon"], r["lat"])
    return rows


def hint_of(name: str) -> str | None:
    for h in REGION_HINTS:
        if h in name:
            return h
    return None


def best_osm(name: str, osm: list[dict]) -> tuple[float, dict | None]:
    hint = hint_of(name)
    best, best_row = 0.0, None
    for row in osm:
        s = score(name, row["name"])
        if s <= best:
            continue
        # 이름에 지역이 적혀 있는데 후보가 다른 지역이면 깎는다.
        if hint and row.get("sggName") and hint not in row["sggName"]:
            s *= 0.75
        best, best_row = s, row
    return best, best_row


def main(argv: list[str]) -> int:
    names: list[str] = json.load(io.open(argv[0], encoding="utf-8"))
    idx = SggIndex(os.path.join(ROOT, "public", "geo", "sgg.json"))
    osm = load_osm(idx)

    done: dict[str, dict] = {}
    if os.path.exists(RESULT):
        done = json.load(io.open(RESULT, encoding="utf-8"))

    todo = [n for n in names if n not in done]
    print(f"대상 {len(names)}건 (이미 처리 {len(names) - len(todo)}건, 새로 조회 {len(todo)}건)")

    nominatim_calls = 0
    for i, name in enumerate(todo, 1):
        s, row = best_osm(name, osm)
        if row and s >= ACCEPT:
            code, label = idx.code_at(row["lon"], row["lat"])
            done[name] = {
                "lat": row["lat"], "lon": row["lon"], "source": "src-osm",
                "matchedName": row["name"], "score": round(s, 3),
                "sgg": code, "sggName": label, "via": "osm",
            }
        else:
            if nominatim_calls:
                time.sleep(1.1)
            nominatim_calls += 1
            query = re.sub(r"^\(의\)\s*", "", display_name(name))
            hits = []
            try:
                hits = search(query)
            except Exception as exc:  # noqa: BLE001
                print(f"  !! {name}: {exc}")
            if hits:
                h = hits[0]
                code, label = idx.code_at(h["lon"], h["lat"])
                done[name] = {
                    "lat": h["lat"], "lon": h["lon"], "source": "src-nominatim",
                    "matchedName": h["name"], "sgg": code, "sggName": label, "via": "nominatim",
                    "osmBest": {"score": round(s, 3), "name": row["name"] if row else None},
                }
            else:
                done[name] = {
                    "lat": None, "lon": None, "source": None, "status": "미확인",
                    "via": "none", "osmBest": {"score": round(s, 3), "name": row["name"] if row else None},
                }
        if i % 20 == 0 or i == len(todo):
            json.dump(done, io.open(RESULT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            got = sum(1 for v in done.values() if v.get("lat") is not None)
            print(f"  {i}/{len(todo)} 진행 · 확보 {got}/{len(done)}")

    json.dump(done, io.open(RESULT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    got = sum(1 for v in done.values() if v.get("lat") is not None)
    by_osm = sum(1 for v in done.values() if v.get("via") == "osm")
    by_nom = sum(1 for v in done.values() if v.get("via") == "nominatim")
    print(f"완료: 좌표 {got}/{len(done)} (OSM {by_osm} · Nominatim {by_nom}) → {RESULT}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

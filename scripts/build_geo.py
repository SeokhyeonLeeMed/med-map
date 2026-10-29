# -*- coding: utf-8 -*-
"""행정구역 경계 GeoJSON 빌드.

출처: vuski/admdongkor (https://github.com/vuski/admdongkor)
  - 코드 MIT / 데이터 CC BY 4.0
  - 원자료: 통계청 SGIS 행정구역경계 (공공누리 제1유형)
생성물: public/geo/sido.json, public/geo/sgg.json (GeoJSON, EPSG:4326)
"""
import io
import json
import os
import sys
import urllib.request

import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import mapping

VER = os.environ.get("MEDMAP_ADM_VER", "20261001")
BASE = "https://raw.githubusercontent.com/vuski/admdongkor/master/parquet/simplified"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "adm")
OUT = os.path.join(ROOT, "public", "geo")


def fetch(name: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print(f"  download {name}")
        urllib.request.urlretrieve(f"{BASE}/{name}", path)
    return path


def to_geojson(parquet_path: str, props: list[str], precision: int = 5) -> dict:
    table = pq.read_table(parquet_path)
    cols = {n: table.column(n).to_pylist() for n in table.schema.names}
    features = []
    for i in range(table.num_rows):
        geom = wkb.loads(cols["geometry"][i])
        features.append(
            {
                "type": "Feature",
                "properties": {p: cols[p][i] for p in props},
                "geometry": round_coords(mapping(geom), precision),
            }
        )
    return {"type": "FeatureCollection", "features": features}


def round_coords(geom, p):
    def walk(c):
        if isinstance(c, (list, tuple)):
            if c and isinstance(c[0], (int, float)):
                return [round(float(c[0]), p), round(float(c[1]), p)]
            return [walk(x) for x in c]
        return c

    geom["coordinates"] = walk(geom["coordinates"])
    return geom


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        (f"sido_{VER}_light.parquet", ["sidocd", "sidonm"], "sido.json"),
        (f"sgg_{VER}_light.parquet", ["sggcd", "sggnm", "sidocd", "sidonm"], "sgg.json"),
    ]
    for name, props, out in jobs:
        gj = to_geojson(fetch(name), props)
        gj["_meta"] = {
            "source": "vuski/admdongkor (SGIS 통계청 행정구역경계)",
            "sourceUrl": "https://github.com/vuski/admdongkor",
            "license": "CC BY 4.0 / 공공누리 제1유형",
            "snapshot": VER,
            "crs": "EPSG:4326",
        }
        dest = os.path.join(OUT, out)
        with io.open(dest, "w", encoding="utf-8") as f:
            json.dump(gj, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  wrote {out}: {len(gj['features'])} features, {os.path.getsize(dest)//1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

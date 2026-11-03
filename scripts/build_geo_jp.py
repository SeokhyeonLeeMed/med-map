# -*- coding: utf-8 -*-
"""일본 행정구역 경계 GeoJSON 빌드.

출처: 国土交通省 国土数値情報 行政区域データ N03 (2025-01-01 기준)
  https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html
  이용 조건: 国土数値情報 利用規約(政府標準利用規約 第2.0版 준거, CC BY 4.0 호환). 출처 표기 필요.

생성물
  public/geo/jp_pref.json  도도부현 47 (한국의 광역자치단체에 해당)
  public/geo/jp_muni.json  시구정촌 1,902 (한국의 시군구에 해당. 정령지정도시는 행정구 단위)

가공: mapshaper 로 시구정촌 코드(N03_007)별로 합치고, 1 km² 미만 작은 섬을 지운 뒤
0.6% 로 단순화한다(경계 공유 유지). 원본은 .cache/jp/ 에만 두고 저장소에 넣지 않는다.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "jp")
WORK = os.path.join(CACHE, "n03")
OUT = os.path.join(ROOT, "public", "geo")
URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_GML.zip"
ZIP = os.path.join(CACHE, "N03-20250101_GML.zip")
STEM = "N03-20250101"
MAPSHAPER = "mapshaper@0.6.102"


def main() -> int:
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(ZIP):
        print(f"  download {URL} (약 630 MB)")
        urllib.request.urlretrieve(URL, ZIP)
    shp = os.path.join(WORK, f"{STEM}.shp")
    if not os.path.exists(shp):
        with zipfile.ZipFile(ZIP) as z:
            for ext in ("shp", "shx", "dbf", "prj", "cpg"):
                z.extract(f"{STEM}.{ext}", WORK)
    muni = os.path.join(WORK, "muni.json")
    pref = os.path.join(WORK, "pref.json")
    cmd = [
        "npx", "-y", MAPSHAPER, shp,
        "-filter", 'N03_007 != ""',
        "-each", 'name = N03_004 + (N03_005 || ""); pref = N03_001; prefCode = N03_007.slice(0,2); code = N03_007',
        "-filter-islands", "min-area=1km2", "remove-empty",
        "-dissolve2", "code", "copy-fields=name,pref,prefCode",
        "-simplify", "0.6%", "keep-shapes", "planar",
        "-o", muni, "format=geojson", "precision=0.001",
        "-dissolve2", "prefCode", "copy-fields=pref",
        "-o", pref, "format=geojson", "precision=0.001",
    ]
    print("  mapshaper 로 합치고 단순화(몇 분 걸린다)")
    subprocess.run(cmd, check=True, shell=(os.name == "nt"))

    os.makedirs(OUT, exist_ok=True)
    m = json.load(open(muni, encoding="utf-8"))
    for f in m["features"]:
        p = f["properties"]
        f["properties"] = {"code": p["code"], "name": p["name"], "pref": p["pref"], "prefCode": p["prefCode"]}
    p_ = json.load(open(pref, encoding="utf-8"))
    for f in p_["features"]:
        p = f["properties"]
        f["properties"] = {"prefCode": p["prefCode"], "pref": p["pref"]}
    for data, name in ((m, "jp_muni.json"), (p_, "jp_pref.json")):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        print(f"  wrote public/geo/{name}: {len(data['features'])} features")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

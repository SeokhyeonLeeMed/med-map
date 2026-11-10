# -*- coding: utf-8 -*-
"""SVG 가 아닌(PNG·JPG 등 비트맵) 로고를 모아 LOGOS_BITMAP.md 로 정리한다.

비트맵 로고는 확대하면 흐려지므로, 나중에 벡터 원본(SVG)을 구하면 바꿔 넣을 대상이다.
표마다 기관, 나라, 지금 파일, 픽셀 크기, 원본 출처(로고 폴더·누리집 주소)를 적는다.

사용: python scripts/list_bitmap_logos.py
"""
from __future__ import annotations

import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "LOGOS_BITMAP.md")


def load(*p):
    return json.load(io.open(os.path.join(ROOT, *p), encoding="utf-8"))


def main() -> int:
    from PIL import Image

    manifest = load("data", "curation", "logo-manifest.json")["entries"]
    insts = []
    for f, country in (("hospitals.json", "한국"), ("medical-schools.json", "한국")):
        for x in load("public", "data", f):
            insts.append((x, country))
    jp = load("public", "data", "jp.json")
    insts += [(x, "일본") for x in jp["hospitals"] + jp["schools"]]

    rows, no_logo = [], []
    for x, country in insts:
        logo = x.get("logo")
        if not logo:
            no_logo.append((x, country))
            continue
        ext = os.path.splitext(logo)[1].lower()
        if ext == ".svg":
            continue
        path = os.path.join(ROOT, "public", logo)
        try:
            with Image.open(path) as im:
                size = f"{im.width}×{im.height}"
        except OSError:
            size = "?"
        e = manifest.get(x["id"], {})
        if e.get("sourceDir") == "web":
            origin = e.get("sourceUrl") or e.get("pageUrl") or "누리집"
        elif e.get("fileName"):
            origin = f"로고 폴더 {e.get('sourceDir')}: {e['fileName']}"
        else:
            origin = ""
        kind = "병원" if x["type"] == "hospital" else "대학"
        if x.get("discipline") == "dental":
            kind = "치과" + kind
        rows.append((country, kind, x["officialName"], logo, size, origin, x["id"]))

    rows.sort(key=lambda r: (r[0] != "한국", r[1], r[2]))
    total = sum(1 for x, _ in insts if x.get("logo"))
    lines = [
        "# 비트맵 로고 목록",
        "",
        "SVG(벡터)가 아니라 PNG·JPG 같은 비트맵으로 들어간 로고다. 확대하면 흐려질 수 있으므로,",
        "벡터 원본을 구하면 `data/curation/logo-manifest.json` 의 해당 항목을 바꾸고",
        "`python scripts/build_logos.py --copy` 로 다시 복사한다. 이 문서는 `python scripts/list_bitmap_logos.py` 로 다시 만든다.",
        "",
        f"로고가 있는 기관 {total}곳 중 비트맵 **{len(rows)}곳**, SVG {total - len(rows)}곳."
        f" 로고가 없는 기관 {len(no_logo)}곳.",
        "",
        "| 나라 | 종류 | 기관 | 파일 | 크기(px) | 원본 |",
        "|---|---|---|---|---|---|",
    ]
    for country, kind, name, logo, size, origin, _ in rows:
        origin = origin.replace("|", "\\|")
        lines.append(f"| {country} | {kind} | {name} | `{logo}` | {size} | {origin} |")
    if no_logo:
        lines += ["", "## 로고가 없는 기관", ""]
        lines += [f"- {c} · {x['officialName']} (`{x['id']}`)" for x, c in no_logo]
    io.open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"  비트맵 {len(rows)} / 로고 {total} · 로고 없음 {len(no_logo)} → {OUT}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

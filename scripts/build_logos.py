# -*- coding: utf-8 -*-
"""로고 파일 ↔ 기관 매핑 manifest 를 만들고, 선택한 파일을 public/logos/ 로 복사한다.

- 폴더의 모든 이미지가 기관 로고라고 가정하지 않는다. 파일명이 기관명과 대조되는 것만 쓴다.
- 원본 폴더는 읽기만 한다. 변환·정리도 사본에만 적용한다.
- 매핑은 data/curation/logo-manifest.json 에 따로 두므로, 파일명과 기관명이 어긋나면
  스크립트를 고치지 않고 그 JSON 만 손보면 된다.

사용
  python scripts/build_logos.py            manifest 만 새로 만든다(미리보기)
  python scripts/build_logos.py --copy     manifest 에 확정된 파일을 public/logos/ 로 복사한다

로고는 각 기관의 상표다. 사용자 지시로 public/logos/ 사본을 저장소에 포함한다.
sourceDir 가 "web" 인 항목은 fetch_logos.py 로 공식 누리집에서 받아 사람이 고른 것이며,
sourceUrl 에 원래 주소를 남긴다.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys

MAX_PX = 512  # 상세 패널에서 높이 64px 로 쓴다. 고해상도 화면을 감안해도 이 정도면 충분하다

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import core  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT_DIR = os.path.join(ROOT, "public", "logos")
MANIFEST = os.path.join(DATA, "curation", "logo-manifest.json")
WEB_DIR = os.path.join(ROOT, ".cache", "logos_web")

DEFAULT_DIRS = [
    os.path.join(os.environ.get("USERPROFILE", ""), "Pictures", "로고", "ai", "정리"),
    os.path.join(os.environ.get("USERPROFILE", ""), "Pictures", "로고"),
]
# svg 를 먼저 고른다: 배경이 투명하고 어느 크기에서나 또렷하다.
EXT_PRIORITY = [".svg", ".png", ".webp", ".jpg", ".jpeg"]


def source_dirs() -> list[str]:
    env = os.environ.get("MEDMAP_LOGO_DIRS")
    if env:
        return [p for p in env.split(os.pathsep) if p]
    return [d for d in DEFAULT_DIRS if d and os.path.isdir(d)]


def scan(dirs: list[str]) -> dict[str, list[tuple[int, str]]]:
    """정규화된 파일명 → (폴더 번호, 파일명) 목록.

    manifest 에는 개인 PC 의 절대 경로를 남기지 않는다. 폴더는 번호로만 가리키고
    실제 경로는 실행할 때 환경변수나 기본값으로 다시 찾는다.
    """
    found: dict[str, list[tuple[int, str]]] = {}
    for i, d in enumerate(dirs):
        for name in sorted(os.listdir(d)):
            if not os.path.isfile(os.path.join(d, name)):
                continue
            stem, ext = os.path.splitext(name)
            if ext.lower() not in EXT_PRIORITY:
                continue
            found.setdefault(core(stem), []).append((i, name))
    return found


def pick(items: list[tuple[int, str]]) -> tuple[int, str]:
    return min(items, key=lambda it: (EXT_PRIORITY.index(os.path.splitext(it[1])[1].lower()), it[0]))


def main(argv: list[str]) -> int:
    dirs = source_dirs()
    if not dirs:
        print("로고 폴더를 찾지 못했습니다. MEDMAP_LOGO_DIRS 환경변수로 경로를 지정하세요.")
        return 1
    print("로고 폴더:")
    for d in dirs:
        print(f"  {d}")

    index = scan(dirs)
    print(f"  이미지 {sum(len(v) for v in index.values())}개, 이름 {len(index)}종")

    hospitals = json.load(io.open(os.path.join(ROOT, "public", "data", "hospitals.json"), encoding="utf-8"))
    schools = json.load(io.open(os.path.join(ROOT, "public", "data", "medical-schools.json"), encoding="utf-8"))

    existing = {}
    if os.path.exists(MANIFEST):
        existing = json.load(io.open(MANIFEST, encoding="utf-8")).get("entries", {})

    entries: dict[str, dict] = {}
    matched = 0
    for inst in hospitals:
        keys = [core(inst["officialName"]), core(inst["commonName"])] + [core(a) for a in inst["aliases"]]
        entries[inst["id"]] = resolve(inst["id"], inst["officialName"], keys, index, existing)
        matched += 1 if entries[inst["id"]]["fileName"] else 0
    for inst in schools:
        # 의과대학은 대학 로고를 쓴다.
        keys = [core(inst["universityName"]), core(inst["officialName"])]
        entries[inst["id"]] = resolve(inst["id"], inst["officialName"], keys, index, existing)
        matched += 1 if entries[inst["id"]]["fileName"] else 0

    doc = {
        "_note": (
            "기관 ID ↔ 로고 원본 파일 매핑. 파일명과 기관명이 어긋나면 fileName 을 손으로 고치고, "
            "그 기관의 로고가 없으면 null 로 둔다. null 인 기관은 화면에서 공통 기본 표식을 쓴다. "
            "자동 매칭 결과는 manual: true 인 항목을 덮어쓰지 않는다."
        ),
        "_generated": "scripts/build_logos.py",
        "_sourceDirs": "sourceDir 는 MEDMAP_LOGO_DIRS(또는 기본 로고 폴더) 목록의 순번이다. 개인 PC 의 절대 경로는 남기지 않는다.",
        "_sourceDirCount": len(dirs),
        "entries": entries,
    }
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(doc, io.open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  매핑 {matched}/{len(entries)} → {MANIFEST}")

    if "--copy" not in argv:
        print("\n  파일 복사를 하려면 --copy 를 붙여 다시 실행하세요.")
        print("  로고는 각 기관의 상표이므로 공개 배포 전에 사용 권한을 확인하세요.")
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    copied = 0
    for iid, e in entries.items():
        if e.get("fileName") is None or e.get("sourceDir") is None:
            continue
        if e["sourceDir"] == "web":
            # 공식 누리집에서 받아 사람이 고른 후보(scripts/fetch_logos.py → .cache/logos_web/).
            src = os.path.join(WEB_DIR, e["fileName"])
            if not os.path.exists(src):
                print(f"  -- {iid}: 내려받은 원본이 없어 기존 사본을 그대로 둡니다 ({e['fileName']})")
                continue
            ext = os.path.splitext(src)[1].lower()
            if ext == ".svg":
                shutil.copy2(src, os.path.join(OUT_DIR, f"{iid}.svg"))
                e["copiedExt"] = ".svg"
            else:
                e["copiedExt"] = shrink_raster(src, os.path.join(OUT_DIR, iid), e.get("crop"))
            copied += 1
            continue
        if e["sourceDir"] >= len(dirs):
            print(f"  !! {iid}: sourceDir {e['sourceDir']} 에 해당하는 폴더가 없습니다")
            continue
        src = os.path.join(dirs[e["sourceDir"]], e["fileName"])
        if not os.path.exists(src):
            print(f"  !! {iid}: 원본을 찾지 못했습니다 — {e['fileName']}")
            continue
        ext = os.path.splitext(src)[1].lower()
        if ext == ".svg":
            # 벡터는 그대로 둔다. 어느 크기에서나 또렷하고 배경이 투명하다.
            dest = os.path.join(OUT_DIR, f"{iid}{ext}")
            shutil.copy2(src, dest)  # 원본은 읽기만 하고 사본만 만든다
        else:
            e["copiedExt"] = shrink_raster(src, os.path.join(OUT_DIR, iid))
        copied += 1
    for iid, e in entries.items():
        if e.get("fileName") and e.get("sourceDir") != "web" and "copiedExt" not in e:
            e["copiedExt"] = ".svg" if e["fileName"].lower().endswith(".svg") else None
    doc["entries"] = entries
    json.dump(doc, io.open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  {copied}개 복사 → {OUT_DIR}")
    return 0


def trim(im, has_alpha: bool):
    """로고 둘레의 빈 여백을 잘라 낸다. 여백이 넓으면 화면에서 로고가 작아 보인다.

    투명 이미지는 알파 채널로, 불투명 이미지는 왼쪽 위 모서리 색과 다른 부분으로 경계를 잡는다.
    """
    from PIL import ImageChops

    if has_alpha:
        box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    else:
        bg = im.getpixel((0, 0))
        diff = ImageChops.difference(im, _solid(im, bg))
        box = diff.convert("L").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box:
        return im
    pad = max(2, int(0.03 * max(box[2] - box[0], box[3] - box[1])))
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
    return im.crop(box)


def _solid(im, color):
    from PIL import Image

    return Image.new(im.mode, im.size, color)


def shrink_raster(src: str, dest_base: str, crop: list[int] | None = None) -> str:
    """래스터 로고를 줄여 사본으로 저장하고, 실제로 쓴 확장자를 돌려준다.

    투명도가 있으면 PNG 로 살리고, 없으면 JPEG 로 저장한다. 투명 배경이 없는 사진형
    로고를 PNG 로 두면 쓸데없이 커지기 때문이다. 원본은 읽기만 한다.
    """
    from PIL import Image

    with Image.open(src) as im:
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)  # 움직이는 GIF 는 첫 장면만 쓴다. ICO 는 Pillow 가 가장 큰 크기를 연다.
        if crop:
            # 스프라이트 이미지에서 로고 부분만 잘라 낸다(left, top, right, bottom).
            im = im.crop(tuple(crop))
        has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        im = im.convert("RGBA" if has_alpha else "RGB")
        im = trim(im, has_alpha)
        if max(im.size) > MAX_PX:
            im.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
        if has_alpha:
            im.save(dest_base + ".png", "PNG", optimize=True)
            return ".png"
        im.save(dest_base + ".jpg", "JPEG", quality=86, optimize=True, progressive=True)
        return ".jpg"


def resolve(iid: str, name: str, keys: list[str], index: dict[str, list[str]], existing: dict) -> dict:
    prev = existing.get(iid)
    if prev and prev.get("manual"):
        return prev
    for k in keys:
        if k and k in index:
            dir_index, file_name = pick(index[k])
            return {
                "institution": name,
                "sourceDir": dir_index,
                "fileName": file_name,
                "matchedBy": k,
                "manual": False,
            }
    return {"institution": name, "sourceDir": None, "fileName": None, "matchedBy": None, "manual": False}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

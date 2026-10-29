# -*- coding: utf-8 -*-
"""로고 파일 ↔ 기관 매핑 manifest 를 만들고, 선택한 파일을 public/logos/ 로 복사한다.

- 폴더의 모든 이미지가 기관 로고라고 가정하지 않는다. 파일명이 기관명과 대조되는 것만 쓴다.
- 원본 폴더는 읽기만 한다. 변환·정리도 사본에만 적용한다.
- 매핑은 data/curation/logo-manifest.json 에 따로 두므로, 파일명과 기관명이 어긋나면
  스크립트를 고치지 않고 그 JSON 만 손보면 된다.

사용
  python scripts/build_logos.py            manifest 만 새로 만든다(미리보기)
  python scripts/build_logos.py --copy     manifest 에 확정된 파일을 public/logos/ 로 복사한다

로고는 각 기관의 상표다. 공개 배포 여부는 사람이 판단한다. 기본 .gitignore 는
public/logos/ 를 추적하지 않으므로, 복사해도 저장소에 올라가지 않는다.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import core  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT_DIR = os.path.join(ROOT, "public", "logos")
MANIFEST = os.path.join(DATA, "curation", "logo-manifest.json")

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
        if e["sourceDir"] >= len(dirs):
            print(f"  !! {iid}: sourceDir {e['sourceDir']} 에 해당하는 폴더가 없습니다")
            continue
        src = os.path.join(dirs[e["sourceDir"]], e["fileName"])
        if not os.path.exists(src):
            print(f"  !! {iid}: 원본을 찾지 못했습니다 — {e['fileName']}")
            continue
        ext = os.path.splitext(src)[1].lower()
        dest = os.path.join(OUT_DIR, f"{iid}{ext}")
        shutil.copy2(src, dest)  # 원본은 그대로 두고 사본만 만든다
        copied += 1
    print(f"  {copied}개 복사 → {OUT_DIR}")
    return 0


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

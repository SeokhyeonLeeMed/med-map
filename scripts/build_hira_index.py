# -*- coding: utf-8 -*-
"""심평원 「전국 병의원 및 약국 현황」 CSV → 병원급 이상 기관 색인.

공공데이터포털 파일데이터(건강보험심사평가원_전국 병의원 및 약국 현황)를 내려받아
압축을 푼 폴더를 가리키면, 병원급 이상 기관만 추려 하나의 JSON 으로 모은다.

뽑는 것
  기본: 요양기관명, 종별, 시도·시군구, 도로명주소, 전화, 홈페이지, 개설일자, 좌표
  인력: 총의사수, 의과전문의 수, 의과인턴·레지던트 수(현재 재직)
  진료과목: 과목명 + 과목별 전문의 수
  병상: 일반입원실(상급·일반), 중환자실(성인·소아·신생아), 정신과, 격리, 무균치료실 등

주의
  - 좌표는 심평원이 제공하는 값이며 EPSG:4326(경도 X, 위도 Y)이다.
  - 인력 수는 '현재 재직 중'이지 전공의 모집 정원이 아니다. 둘을 섞지 않는다.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys

csv.field_size_limit(10_000_000)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
DEFAULT_DIR = os.path.join(CACHE, "hira", "extracted")
OUT = os.path.join(CACHE, "hira", "hospitals.json")

# 병원급 이상만 남긴다. 의원·약국·한의원 등은 이 프로젝트의 대상이 아니다.
KEEP_TYPES = {"상급종합", "종합병원", "병원", "요양병원", "정신병원", "치과병원", "한방병원"}

BED_FIELDS = [
    ("일반입원실상급병상수", "일반입원실 상급"),
    ("일반입원실일반병상수", "일반입원실 일반"),
    ("성인중환자병상수", "성인 중환자"),
    ("소아중환자병상수", "소아 중환자"),
    ("신생아중환자병상수", "신생아 중환자"),
    ("정신과폐쇄상급병상수", "정신과 폐쇄 상급"),
    ("정신과폐쇄일반병상수", "정신과 폐쇄 일반"),
    ("정신과개방상급병상수", "정신과 개방 상급"),
    ("정신과개방일반병상수", "정신과 개방 일반"),
    ("격리병실병상수", "격리"),
    ("무균치료실병상수", "무균치료실"),
]
# 메디컬 목록 엑셀이 쓴 병상 수 정의와 맞추기 위한 합산 대상
BED_SUM_KEYS = [k for k, _ in BED_FIELDS]


def find_file(folder: str, prefix: str) -> str | None:
    for name in sorted(os.listdir(folder)):
        if name.startswith(prefix) and name.lower().endswith(".csv"):
            return os.path.join(folder, name)
    return None


def read_csv(path: str):
    for enc in ("cp949", "utf-8-sig", "utf-8"):
        try:
            with io.open(path, encoding=enc, newline="") as f:
                for row in csv.DictReader(f):
                    yield row
            return
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"인코딩을 알 수 없습니다: {path}")


def to_int(v: str | None) -> int | None:
    if v is None:
        return None
    s = v.strip()
    if not s or not re.fullmatch(r"-?\d+", s):
        return None
    return int(s)


def to_float(v: str | None) -> float | None:
    if v is None:
        return None
    s = v.strip()
    try:
        return float(s)
    except ValueError:
        return None


def unpack_downloaded_zip(folder: str) -> bool:
    """fetch_sources.mjs 가 받아 둔 ZIP 이 있으면 folder 에 푼다.

    ZIP 안 파일명은 UTF-8 표시 없이 cp949 로 적혀 있어 다시 디코딩한다.
    내려받은 압축 파일이므로 안의 경로는 무시하고 파일 이름만 써서 folder 밖으로 나가지 않게 한다.
    """
    import zipfile

    zips = sorted(
        f for f in os.listdir(os.path.dirname(folder)) if f.lower().endswith(".zip")
    ) if os.path.isdir(os.path.dirname(folder)) else []
    if not zips:
        return False
    src = os.path.join(os.path.dirname(folder), zips[-1])
    os.makedirs(folder, exist_ok=True)
    with zipfile.ZipFile(src) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if not info.flag_bits & 0x800:  # UTF-8 표시가 없으면 cp949 로 다시 읽는다
                try:
                    name = name.encode("cp437").decode("cp949")
                except UnicodeError:
                    pass
            base = os.path.basename(name.replace("\\", "/"))
            if not base.lower().endswith(".csv"):
                continue
            with zf.open(info) as fin, io.open(os.path.join(folder, base), "wb") as fout:
                fout.write(fin.read())
    print(f"  압축 해제: {os.path.basename(src)} → {folder}")
    return True


def main(argv: list[str]) -> int:
    folder = argv[0] if argv else os.environ.get("MEDMAP_HIRA_DIR", DEFAULT_DIR)
    if not os.path.isdir(folder) or not find_file(folder, "1.병원정보서비스"):
        unpack_downloaded_zip(folder)
    if not os.path.isdir(folder):
        print(f"  !! 폴더가 없습니다: {folder}")
        print("  `npm run fetch:sources` 로 '건강보험심사평가원_전국 병의원 및 약국 현황' ZIP 을 받거나,")
        print("  직접 받아 압축을 푼 폴더를 인자로 주거나 MEDMAP_HIRA_DIR 로 지정하세요.")
        return 1

    base_path = find_file(folder, "1.병원정보서비스")
    dept_path = find_file(folder, "5.")
    fac_path = find_file(folder, "3.")
    if not base_path:
        print(f"  !! 1.병원정보서비스 CSV 를 찾지 못했습니다: {folder}")
        return 1

    hospitals: dict[str, dict] = {}
    total = 0
    for row in read_csv(base_path):
        total += 1
        kind = (row.get("종별코드명") or "").strip()
        if kind not in KEEP_TYPES:
            continue
        key = row["암호화요양기호"]
        hospitals[key] = {
            "hiraId": key,
            "name": (row.get("요양기관명") or "").strip(),
            "kind": kind,
            "sido": (row.get("시도코드명") or "").strip(),
            "sggName": (row.get("시군구코드명") or "").strip(),
            "address": (row.get("주소") or "").strip(),
            "postcode": (row.get("우편번호") or "").strip() or None,
            "phone": (row.get("전화번호") or "").strip() or None,
            "homepage": (row.get("병원홈페이지") or "").strip() or None,
            "openedOn": (row.get("개설일자") or "").strip() or None,
            "doctors": to_int(row.get("총의사수")),
            "specialists": to_int(row.get("의과전문의 인원수")),
            "interns": to_int(row.get("의과인턴 인원수")),
            "residents": to_int(row.get("의과레지던트 인원수")),
            "lon": to_float(row.get("좌표(X)")),
            "lat": to_float(row.get("좌표(Y)")),
            "departments": [],
            "beds": {},
            "bedTotal": None,
        }
    print(f"  기본정보 {total:,}행 중 병원급 이상 {len(hospitals):,}곳")

    if dept_path:
        n = 0
        for row in read_csv(dept_path):
            h = hospitals.get(row["암호화요양기호"])
            if h is None:
                continue
            name = (row.get("진료과목코드명") or "").strip()
            if not name:
                continue
            h["departments"].append(
                {
                    "name": name,
                    "code": (row.get("진료과목코드") or "").strip(),
                    "specialists": to_int(row.get("과목별 전문의수")),
                }
            )
            n += 1
        print(f"  진료과목 {n:,}건 연결")

    if fac_path:
        n = 0
        for row in read_csv(fac_path):
            h = hospitals.get(row["암호화요양기호"])
            if h is None:
                continue
            beds = {}
            for field, label in BED_FIELDS:
                v = to_int(row.get(field))
                if v:
                    beds[label] = v
            h["beds"] = beds
            h["bedTotal"] = sum(to_int(row.get(k)) or 0 for k in BED_SUM_KEYS)
            n += 1
        print(f"  시설정보 {n:,}곳 연결")

    for h in hospitals.values():
        h["departments"].sort(key=lambda d: (-(d["specialists"] or 0), d["name"]))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(list(hospitals.values()), io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  wrote {OUT} ({os.path.getsize(OUT) // 1024:,} KB)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

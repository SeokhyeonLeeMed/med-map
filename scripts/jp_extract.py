# -*- coding: utf-8 -*-
"""일본 원자료 추출 → .cache/jp/extracted.json

원자료(모두 .cache/jp/ 에 내려받아 둔다. 저장소에는 넣지 않는다)
  iryou/01-1_hospital_facility_info_20251201.csv   医療情報ネット オープンデータ(2025-12-01) 병원 기본·병상
  iryou/01-2_hospital_speciality_hours_20251201.csv 같은 자료의 진료과목
  byosho_shisetsu_r6.xlsx                           令和6年度 病床機能報告 施設票(2024-07-01) 의료인 수·설치 주체
  tokutei_20261001.pdf                              特定機能病院の承認状況(2026-10-01)
  mext_teiin_r8.pdf                                 大学別医学部入学定員等一覧(2025-10, 令和8年度 계획)

여기서는 표를 읽어 구조만 만든다. 어느 병원을 지도에 올릴지는 data/jp/hospitals.json 이 정한다.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JP = os.path.join(ROOT, ".cache", "jp")
OUT = os.path.join(JP, "extracted.json")
STAMP = "20251201"


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


LEGAL = re.compile(
    r"^(国立大学法人|公立大学法人|学校法人|国立研究開発法人|地方独立行政法人|独立行政法人|公益財団法人|一般財団法人|"
    r"社会福祉法人|医療法人社団|医療法人財団|医療法人|北海道公立大学法人|京都府公立大学法人|国立健康危機管理研究機構)"
)


def name_key(s: str) -> str:
    """법인격·공백을 떼고 비교하는 열쇠. 같은 이름의 다른 병원은 시구정촌 코드로 가른다."""
    tokens = nfkc(s).split()
    # '学校法人日本大学 日本大学医学部附属板橋病院'처럼 법인명이 띄어쓰기로 앞에 붙은 경우 첫 토막을 뗀다.
    if len(tokens) > 1 and LEGAL.match(tokens[0]):
        tokens = tokens[1:]
    s = "".join(tokens)
    for _ in range(3):
        s2 = LEGAL.sub("", s)
        if s2 == s:
            break
        s = s2
    # 법인명이 이름 앞에 붙은 경우(예: 学校法人慶應義塾大学病院 → 慶應義塾大学病院)는 위에서 처리된다.
    s = s.replace("東海国立大学機構", "").replace("大阪大阪公立", "大阪公立")
    return s


def read_csv_from_zip_or_dir(name: str) -> list[dict]:
    path = os.path.join(JP, "iryou", name)
    if not os.path.exists(path):
        with zipfile.ZipFile(os.path.join(JP, "iryou", f"e-gov{STAMP}.zip")) as z:
            z.extract(name, os.path.join(JP, "iryou"))
    with io.open(path, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def to_int(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(float(str(v).replace(",", "")))
    except ValueError:
        return None


def extract_opendata() -> dict:
    base = read_csv_from_zip_or_dir(f"01-1_hospital_facility_info_{STAMP}.csv")
    spec = read_csv_from_zip_or_dir(f"01-2_hospital_speciality_hours_{STAMP}.csv")
    depts: dict[str, list[str]] = {}
    for r in spec:
        name = (r.get("診療科目名") or "").strip()
        if name and name not in depts.setdefault(r["ID"], []):
            depts[r["ID"]].append(name)
    out = {}
    for r in base:
        lat, lon = float(r["所在地座標（緯度）"] or 0), float(r["所在地座標（経度）"] or 0)
        beds = {k: to_int(r.get(k)) for k in ("一般病床", "療養病床", "精神病床", "結核病床", "感染症病床")}
        out[r["ID"]] = {
            "id": r["ID"],
            "name": nfkc(r["正式名称"]),
            "kana": r["正式名称（フリガナ）"],
            "short": nfkc(r["略称"]),
            "english": r["英語表記（ローマ字表記）"],
            "prefCode": r["都道府県コード"],
            "muniCode": r["都道府県コード"] + r["市区町村コード"],
            "address": nfkc(r["所在地"]),
            "lat": lat or None,
            "lon": lon or None,
            "homepage": r["案内用ホームページアドレス"] or None,
            "beds": {k: v for k, v in beds.items() if v},
            "bedTotal": to_int(r["合計病床数"]),
            "departments": depts.get(r["ID"], []),
        }
    print(f"  医療情報ネット 병원 {len(out):,}곳")
    return out


STAFF_COLS = {
    "doctorsFull": "施設全体_医師_常勤", "doctorsPart": "施設全体_医師_非常勤",
    "nursesFull": "施設全体_看護師_常勤", "nursesPart": "施設全体_看護師_非常勤",
    "assistNursesFull": "施設全体_准看護師_常勤", "assistNursesPart": "施設全体_准看護師_非常勤",
    "pharmacistsFull": "施設全体_薬剤師_常勤", "pharmacistsPart": "施設全体_薬剤師_非常勤",
    "dentistsFull": "施設全体_歯科医師_常勤", "dentistsPart": "施設全体_歯科医師_非常勤",
}


def extract_staff() -> list[dict]:
    import openpyxl

    wb = openpyxl.load_workbook(os.path.join(JP, "byosho_shisetsu_r6.xlsx"), read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    rows = [next(it) for _ in range(6)]
    head = rows[4]
    idx = {h: i for i, h in enumerate(head) if h}
    out = []
    for row in it:
        if not row or row[0] != "病院":
            continue
        rec = {
            "name": nfkc(row[idx["医療機関名"]]),
            "muniCode": str(row[idx["市区町村コード"]] or ""),
            "establisher": nfkc(row[idx["設置主体（2024（令和6）年7月1日時点）"]] or ""),
            "tokutei": row[idx["特定機能病院の承認の有無"]],
        }
        for k, col in STAFF_COLS.items():
            v = row[idx[col]] if col in idx else None
            rec[k] = float(v) if isinstance(v, (int, float)) else None
        out.append(rec)
    print(f"  病床機能報告 施設票 병원 {len(out):,}곳")
    return out


def extract_tokutei() -> list[dict]:
    import pdfplumber

    out, cat = [], None
    with pdfplumber.open(os.path.join(JP, "tokutei_20261001.pdf")) as pdf:
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                line = nfkc(line)
                m = re.match(r"【(.+)】", line)
                if m:
                    cat = {"特定機能病院A": "A", "特定機能病院B": "B"}.get(m.group(1), "その他")
                    continue
                m = re.match(r"^(\d+) (\S+) (\S+) ([HSR]\d+\.\d+\.\d+) ([HSR]\d+\.\d+\.\d+)$", line)
                if m:
                    out.append({"no": int(m.group(1)), "category": cat, "name": m.group(2), "address": m.group(3),
                                "approvedOn": m.group(4), "reviewedOn": m.group(5)})
    print(f"  特定機能病院 {len(out)}곳 (A {sum(1 for x in out if x['category']=='A')} · "
          f"B {sum(1 for x in out if x['category']=='B')} · その他 {sum(1 for x in out if x['category']=='その他')})")
    return out


def extract_quota() -> list[dict]:
    import pdfplumber

    out = []
    pat = re.compile(r"(\S+?)(?:※\d)? (国立|公立|私立) ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)")
    with pdfplumber.open(os.path.join(JP, "mext_teiin_r8.pdf")) as pdf:
        text = "\n".join(nfkc(p.extract_text() or "") for p in pdf.pages)
    for m in pat.finditer(text):
        name = m.group(1)
        if not name.endswith(("大学", "大学校")):
            continue
        r7, base, inc, r8 = (int(x.replace(",", "")) for x in m.group(3, 4, 5, 6))
        out.append({"university": name, "type": m.group(2), "r7": r7, "r8Base": base, "r8Increase": inc, "r8Plan": r8,
                    "note": "募集人員" if name in ("昭和医科大学", "東京医科大学") else None})
    print(f"  의대 정원 {len(out)}개 대학, 2026학년도 합계 {sum(x['r8Plan'] for x in out):,}")
    return out


def main() -> int:
    data = {
        "opendata": extract_opendata(),
        "staff": extract_staff(),
        "tokutei": extract_tokutei(),
        "quota": extract_quota(),
    }
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"→ {OUT}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

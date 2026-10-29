# -*- coding: utf-8 -*-
"""로컬 원자료 → 중간 JSON 추출.

입력 (환경변수로 경로 재정의 가능, 기본값은 사용자 문서 폴더):
  MEDMAP_XLSX        메디컬 목록 엑셀
  MEDMAP_INTERN_PDF  2026년도 하반기 인턴 모집인원 PDF
  MEDMAP_RESID_PDF   2026년도 하반기 레지던트 모집인원 PDF

출력: .cache/extracted/*.json  (사람이 검수한 뒤 data/ 로 승격)

원본 파일은 읽기만 하며 절대 수정하지 않는다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".cache", "extracted")

DOCS = os.path.join(os.environ.get("USERPROFILE", os.path.expanduser("~")), "Documents", "고려대 의대")
XLSX = os.environ.get("MEDMAP_XLSX", os.path.join(DOCS, "메디컬 목록_260922.xlsx"))
PDF_DIR = os.path.join(DOCS, "붙임 1~2. 2026년도 하반기 인턴 및 레지던트 모집인원")
INTERN_PDF = os.environ.get("MEDMAP_INTERN_PDF", os.path.join(PDF_DIR, "붙임1. 2026년도 하반기 인턴 모집인원.pdf"))
RESID_PDF = os.environ.get("MEDMAP_RESID_PDF", os.path.join(PDF_DIR, "붙임2. 2026년도 하반기 레지던트 모집인원.pdf"))

# 엑셀 "관련 병원" 셀 한 줄 형식: 「병원명 (시도 시군구, 1,234병상, 부속)」
HOSPITAL_LINE = re.compile(r"^(?P<name>.+?)\s*\((?P<loc>[^,()]+?)(?:,\s*(?P<beds>[\d,]+)병상)?(?:,\s*(?P<rel>부속|협력|위탁운영))?\)\s*$")

MED_DEPTS = ("의과대학", "의학전문대학원")


def dump(obj, name: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    size = os.path.getsize(path)
    print(f"  wrote {name} ({size // 1024} KB)")


# ---------------------------------------------------------------- 엑셀


def parse_related_hospitals(cell: str | None) -> list[dict]:
    if not cell:
        return []
    out = []
    for raw in str(cell).split("\n"):
        line = raw.strip()
        if not line:
            continue
        m = HOSPITAL_LINE.match(line)
        if not m:
            out.append({"rawName": line, "parseFailed": True})
            continue
        beds = m.group("beds")
        out.append(
            {
                "rawName": m.group("name").strip(),
                "rawLocation": m.group("loc").strip(),
                "beds": int(beds.replace(",", "")) if beds else None,
                "relation": m.group("rel"),
            }
        )
    return out


def extract_xlsx() -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb["Sheet1"]
    rows = list(ws.iter_rows(values_only=True))
    header = [str(c or "").strip() for c in rows[0]]
    schools, others = [], 0
    for r in rows[1:]:
        rec = dict(zip(header, r))
        dept = str(rec.get("학과") or "")
        # "의과대학(간호학과)" 같은 행은 간호학과이므로 제외한다.
        if dept not in MED_DEPTS:
            others += 1
            continue
        schools.append(
            {
                "sido": rec.get("광역자치단체"),
                "sgg": rec.get("기초자치단체"),
                "university": rec.get("학교"),
                "universityUrl": rec.get("학교 링크"),
                "schoolKind": dept,
                "deptUrl": rec.get("학과 사이트"),
                "founded": rec.get("설립연도"),
                "quota2026": rec.get("정원"),
                "quota2027": rec.get("2027학년도 정원"),
                "relatedHospitals": parse_related_hospitals(rec.get("관련 병원(위치, 병상 수)")),
            }
        )

    sources = []
    if "기준·출처" in wb.sheetnames:
        for r in wb["기준·출처"].iter_rows(values_only=True):
            if r and r[0]:
                sources.append({"field": str(r[0]).strip(), "basis": str(r[1] or "").strip()})

    print(f"  엑셀: 의과대학·의전원 {len(schools)}행 (그 외 {others}행 제외)")
    bad = [h for s in schools for h in s["relatedHospitals"] if h.get("parseFailed")]
    if bad:
        print(f"  !! 관련 병원 파싱 실패 {len(bad)}건: {[b['rawName'] for b in bad][:5]}")
    return {"schools": schools, "sourceNotes": sources}


# ---------------------------------------------------------------- PDF

SIDO_TOKENS = [
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
    "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
]
# 레지던트 PDF 과목명 (보건복지부 전문과목 26개 + 인턴)
SPECIALTIES = [
    "가정의학과", "결핵과", "내과", "마취통증의학과", "방사선종양학과", "병리과",
    "비뇨의학과", "산부인과", "성형외과", "소아청소년과", "신경과", "신경외과",
    "신경정신과", "심장혈관흉부외과", "안과", "영상의학과", "예방의학과", "외과",
    "응급의학과", "이비인후과", "재활의학과", "정신건강의학과", "정형외과",
    "직업환경의학과", "진단검사의학과", "피부과", "핵의학과", "인턴",
]
# 긴 이름이 먼저 매칭되도록 (예: 신경외과 before 신경과)
SPECIALTIES.sort(key=len, reverse=True)
FLAGS = ["탄력가능", "탄력불가", "통합수련", "모자협약", "탄력"]


def strip_chrome(text: str, page_no: int) -> str:
    """머리말·꼬리말·쪽번호 제거.

    쪽번호는 본문 마지막 숫자에 그대로 이어 붙어 추출되므로(예: "…인턴37모자협약2"),
    모집인원 숫자를 훼손하지 않도록 '그 쪽의 번호와 정확히 일치하는 접미사'만 잘라낸다.
    """
    text = text.replace("<붙임>", "")
    text = re.sub(r"2026년도 하반기 전공의\([^)]*\) 모집인원", "", text)
    text = re.sub(r"※[^\n]*", "", text)
    text = re.sub(r"지역모집병원\(기관\)명과목모집인원탄력운영비고", "", text)
    text = re.sub(r"지역모집병원\(기관\)명과목모집인원비고", "", text)
    text = text.rstrip()
    suffix = str(page_no)
    if text.endswith(suffix):
        text = text[: -len(suffix)]
    else:
        raise ValueError(f"{page_no}쪽 꼬리말을 찾지 못했다: …{text[-30:]!r}")
    return text


def parse_recruitment(path: str, kind: str) -> list[dict]:
    """공백이 거의 없는 PDF 표 텍스트를 「지역+병원명+과목+인원(+플래그)」 레코드로 분해."""
    import pypdf

    reader = pypdf.PdfReader(path)
    pages = [strip_chrome(p.extract_text() or "", i + 1) for i, p in enumerate(reader.pages)]
    flat = re.sub(r"\s+", "", "\n".join(pages))
    spec_alt = "|".join(SPECIALTIES)
    sido_alt = "|".join(SIDO_TOKENS)
    pattern = re.compile(
        rf"(?P<region>{sido_alt})(?P<hospital>.+?)(?P<specialty>{spec_alt})(?P<count>\d+)"
        rf"(?P<flags>(?:{'|'.join(FLAGS)})*)"
        rf"(?=(?:{sido_alt})|$)"
    )
    records, pos = [], 0
    for m in pattern.finditer(flat):
        if m.start() != pos:
            skipped = flat[pos:m.start()]
            if skipped.strip(string_digits()):
                records.append({"_unparsed": skipped})
        pos = m.end()
        flags = m.group("flags")
        records.append(
            {
                "region": m.group("region"),
                "hospitalRaw": m.group("hospital"),
                "specialty": m.group("specialty"),
                "quota": int(m.group("count")),
                "flexible": "탄력가능" in flags,
                "integratedTraining": "통합수련" in flags,
                "mojaAgreement": "모자협약" in flags,
            }
        )
    tail = flat[pos:]
    if tail.strip(string_digits()):
        records.append({"_unparsed": tail})

    unparsed = [r for r in records if "_unparsed" in r]
    good = [r for r in records if "_unparsed" not in r]
    print(f"  {kind}: {len(good)}건 파싱, 미파싱 {len(unparsed)}건")
    for u in unparsed[:5]:
        print(f"     미파싱: {u['_unparsed'][:70]}")
    return records


def string_digits() -> str:
    return "0123456789 \n\t"


def main() -> int:
    print("원자료 추출")
    missing = [p for p in (XLSX, INTERN_PDF, RESID_PDF) if not os.path.exists(p)]
    if missing:
        for p in missing:
            print(f"  !! 파일 없음: {p}")
        return 1

    dump(extract_xlsx(), "xlsx_schools.json")
    dump(
        {
            "year": 2026,
            "half": "하반기",
            "source": "보건복지부 「2026년도 하반기 전공의(인턴) 모집인원」 붙임1",
            "records": parse_recruitment(INTERN_PDF, "인턴"),
        },
        "recruit_2026h2_intern.json",
    )
    dump(
        {
            "year": 2026,
            "half": "하반기",
            "source": "보건복지부 「2026년도 하반기 전공의(레지던트) 모집인원」 붙임2",
            "records": parse_recruitment(RESID_PDF, "레지던트"),
        },
        "recruit_2026h2_resident.json",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

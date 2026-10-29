# -*- coding: utf-8 -*-
"""연도별 전공의 정원 PDF → 중간 JSON.

출처: 대한병원협회 수련환경평가본부 「○○년도 전공의(인턴 및 레지던트 1년차) 정원 통보」 공지 첨부.
근거: 각 해 보건복지부 의료인력정책과 공문.

표 머리글이 해마다 다르다. 그래서 열 위치를 고정하지 않고 머리글을 읽어 역할을 찾는다.

  2023 인턴    연번 | 병원명 | 기본정원(A) | 정책적 별도정원(B) | 비고
  2024 인턴    병원명 | 기본정원 | 정책적 별도정원
  2025 인턴    병원명 | 과목 | 기본정원(A) | 별도정원(B) | 최종정원(A+B)
  2026 인턴    병원명 | 과목 | 기본정원(A) | 별도정원(B) | 감원(C) | 최종정원(A+B-C)
  2023 레지던트 연번 | 병원명 | 과목명 | 기본정원(A) | 미충원 별도정원(B) | 정책적 별도정원(C) | 비고
  2024 레지던트 병원명 | 과목 | 기본정원 | 미충원 별도정원 | 정책적 별도정원 | 비고
  2025·2026    병원명 | 과목 | 기본정원(A) | 별도정원(B) | 최종정원(A+B) | 비고

최종정원 열이 있으면 그 값을 총정원으로 쓰고, 없으면 기본정원과 별도정원을 더한다.
괄호 친 수(예: "(1)")는 사후정원이라 총정원에 더하지 않고 따로 적는다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(CACHE, "extracted")
SRC_DIR = os.environ.get("MEDMAP_QUOTA_DIR", os.path.join(CACHE, "quota"))

NUM = re.compile(r"^\(?(-?\d+)\)?$")

# 머리글 글자 → 역할. 긴 것부터 보아야 '미충원 별도정원'이 '별도정원'으로 잡히지 않는다.
HEADER_ROLES = [
    ("미충원별도정원", "unfilled"),
    ("정책적별도정원", "policy"),
    ("최종정원", "final"),
    ("기본정원", "base"),
    ("별도정원", "extra"),
    ("감원", "reduction"),
    ("병원명", "hospital"),
    ("기관명", "hospital"),
    ("과목명", "specialty"),
    ("과목", "specialty"),
    ("비고", "note"),
    ("연번", "seq"),
]


# 옛 명칭 → 현재 명칭. 2023년도 표는 '흉부외과', 2024년도부터는 '심장혈관흉부외과'로 적혀 있다.
RENAMED_SPECIALTIES = {"흉부외과": "심장혈관흉부외과"}


def squash(s: str | None) -> str:
    return re.sub(r"\s+", "", (s or "").replace("\n", ""))


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def parse_cell(raw: str | None) -> tuple[int | None, bool]:
    """숫자 칸. 괄호가 쳐져 있으면 사후정원 표시."""
    s = squash(raw)
    if not s:
        return None, False
    deferred = s.startswith("(") and s.endswith(")")
    m = NUM.match(s)
    return (int(m.group(1)), deferred) if m else (None, False)


def map_header(header: list[str | None]) -> dict[str, int]:
    """머리글 행 → {역할: 열 번호}."""
    roles: dict[str, int] = {}
    for i, cell in enumerate(header):
        key = squash(cell)
        if not key:
            continue
        for needle, role in HEADER_ROLES:
            if needle in key and role not in roles:
                roles[role] = i
                break
    return roles


def read_rows(path: str) -> list[tuple[dict[str, int], list[str | None]]]:
    """표를 페이지마다 읽되, 페이지마다 머리글이 다시 나오므로 그때그때 매핑한다."""
    import pdfplumber

    out: list[tuple[dict[str, int], list[str | None]]] = []
    roles: dict[str, int] = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    maybe = map_header(row)
                    if "hospital" in maybe and "base" in maybe:
                        roles = maybe  # 머리글 행
                        continue
                    if roles:
                        out.append((roles, row))
    return out


def get(row: list[str | None], roles: dict[str, int], role: str) -> str | None:
    i = roles.get(role)
    return row[i] if i is not None and i < len(row) else None


def parse(path: str, track: str) -> list[dict]:
    records: list[dict] = []
    for roles, row in read_rows(path):
        hospital = clean(get(row, roles, "hospital"))
        if not hospital:
            continue
        base, deferred = parse_cell(get(row, roles, "base"))
        unfilled, _ = parse_cell(get(row, roles, "unfilled"))
        policy, _ = parse_cell(get(row, roles, "policy"))
        extra, _ = parse_cell(get(row, roles, "extra"))
        reduction, _ = parse_cell(get(row, roles, "reduction"))
        final, _ = parse_cell(get(row, roles, "final"))
        # 국군수도병원처럼 기본정원 칸은 비어 있고 별도정원에만 값이 있는 행이 있다.
        # 기본정원이 없다고 행을 버리면 그 기관이 통째로 빠지므로, 숫자가 하나라도 있으면 싣는다.
        if base is None:
            if all(v is None for v in (unfilled, policy, extra, final)):
                continue
            base = 0
        note = clean(get(row, roles, "note")) or None
        specialty = clean(get(row, roles, "specialty")) or None
        if specialty in ("인턴", "레지던트"):
            specialty = None
        # 전문과목 명칭이 바뀐 경우 현재 명칭으로 맞춘다. 해마다 표가 달라 같은 과가 둘로 갈리지 않게 하기 위해서다.
        if specialty in RENAMED_SPECIALTIES:
            renamed_from = specialty
            specialty = RENAMED_SPECIALTIES[specialty]
            note = f"{note + ' · ' if note else ''}원문 표기 '{renamed_from}'"
        deferred = deferred or (note is not None and "사후정원" in note)

        effective_base = 0 if deferred else base
        if final is not None:
            total = final
        else:
            total = effective_base + (unfilled or 0) + (policy or 0) + (extra or 0) - (reduction or 0)
        records.append(
            {
                "hospitalRaw": hospital,
                "specialty": specialty if track == "레지던트" else None,
                "baseQuota": effective_base,
                "deferredQuota": base if deferred else None,
                "unfilledQuota": unfilled,
                "policyQuota": policy,
                "extraQuota": extra,
                "reductionQuota": reduction,
                "total": total,
                "flexible": note is not None and "탄력" in note and "불가" not in note,
                "note": note,
            }
        )
    return records


def main() -> int:
    if not os.path.isdir(SRC_DIR):
        print(f"  !! 폴더가 없습니다: {SRC_DIR}")
        print("  `npm run fetch:sources` 로 정원 PDF 를 먼저 받으세요.")
        return 1

    years: dict[int, dict] = {}
    for name in sorted(os.listdir(SRC_DIR)):
        m = re.fullmatch(r"(intern|resident)(\d{4})\.pdf", name)
        if not m:
            continue
        track = "인턴" if m.group(1) == "intern" else "레지던트"
        year = int(m.group(2))
        records = parse(os.path.join(SRC_DIR, name), track)
        bucket = years.setdefault(year, {"year": year, "interns": [], "residents": []})
        bucket["interns" if track == "인턴" else "residents"] = records
        total = sum(r["total"] for r in records)
        institutions = len({r["hospitalRaw"] for r in records})
        print(f"  {year} {track}: {institutions}개 기관 · {len(records)}건 · 정원 합계 {total:,}명")

    if not years:
        print(f"  !! 정원 PDF 를 찾지 못했습니다: {SRC_DIR}")
        return 1

    os.makedirs(OUT, exist_ok=True)
    doc = {
        "quotaKind": "정원",
        "term": "상반기",
        "source": (
            "대한병원협회 수련환경평가본부 「○○년도 전공의(인턴 및 레지던트 1년차) 정원 통보 및 "
            "정원 탄력운영 관련 안내」 공지 첨부"
        ),
        "years": [years[y] for y in sorted(years)],
    }
    path = os.path.join(OUT, "quota_by_year.json")
    json.dump(doc, io.open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  wrote {path} ({os.path.getsize(path) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

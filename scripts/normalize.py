# -*- coding: utf-8 -*-
"""기관명 정규화 — 검색·대조 전용.

정규화된 이름은 어디까지나 매칭 키이며, 화면에는 언제나 공식 명칭을 쓴다.
"""
from __future__ import annotations

import re

# 공식 명칭 앞에 붙는 법인격 표기. 기관을 구별하는 정보가 아니므로 대조 시 제거한다.
LEGAL_PREFIXES = [
    "학교법인", "재단법인", "의료법인", "사회복지법인", "특수법인", "사단법인",
    "공익법인", "지방의료원", "국립대학법인",
]
# 재단·학원 이름처럼 기관 식별에 쓰이지 않는 토큰.
FOUNDATION_TOKENS = [
    "고려중앙학원", "가톨릭학원", "아산사회복지재단", "울산공업학원", "건양교육재단",
    "성균관대학", "동은학원", "을지학원", "길의료재단", "명지의료재단", "성광의료재단",
    "안동의료재단", "예수병원유지재단", "대원교육재단", "가톨릭중앙의료원",
]
SUFFIX_NOISE = ["의과대학부속", "의과대학", "부속", "대학교", "대학", "학교"]


def normalize(name: str) -> str:
    """대조용 키: 공백·괄호·법인격 제거 후 압축한 문자열."""
    if not name:
        return ""
    s = str(name)
    s = re.sub(r"[()（）\[\]{}]", "", s)
    s = re.sub(r"[\s·ㆍ・,.'\"-]", "", s)
    for tok in LEGAL_PREFIXES + FOUNDATION_TOKENS:
        s = s.replace(tok, "")
    return s


def core(name: str) -> str:
    """더 공격적인 키: '○○대학교의과대학부속△△병원' → '○○△△병원'."""
    s = normalize(name)
    for tok in SUFFIX_NOISE:
        s = s.replace(tok, "")
    return s


def display_name(official: str) -> str:
    """지도 라벨·목록에 쓸 짧은 이름.

    법인격과 재단 이름을 걷어내되 공백은 살린다. 공식 명칭을 대신하지 않으며,
    상세 패널 제목에는 언제나 공식 명칭을 쓴다.
    """
    s = str(official)
    for tok in LEGAL_PREFIXES + FOUNDATION_TOKENS:
        s = s.replace(tok, " ")
    for tok in ("의과대학부속", "의과대학", "부속"):
        s = s.replace(tok, "")
    s = re.sub(r"\s+", " ", s).strip()
    # "○○병원(△△병원)" 처럼 괄호 안에 실제 통용명이 있는 경우 그쪽을 살린다.
    m = re.match(r"^(.*?)병원\s*\((.+병원)\)$", s)
    if m:
        s = f"{m.group(1)} {m.group(2)}".strip()
    return s or str(official)

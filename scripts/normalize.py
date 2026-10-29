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


# "(의)", "(재)", "(학)" 처럼 앞에 붙는 법인격 약칭.
SHORT_LEGAL = re.compile(r"^\s*\((?:의|재|학|사|복지|특|합)\)\s*")
# 뒤에 붙는 지역 구분자. "부민병원(부산)"·"부민병원(서울)" 처럼 **서로 다른 기관**을 가르는
# 표시이므로 기관 식별(normalize/core)에서는 절대 떼지 않는다. 심평원 명부와 이름을 맞출 때만
# match_key() 에서 떼어 낸다.
TRAILING_REGION = re.compile(
    r"\s*\((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|청주|용인|창원)\)\s*$"
)


def normalize(name: str) -> str:
    """대조용 키: 공백·괄호·법인격 제거 후 압축한 문자열."""
    if not name:
        return ""
    s = str(name)
    s = SHORT_LEGAL.sub("", s)
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


# "○○의료재단", "한국보훈복지의료공단" 처럼 기관 앞에 붙는 설립 주체 표기.
ORG_SUFFIX = r"(?:의료재단|복지재단|장학재단|유지재단|의료법인|사회복지법인|학교법인|재단법인|사단법인|의료공단|복지의료공단|의료원재단|교육재단|학원|의료원유지재단)"
ORG_TOKEN = re.compile(r"[가-힣A-Za-z]*" + ORG_SUFFIX)


def strip_org(name: str) -> str:
    """설립 주체 표기를 떼어 낸 이름. 대조 전용이며 표시에는 쓰지 않는다."""
    s = SHORT_LEGAL.sub("", str(name))
    s = TRAILING_REGION.sub("", s)
    prev = None
    while prev != s:
        prev = s
        s = ORG_TOKEN.sub(" ", s, count=1)
    return re.sub(r"\s+", " ", s).strip()


def match_key(name: str) -> str:
    """법인 표기와 뒤에 붙은 지역 표시까지 떼고 압축한 대조 키.

    심평원 명부의 이름과 맞추는 용도다. 지역 표시를 떼기 때문에 기관을 구별하는 데는 쓰면 안 된다.
    """
    return normalize(TRAILING_REGION.sub("", strip_org(name)))

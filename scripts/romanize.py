# -*- coding: utf-8 -*-
"""한글 → 로마자(국어의 로마자 표기법 음절 단위 근사).

기관 ID 슬러그를 만드는 용도다. 표기법의 자음동화·구개음화까지 구현하지는 않으므로
사람이 읽는 이름으로 쓰지 말고, 안정적인 식별자로만 쓴다.
"""
from __future__ import annotations

import re

CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo",
        "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "l", "l", "l", "l", "l", "l", "l",
        "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]


def romanize(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            idx = code - 0xAC00
            out.append(CHO[idx // 588] + JUNG[(idx % 588) // 28] + JONG[idx % 28])
        elif ch.isalnum():
            out.append(ch.lower())
        else:
            out.append("-")
    s = "".join(out)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def slug(prefix: str, name: str, taken: set[str] | None = None) -> str:
    base = f"{prefix}-{romanize(name)}"
    if taken is None:
        return base
    cand, n = base, 2
    while cand in taken:
        cand, n = f"{base}-{n}", n + 1
    taken.add(cand)
    return cand

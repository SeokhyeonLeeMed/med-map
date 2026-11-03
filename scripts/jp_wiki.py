# -*- coding: utf-8 -*-
"""일본 의대·병원의 설립(개설) 연도를 일본어 위키백과에서 모은다 → .cache/jp/wiki.json

- 병원: 정보상자의 「開設年月日」(없으면 「開設」「設立」).
- 의대: 단독 의과대학은 정보상자의 「創立年」「設置年」. 종합대학 의학부는 「沿革」 절의 첫 연도와 그 문장.
  沿革 첫 항목은 전신 학교의 연도일 수 있으므로 문장을 함께 남겨 화면에 보여 준다.
위키백과는 2차 자료다. 값은 '일부확인'으로 싣고 문서 주소를 출처로 남긴다(CC BY-SA 4.0, 사실 정보만 옮김).
API 는 초당 1건 이하로 부른다.
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".cache", "jp", "wiki.json")
API = "https://ja.wikipedia.org/w/api.php?"
H = {"User-Agent": "medmap-data-build/0.1 (https://github.com/SeokhyeonLeeMed/med-map)"}
LEGAL = re.compile(r"^(国立大学法人|公立大学法人|学校法人|国立研究開発法人|地方独立行政法人|公益財団法人|国立健康危機管理研究機構|北海道公立大学法人)\s*")


def wikitext(title: str) -> tuple[str, str] | None:
    u = API + urllib.parse.urlencode({"action": "parse", "page": title, "prop": "wikitext", "format": "json", "redirects": 1})
    for _ in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30))
            break
        except Exception:  # noqa: BLE001
            time.sleep(3)
    else:
        return None
    time.sleep(1.0)
    if "error" in r:
        return None
    return r["parse"]["title"], r["parse"]["wikitext"]["*"]


def clean(v: str) -> str:
    v = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", "", v, flags=re.S)
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v)
    v = re.sub(r"\{\{[^}]*\}\}", "", v)
    return re.sub(r"\s+", " ", v).strip()


def field(w: str, names: list[str]) -> str | None:
    for n in names:
        m = re.search(rf"^\|\s*{n}\s*=\s*(.+)$", w, re.M)
        if m and re.search(r"\d{4}", m.group(1)):
            return clean(m.group(1))
    return None


def first_history(w: str) -> str | None:
    m = re.search(r"^==+\s*(沿革|歴史)\s*==+\s*$", w, re.M)
    if not m:
        return None
    for line in w[m.end():].splitlines():
        if line.startswith("=="):
            break
        if re.search(r"(1[6-9]|20)\d{2}年", line):
            return clean(line.lstrip("*:;# "))[:160]
    return None


def first_medical_history(w: str) -> str | None:
    """대학 문서의 沿革·歴史 절에서 의학부(또는 그 전신)가 처음 나오는 항목."""
    for m in re.finditer(r"^==+\s*(沿革|歴史|年表)\s*==+\s*$", w, re.M):
        for line in w[m.end():].splitlines():
            if re.match(r"^==[^=]", line):
                break
            text = clean(line.lstrip("*:;# "))
            if re.search(r"(1[6-9]|20)\d{2}年", text) and re.search(r"医学部|医学専門|医学校|医科大学|医学類|医学群|医専", text):
                return text[:160]
    return None


def wikidata_official_url(title: str) -> str | None:
    """{{Official URL}} 처럼 위키데이터에서 끌어오는 경우: 문서의 위키데이터 항목 P856(공식 웹사이트)."""
    try:
        u = API + urllib.parse.urlencode({"action": "query", "prop": "pageprops", "titles": title, "redirects": 1, "format": "json"})
        r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30))
        qid = next(iter(r["query"]["pages"].values())).get("pageprops", {}).get("wikibase_item")
        time.sleep(1.0)
        if not qid:
            return None
        u = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "wbgetclaims", "entity": qid, "property": "P856", "format": "json"})
        c = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30))
        time.sleep(1.0)
        for claim in c.get("claims", {}).get("P856", []):
            v = claim["mainsnak"].get("datavalue", {}).get("value")
            if v:
                return v
    except Exception:  # noqa: BLE001
        return None
    return None


def year_of(s: str | None) -> int | None:
    m = re.search(r"((?:1[6-9]|20)\d{2})年", s or "")
    return int(m.group(1)) if m else None


def main() -> int:
    hosp = json.load(io.open(os.path.join(ROOT, "data", "jp", "hospitals.json"), encoding="utf-8"))["hospitals"]
    quota = json.load(io.open(os.path.join(ROOT, ".cache", "jp", "extracted.json"), encoding="utf-8"))["quota"]
    univs = [q["university"] for q in quota] + ["防衛医科大学校"]
    cache = json.load(io.open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"schools": {}, "hospitals": {}}

    for u in univs:
        if u in cache["schools"] and cache["schools"][u].get("year"):
            continue
        rec = {"title": None, "value": None, "year": None, "how": None}
        if u.endswith("医科大学") or u in ("防衛医科大学校", "産業医科大学", "自治医科大学"):
            got = wikitext(u)
            if got:
                v = field(got[1], ["創立年", "創立", "設置年", "設立年", "開学"])
                rec.update(title=got[0], value=v, year=year_of(v), how="정보상자 創立年·設置年")
        if rec["year"] is None:
            for t in (f"{u}医学部", f"{u}大学院医学系研究科・医学部", f"{u}大学院医学研究科・医学部"):
                got = wikitext(t)
                if got:
                    v = first_history(got[1])
                    if v:
                        rec.update(title=got[0], value=v, year=year_of(v), how="沿革 첫 항목")
                        break
        if rec["year"] is None:
            got = wikitext(u)
            if got:
                v = first_medical_history(got[1]) or (first_history(got[1]) if u == "防衛医科大学校" else None)
                if v:
                    rec.update(title=got[0], value=v, year=year_of(v), how="대학 문서 沿革의 의학부 관련 첫 항목")
        cache["schools"][u] = rec
        print(f"  {u}: {rec['year']} ({rec['how']}) {rec['title']}")

    # 대학 공식 누리집(의대 사이트 대신 종합대학 사이트를 쓴다). 정보상자의 ウェブサイト·公式サイト.
    cache.setdefault("univUrls", {})
    for u in univs:
        if cache["univUrls"].get(u):
            continue
        got = wikitext(u)
        url = None
        if got:
            for pat in (r"^\|\s*(?:ウェブサイト|公式サイト|URL|url|ホームページ)\s*=\s*(.+)$",):
                m = re.search(pat, got[1], re.M)
                if m:
                    mm = re.search(r"https?://[^\s|\]}]+", m.group(1)) or re.search(r"\{\{URL\|([^|}]+)", m.group(1))
                    if mm:
                        url = mm.group(1) if mm.lastindex else mm.group(0)
            if not url:
                mm = re.search(r"\{\{(?:Official website|公式サイト)\|(https?://[^|}]+)", got[1])
                url = mm.group(1) if mm else None
        if not url:
            url = wikidata_official_url(u)
        if url and not url.startswith("http"):
            url = "https://" + url
        cache["univUrls"][u] = url
        print(f"  {u}: {url}")

    for h in hosp:
        k = h["openDataId"]
        if k in cache["hospitals"]:
            continue
        rec = {"title": None, "value": None, "year": None}
        base = LEGAL.sub("", h["name"]).replace("　", "").replace(" ", "")
        for t in dict.fromkeys([base, h["name"]]):
            got = wikitext(t)
            if got:
                v = field(got[1], ["開設年月日", "開設", "開院", "設立年月日", "設立"])
                rec.update(title=got[0], value=v, year=year_of(v))
                break
        cache["hospitals"][k] = rec
        print(f"  {h['name']}: {rec['year']} {rec['title']}")
        with io.open(OUT, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=1)
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    s = sum(1 for v in cache["schools"].values() if v["year"])
    hh = sum(1 for v in cache["hospitals"].values() if v["year"])
    print(f"의대 {s}/{len(cache['schools'])} · 병원 {hh}/{len(cache['hospitals'])} 연도 확보 → {OUT}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

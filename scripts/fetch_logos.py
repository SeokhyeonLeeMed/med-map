# -*- coding: utf-8 -*-
"""로고가 없는 기관의 공식 누리집에서 로고 후보를 내려받는다.

- 대상은 logo-manifest.json 에 파일이 없는 기관 중 홈페이지 주소(심평원 신고값)가 있는 곳이다.
- robots.txt 가 막은 경로는 받지 않는다. 기관당 요청은 홈페이지 1~2회 + 이미지 몇 개로 제한한다.
- 후보는 .cache/logos_web/<기관ID>/ 에 저장하고 candidates.json 에 원래 주소를 남긴다.
  어느 후보를 쓸지는 사람이 눈으로 확인해 logo-manifest.json 에 적는다(자동 채택하지 않는다).

사용
  python scripts/fetch_logos.py              로고 없는 기관 전부
  python scripts/fetch_logos.py h-xxx h-yyy  지정한 기관만
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import urllib.robotparser
from urllib.parse import urljoin, urlparse

import requests
import urllib3
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "curation", "logo-manifest.json")
OUT = os.path.join(ROOT, ".cache", "logos_web")
UA = "medmap-logo-fetch/0.1 (+https://github.com/SeokhyeonLeeMed/med-map)"
IMG_EXT = (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico")

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
session = requests.Session()
session.headers.update({"User-Agent": UA, "Accept-Language": "ko"})
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str) -> bool:
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    if base not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            r = get(base + "/robots.txt", check_robots=False)
            rp.parse(r.text.splitlines() if r is not None and r.status_code == 200 else [])
        except Exception:
            rp.parse([])
        _robots[base] = rp
    rp = _robots[base]
    return rp is None or rp.can_fetch(UA, url)


def get(url: str, check_robots: bool = True):
    if check_robots and not allowed(url):
        print(f"    robots.txt 가 막음: {url}")
        return None
    for verify in (True, False):
        try:
            return session.get(url, timeout=15, verify=verify, allow_redirects=True)
        except requests.exceptions.SSLError:
            # 인증서가 만료된 공공기관 누리집이 많다. 공개 이미지만 받으므로 검증 없이 한 번 더 시도한다.
            continue
        except Exception as e:  # noqa: BLE001
            print(f"    요청 실패: {url} ({type(e).__name__})")
            return None
    return None


def decode(r) -> str:
    raw = r.content
    m = re.search(rb'charset=["\']?([A-Za-z0-9_-]+)', raw[:4000])
    for enc in ([m.group(1).decode()] if m else []) + ["utf-8", "cp949"]:
        try:
            return raw.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return raw.decode("utf-8", "replace")


def follow_page(url: str) -> tuple[str, str] | None:
    """홈페이지를 열고 meta refresh·프레임·단순 자바스크립트 이동을 한 번까지 따라간다."""
    for _ in range(3):
        r = get(url)
        if r is None or r.status_code >= 400:
            return None
        html = decode(r)
        url = r.url
        soup = BeautifulSoup(html, "html.parser")
        nxt = None
        meta = soup.find("meta", attrs={"http-equiv": re.compile("refresh", re.I)})
        if meta and "url=" in (meta.get("content") or "").lower():
            nxt = meta["content"].split("=", 1)[1].strip(" '\"")
        frame = soup.find(["frame", "iframe"], src=True)
        if not nxt and frame and len(soup.find_all("img")) < 3:
            nxt = frame["src"]
        js = re.search(r"location(?:\.href)?\s*=\s*['\"]([^'\"]+)['\"]", html)
        if not nxt and js and len(soup.find_all("img")) < 3:
            nxt = js.group(1)
        if not nxt:
            return url, html
        url = urljoin(url, nxt)
    return None


def candidates(url: str, html: str, names: list[str]) -> list[tuple[int, str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[tuple[int, str, str]] = []
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src")
        if not src or src.startswith("data:"):
            continue
        attrs = " ".join(
            [src, img.get("alt") or "", " ".join(img.get("class") or []), img.get("id") or ""]
            + [" ".join(p.get("class") or []) + " " + (p.get("id") or "") for p in img.parents if p.name][:4]
        ).lower()
        score = 0
        if "logo" in attrs or "로고" in attrs:
            score += 10
        if any(p.name in ("header", "h1") for p in img.parents):
            score += 4
        if "top" in attrs or "header" in attrs or "gnb" in attrs:
            score += 2
        alt = img.get("alt") or ""
        if any(n and n in alt for n in names):
            score += 3
        if re.search(r"foot|bottom|btm|banner|popup|sns|icon_|ico_|quick", attrs):
            score -= 6
        if score >= 8:
            out.append((score, urljoin(url, src), "img"))
    for sel, kind, sc in (
        ({"property": "og:image"}, "og:image", 3),
        ({"name": "og:image"}, "og:image", 3),
    ):
        m = soup.find("meta", attrs=sel)
        if m and m.get("content"):
            out.append((sc, urljoin(url, m["content"]), kind))
    for link in soup.find_all("link", rel=True, href=True):
        rel = " ".join(link["rel"]).lower()
        if "apple-touch-icon" in rel:
            out.append((2, urljoin(url, link["href"]), "apple-touch-icon"))
    seen, uniq = set(), []
    for c in sorted(out, key=lambda c: -c[0]):
        if c[1] not in seen:
            seen.add(c[1])
            uniq.append(c)
    return uniq[:3]


def save(iid: str, n: int, url: str) -> str | None:
    r = get(url)
    if r is None or r.status_code >= 400 or len(r.content) < 200:
        return None
    ctype = r.headers.get("content-type", "").lower()
    ext = os.path.splitext(urlparse(r.url).path)[1].lower()
    if "svg" in ctype:
        ext = ".svg"
    elif ext not in IMG_EXT:
        ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}.get(
            ctype.split(";")[0], ""
        )
    if not ext or "html" in ctype:
        return None
    d = os.path.join(OUT, iid)
    os.makedirs(d, exist_ok=True)
    name = f"cand{n}{ext}"
    with open(os.path.join(d, name), "wb") as f:
        f.write(r.content)
    return name


def main(argv: list[str]) -> int:
    manifest = json.load(io.open(MANIFEST, encoding="utf-8"))["entries"]
    insts = json.load(io.open(os.path.join(ROOT, "public", "data", "hospitals.json"), encoding="utf-8"))
    insts += json.load(io.open(os.path.join(ROOT, "public", "data", "medical-schools.json"), encoding="utf-8"))
    targets = [
        i for i in insts
        if (i["id"] in argv) or (not argv and not (manifest.get(i["id"]) or {}).get("fileName"))
    ]
    log_path = os.path.join(OUT, "candidates.json")
    log = json.load(io.open(log_path, encoding="utf-8")) if os.path.exists(log_path) else {}
    for inst in targets:
        home = inst.get("homepage") or inst.get("schoolUrl") or inst.get("universityUrl")
        if not home:
            continue
        if not home.startswith("http"):
            home = "http://" + home
        print(f"  {inst['id']} {inst['officialName']} — {home}")
        page = follow_page(home)
        if not page:
            log[inst["id"]] = {"homepage": home, "error": "홈페이지를 열지 못함"}
            continue
        url, html = page
        names = [inst.get("commonName") or "", inst["officialName"]]
        got = []
        for n, (score, src, kind) in enumerate(candidates(url, html, names)):
            fn = save(inst["id"], n, src)
            if fn:
                got.append({"file": fn, "url": src, "kind": kind, "score": score})
            time.sleep(0.3)
        log[inst["id"]] = {"homepage": url, "candidates": got, "retrievedOn": time.strftime("%Y-%m-%d")}
        print(f"    후보 {len(got)}개")
        time.sleep(0.5)
    os.makedirs(OUT, exist_ok=True)
    json.dump(log, io.open(log_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"→ {log_path}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))

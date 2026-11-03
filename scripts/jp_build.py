# -*- coding: utf-8 -*-
"""일본 데이터 조립 → public/data/jp.json

입력
  .cache/jp/extracted.json   jp_extract.py 결과(医療情報ネット·病床機能報告·特定機能病院·医学部定員)
  .cache/jp/wiki.json        jp_wiki.py 결과(설립·개설 연도, 위키백과)
  .cache/jp/osm_med.json     OSM 의학부·의과대학 지점(좌표 보조)
  data/jp/hospitals.json     지도에 올릴 병원과 대학·역할(사람이 확정)
  public/geo/jp_muni.json    시구정촌 경계(이름 조회용)

한국 데이터와 같은 모양으로 만들되 country: "JP" 와 jp 블록을 더한다. 시구정촌 코드는 한국 시군구
코드와 숫자가 겹칠 수 있어 'jp' 를 앞에 붙인다(예: jp13101). 수련 정보는 싣지 않는다(사용자 범위).
"""
from __future__ import annotations

import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jp_extract import name_key, nfkc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "jp")
OUT = os.path.join(ROOT, "public", "data", "jp.json")
OPEN_AS_OF = "2025-12-01"
STAFF_AS_OF = "2024-07-01"
VERIFIED, PARTIAL, UNVERIFIED = "확인됨", "일부확인", "미확인"

SOURCES = [
    {"id": "src-jp-iryou-opendata", "title": "医療情報ネット オープンデータ(2025年12月1日時点)", "publisher": "厚生労働省",
     "kind": "공공데이터", "url": "https://data.e-gov.go.jp/data/dataset/iryou_teikyouseido_mhlw", "license": "CC BY 4.0",
     "asOf": OPEN_AS_OF, "retrievedOn": "2026-11-03",
     "note": "병원 정식 명칭·소재지·좌표·홈페이지·허가 병상·진료과목. 병원이 직접 보고한 값을 그대로 싣는다."},
    {"id": "src-jp-byosho-r6", "title": "令和6年度 病床機能報告 公表データ 施設票", "publisher": "厚生労働省", "kind": "공공데이터",
     "url": "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/open_data_00018.html", "asOf": STAFF_AS_OF, "retrievedOn": "2026-11-03",
     "note": "施設全体의 의사·간호사·준간호사·약사·치과의사 수(상근·비상근, 2024-07-01 시점)와 설치 주체. 비상근은 상근 환산 인원이다."},
    {"id": "src-jp-tokutei-20261001", "title": "特定機能病院の承認状況(令和8年10月1日現在)", "publisher": "厚生労働省",
     "kind": "정부 공고", "url": "https://www.mhlw.go.jp/content/10800000/001596327.pdf", "asOf": "2026-10-01", "retrievedOn": "2026-11-03",
     "note": "특정기능병원 88곳(A 79·B 4·그 밖 5). 한국의 상급종합병원에 해당하는 제도이지만 지정 기준이 다르므로 같은 것으로 보지 않는다."},
    {"id": "src-jp-mext-quota-r8", "title": "大学別医学部入学定員等一覧(令和7年10月)", "publisher": "文部科学省", "kind": "정부 자료",
     "url": "https://www.mext.go.jp/content/20251016-mxt_koutou02-000045368_04.pdf", "asOf": "2025-10-16", "retrievedOn": "2026-11-03",
     "note": "81개 대학 의학부 입학정원. 令和8(2026)년도 값은 臨時定員 증원을 포함한 '계획'이다. 昭和医科大学·東京医科大学은 募集人員. 防衛医科大学校는 문부과학성 소관이 아니라 이 표에 없다."},
    {"id": "src-jp-n03", "title": "国土数値情報 行政区域データ N03(2025年1月1日)", "publisher": "国土交通省", "kind": "공공데이터",
     "url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html", "license": "国土数値情報 利用規約(CC BY 4.0 호환)",
     "asOf": "2025-01-01", "retrievedOn": "2026-11-03", "note": "도도부현·시구정촌 경계. 단순화해서 쓴다(build_geo_jp.py)."},
    {"id": "src-jp-wikipedia", "title": "ウィキペディア日本語版(各大学・病院の記事)", "publisher": "Wikimedia Foundation", "kind": "백과사전 (2차 자료)",
     "url": "https://ja.wikipedia.org/", "license": "CC BY-SA 4.0", "retrievedOn": "2026-11-03",
     "note": "설립·개설 연도만 옮겼다. 기관마다 문서 주소를 note 에 남긴다. 공식 자료로 확인하지 못한 값이라 '일부확인'으로 싣는다."},
    {"id": "src-gsi-geocode", "title": "国土地理院 住所検索API", "publisher": "国土地理院", "kind": "공공 API",
     "url": "https://msearch.gsi.go.jp/address-search/AddressSearch", "retrievedOn": "2026-11-03",
     "note": "医療情報ネット에 좌표가 없는 병원의 소재지 주소를 좌표로 바꾸는 데만 썼다."},
    {"id": "src-osm", "title": "OpenStreetMap (Overpass API)", "publisher": "OpenStreetMap contributors", "kind": "오픈 데이터",
     "url": "https://www.openstreetmap.org/", "license": "ODbL 1.0", "retrievedOn": "2026-11-03"},
]

# 대학 소재 의학부의 정식 조직명이 '医学部'가 아닌 곳
SCHOOL_UNIT = {"筑波大学": "医学群", "防衛医科大学校": "医学教育部"}
TYPE_OVERRIDE = {"防衛医科大学校": "국립(防衛省)"}
# 2024년 病床機能報告 이후 바뀐 이름(새 이름 → 옛 이름)
OLD_NAMES = [("昭和医科大学", "昭和大学"), ("東京科学大学病院", "東京医科歯科大学病院"),
             ("国立国際医療センター", "国立国際医療研究センター病院"), ("昭和医科大学病院附属東病院", "昭和大学病院附属東病院"),
             ("昭和医科大学烏山病院", "昭和大学附属烏山病院"), ("近畿大学病院", "近畿大学近畿大学病院")]
ROLE_LABEL = {"本院": "대학병원 본원(本院)", "分院": "대학병원 분원(分院)", "研究所附属": "대학 연구소 부속병원", "指定管理": "대학이 지정관리자로 운영"}


def read(*p):
    return json.load(io.open(os.path.join(*p), encoding="utf-8"))


def dist_km(a, b, c, d):
    return math.hypot((a - c) * 111, (b - d) * 111 * math.cos(math.radians(a)))


def slug(s: str) -> str:
    """일본어 이름 → 짧고 안정적인 ID 조각(이름이 같으면 늘 같은 값)."""
    import hashlib

    return hashlib.sha1(nfkc(s).encode("utf-8")).hexdigest()[:10]


def geocode(addr: str, cache: dict) -> tuple[float, float] | None:
    if addr in cache:
        return tuple(cache[addr]) if cache[addr] else None
    u = "https://msearch.gsi.go.jp/address-search/AddressSearch?" + urllib.parse.urlencode({"q": addr})
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "medmap-data-build/0.1"}), timeout=20))
        time.sleep(1)
        lon, lat = r[0]["geometry"]["coordinates"] if r else (None, None)
    except Exception:  # noqa: BLE001
        lon = lat = None
    cache[addr] = [lat, lon] if lat else None
    return (lat, lon) if lat else None


def era_to_iso(s: str) -> str | None:
    m = re.match(r"([HSR])(\d+)\.(\d+)\.(\d+)", s or "")
    if not m:
        return None
    base = {"S": 1925, "H": 1988, "R": 2018}[m.group(1)]
    return f"{base + int(m.group(2)):04d}-{int(m.group(3)):02d}-{int(m.group(4)):02d}"


def main() -> int:
    ex = read(CACHE, "extracted.json")
    wiki = read(CACHE, "wiki.json") if os.path.exists(os.path.join(CACHE, "wiki.json")) else {"schools": {}, "hospitals": {}}
    osm = read(CACHE, "osm_med.json") if os.path.exists(os.path.join(CACHE, "osm_med.json")) else []
    curated = read(ROOT, "data", "jp", "hospitals.json")["hospitals"]
    muni = {f["properties"]["code"]: f["properties"] for f in read(ROOT, "public", "geo", "jp_muni.json")["features"]}
    geo_cache_path = os.path.join(CACHE, "geocode.json")
    geo_cache = read(geo_cache_path) if os.path.exists(geo_cache_path) else {}
    logos = {}
    manifest = os.path.join(ROOT, "data", "curation", "logo-manifest.json")
    if os.path.exists(manifest):
        for iid, e in read(manifest)["entries"].items():
            if e.get("fileName") and e.get("copiedExt") and os.path.exists(os.path.join(ROOT, "public", "logos", f"{iid}{e['copiedExt']}")):
                logos[iid] = (f"logos/{iid}{e['copiedExt']}", e.get("background") == "dark")

    staff_by_key: dict[tuple, dict] = {}
    for s in ex["staff"]:
        staff_by_key.setdefault((name_key(s["name"]), s["muniCode"]), s)
    staff_by_name: dict[str, list] = {}
    for s in ex["staff"]:
        staff_by_name.setdefault(name_key(s["name"]), []).append(s)

    warnings: list[str] = []
    univ_names = [q["university"] for q in ex["quota"]] + ["防衛医科大学校"]
    quota = {q["university"]: q for q in ex["quota"]}

    # ---------------------------------------------------------- 병원
    hospitals, main_of = [], {}
    for c in curated:
        od = ex["opendata"][c["openDataId"]]
        hid = f"jp-h-{c['openDataId'].lower()}"
        code = od["muniCode"]
        lat, lon, csrc, cnote = od["lat"], od["lon"], "src-jp-iryou-opendata", None
        if not lat:
            got = geocode(od["address"], geo_cache)
            if got:
                lat, lon, csrc, cnote = got[0], got[1], "src-gsi-geocode", "医療情報ネット에 좌표가 없어 소재지 주소를 국토지리원 주소 검색으로 좌표화했다."
            else:
                warnings.append(f"좌표 미확인: {od['name']}")
        staff, staff_note = None, None
        for key in dict.fromkeys([name_key(od["name"])] + [name_key(od["name"]).replace(a, b) for a, b in OLD_NAMES]):
            staff = staff_by_key.get((key, code))
            if not staff and len(staff_by_name.get(key, [])) == 1:
                staff = staff_by_name[key][0]
            if staff:
                if key != name_key(od["name"]) or staff["muniCode"] != code:
                    staff_note = f"病床機能報告(2024-07-01)의 「{staff['name']}」 값이다(그 뒤 개칭·이전)."
                break
        if not staff:
            warnings.append(f"의료인 수 미확인(病床機能報告에 없음): {od['name']}")
        w = wiki["hospitals"].get(c["openDataId"]) or {}
        common = name_key(od["name"])
        rec = {
            "id": hid, "type": "hospital", "country": "JP",
            "officialName": od["name"], "commonName": common,
            "aliases": [a for a in dict.fromkeys([common, od["short"], od["kana"]]) if a and a != od["name"]],
            "coord": ({"lat": round(lat, 6), "lon": round(lon, 6), "sourceId": csrc, "status": VERIFIED, "precision": "exact",
                       "asOf": OPEN_AS_OF, **({"note": cnote} if cnote else {})} if lat else {"status": UNVERIFIED}),
            "sgg": f"jp{code}", "sggName": f"{muni.get(code, {}).get('pref', '')} {muni.get(code, {}).get('name', '')}".strip() or None,
            "subRegionId": f"jp-{code}", "macroRegionIds": [f"jp-{od['prefCode']}"],
            "address": {"value": od["address"], "postcode": None, "sourceId": "src-jp-iryou-opendata", "asOf": OPEN_AS_OF, "status": VERIFIED},
            "phone": None, "openedOn": None, "hiraKind": None,
            "beds": ([{"kind": "許可病床 합계", "value": od["bedTotal"], "sourceId": "src-jp-iryou-opendata", "asOf": OPEN_AS_OF,
                       "status": VERIFIED}] if od["bedTotal"] else []),
            "bedDetail": ({"total": od["bedTotal"], "breakdown": od["beds"], "sourceId": "src-jp-iryou-opendata", "asOf": OPEN_AS_OF,
                           "status": VERIFIED, "note": "医療法上の許可病床(一般·療養·精神·結核·感染症)이다."} if od["bedTotal"] else None),
            "designations": {"tertiary": None, "emergency": []},
            "universityRelations": [],
            "homepage": od["homepage"],
            "logo": logos.get(hid, (None, False))[0],
            **({"logoOnDark": True} if logos.get(hid, (None, False))[1] else {}),
            "history": {"status": UNVERIFIED},
            "centers": {"status": UNVERIFIED, "items": []},
            "departments": {"status": VERIFIED if od["departments"] else UNVERIFIED, "sourceId": "src-jp-iryou-opendata", "asOf": OPEN_AS_OF,
                            "items": [{"name": d, "code": "", "specialists": None} for d in od["departments"]],
                            "note": "医療情報ネット에 신고된 진료과목이다. 과목별 전문의 수는 공개 자료에 없다."},
            "staffing": ({"status": VERIFIED, "sourceId": "src-jp-byosho-r6", "asOf": STAFF_AS_OF, "metric": "施設全体 常勤",
                          "totalDoctors": round(staff["doctorsFull"]) if staff["doctorsFull"] is not None else None}
                         if staff else {"status": UNVERIFIED}),
            "jp": {
                "openDataId": c["openDataId"],
                "role": c.get("role"), "roleLabel": ROLE_LABEL.get(c.get("role")), "roleNote": c.get("roleNote"),
                "university": c.get("university"),
                "establisher": staff["establisher"] if staff else None,
                "tokutei": ({"category": c["tokutei"]["category"], "listedName": c["tokutei"]["listedName"],
                             "approvedOn": era_to_iso(c["tokutei"]["approvedOn"]), "sourceId": "src-jp-tokutei-20261001",
                             "asOf": "2026-10-01", "status": VERIFIED} if c.get("tokutei") else None),
                "founded": ({"value": str(w["year"]), "status": PARTIAL, "sourceId": "src-jp-wikipedia",
                             "note": f"위키백과 「{w['title']}」 開設年月日: {w['value']}"} if w.get("year") else {"status": UNVERIFIED}),
                "staff": ({k: (round(v, 1) if isinstance(v, float) else v) for k, v in staff.items()
                           if k not in ("name", "muniCode", "tokutei", "establisher")} if staff else None),
                "staffSourceId": "src-jp-byosho-r6" if staff else None, "staffAsOf": STAFF_AS_OF if staff else None,
                "staffNote": staff_note,
            },
        }
        hospitals.append(rec)
        if c.get("role") == "本院":
            main_of[c["university"]] = rec

    # ---------------------------------------------------------- 의대
    schools, relations = [], []
    for u in univ_names:
        unit = SCHOOL_UNIT.get(u, "医学部")
        sid = f"jp-s-{slug(u)}"
        main = main_of.get(u)
        q = quota.get(u)
        # 좌표: 본원 3 km 안의 OSM 의학부 지점 → 없으면 본원 좌표(근사)
        coord = {"status": UNVERIFIED}
        if main and main["coord"].get("lat"):
            mlat, mlon = main["coord"]["lat"], main["coord"]["lon"]
            cands = []
            for o in osm:
                n = o.get("name") or ""
                if u not in n or not re.search(r"医学部|医学群|医学科|医学系|大学$|大学校$|大学（医学部）|キャンパス", n):
                    continue
                if re.search(r"看護|保健|獣医|住宅|宿舎|寮|駐車|保育|ローソン|薬局|動物|グラウンド|体育", n):
                    continue
                dkm = dist_km(o["lat"], o["lon"], mlat, mlon)
                if dkm <= 3:
                    cands.append((0 if re.search(r"医学部|医学群", n) else 1, dkm, o))
            if cands:
                _, dkm, o = min(cands, key=lambda t: (t[0], t[1]))
                coord = {"lat": round(o["lat"], 6), "lon": round(o["lon"], 6), "sourceId": "src-osm", "status": VERIFIED,
                         "precision": "exact", "asOf": "2026-11-03", "note": f"OSM 「{o['name']}」({o['osm']})."}
            else:
                coord = {"lat": mlat, "lon": mlon, "sourceId": main["coord"]["sourceId"], "status": PARTIAL, "precision": "approximate",
                         "asOf": OPEN_AS_OF, "note": f"OSM 에서 의학부 지점을 찾지 못해 본원({main['officialName']}) 좌표를 썼다."}
        # 소재 시구정촌은 본원에서 가져온다(의학부는 본원과 같은 부지이거나 3 km 안이다).
        code = main["sgg"][2:] if main else None
        w = wiki["schools"].get(u) or {}
        founded = ({"value": str(w["year"]), "status": PARTIAL, "sourceId": "src-jp-wikipedia",
                    "note": f"위키백과 「{w['title']}」 {w['how']}: {w['value']}"} if w.get("year") else {"status": UNVERIFIED})
        quotas = []
        if q:
            quotas.append({"admissionYear": 2026, "kind": "入学定員(令和8年度 計画)", "value": q["r8Plan"], "sourceId": "src-jp-mext-quota-r8",
                           "asOf": "2025-10-16", "status": VERIFIED,
                           "note": f"増員前 {q['r8Base']} + 臨時定員 증원 {q['r8Increase']}." + (" 募集人員 기준." if q.get("note") else "")})
            quotas.append({"admissionYear": 2025, "kind": "入学定員(令和7年度)", "value": q["r7"], "sourceId": "src-jp-mext-quota-r8",
                           "asOf": "2025-10-16", "status": VERIFIED})
        else:
            warnings.append(f"입학정원 미확인: {u}")
        rec = {
            "id": sid, "type": "medicalSchool", "country": "JP",
            "officialName": f"{u}{unit}", "universityName": u, "schoolKind": unit,
            "aliases": [u, f"{u} {unit}"],
            "sgg": f"jp{code}" if code else None,
            "sggName": f"{muni.get(code, {}).get('pref', '')} {muni.get(code, {}).get('name', '')}".strip() if code else None,
            "subRegionId": f"jp-{code}" if code else None, "macroRegionIds": [f"jp-{code[:2]}"] if code else [],
            "coord": coord, "universityUrl": (wiki.get("univUrls") or {}).get(u), "schoolUrl": None,
            "founded": founded, "quota": quotas,
            "logo": logos.get(sid, (None, False))[0], **({"logoOnDark": True} if logos.get(sid, (None, False))[1] else {}),
            "sourceId": "src-jp-mext-quota-r8", "asOf": "2025-10-16",
            "jp": {"establishmentType": TYPE_OVERRIDE.get(u) or (q or {}).get("type")},
        }
        schools.append(rec)
        for h in hospitals:
            if h["jp"]["university"] != u:
                continue
            role = h["jp"]["role"]
            h["universityRelations"].append({"schoolId": sid, "universityName": u, "relationType": ROLE_LABEL[role]})
            relations.append({"fromId": sid, "fromType": "medicalSchool", "toId": h["id"], "toType": "hospital",
                              "relationType": ROLE_LABEL[role], "sourceId": "src-jp-iryou-opendata", "asOf": OPEN_AS_OF,
                              "status": VERIFIED, "note": h["jp"].get("roleNote") or "병원 정식 명칭에 대학명이 들어 있다."})

    # ---------------------------------------------------------- 병원끼리(같은 대학·같은 법인)
    networks = []
    by_univ: dict[str, list] = {}
    for h in hospitals:
        if h["jp"]["university"]:
            by_univ.setdefault(h["jp"]["university"], []).append(h["id"])
    for u, ids in by_univ.items():
        if len(ids) > 1:
            networks.append({"id": f"net-jp-{slug(u)}", "country": "JP", "name": f"{u} 대학병원",
                             "kind": "같은 대학 부속병원", "memberIds": ids, "sourceId": "src-jp-iryou-opendata", "status": VERIFIED,
                             "note": "같은 대학의 본원·분원이다. 병원 정식 명칭과 특정기능병원 승인 명부로 확인했다."})
    ncc = [h["id"] for h in hospitals if "国立がん研究センター" in h["officialName"]]
    if len(ncc) > 1:
        networks.append({"id": "net-jp-ncc", "country": "JP", "name": "国立がん研究センター", "kind": "같은 법인",
                         "memberIds": ncc, "sourceId": "src-jp-tokutei-20261001", "status": VERIFIED,
                         "note": "国立研究開発法人国立がん研究センター의 중앙병원과 동병원."})

    # ---------------------------------------------------------- 지역(도도부현 47 · 기관이 있는 시구정촌)
    prefs = {}
    for p in read(ROOT, "public", "geo", "jp_pref.json")["features"]:
        prefs[p["properties"]["prefCode"]] = p["properties"]["pref"]
    used = sorted({i["sgg"][2:] for i in hospitals + schools if i.get("sgg")})
    subs = []
    for n, code in enumerate(used, start=1):
        m = muni.get(code)
        if not m:
            warnings.append(f"시구정촌 코드가 경계에 없음: {code}")
            continue
        subs.append({"id": f"jp-{code}", "order": 1000 + n, "name": m["name"], "macroRegions": [f"jp-{code[:2]}"], "sgg": [f"jp{code}"],
                     "note": f"{m['pref']} {m['name']}"})
    macros = [{"id": f"jp-{pc}", "name": name, "sidocd": f"jp{pc}", "officialName": name,
               "subRegions": [s["id"] for s in subs if s["macroRegions"][0] == f"jp-{pc}"]}
              for pc, name in sorted(prefs.items())]

    for s in schools:
        if s["coord"].get("lat") and s["subRegionId"] is None:
            warnings.append(f"의대 소재 시구정촌 미확인: {s['officialName']}")

    doc = {
        "meta": {"country": "JP", "asOf": OPEN_AS_OF,
                 "note": "일본은 수련 정보를 싣지 않는다. 병원은 대학병원(본원·분원)과 特定機能病院(2026-10-01)만 수록한다.",
                 "counts": {"hospitals": len(hospitals), "schools": len(schools), "relations": len(relations), "networks": len(networks)}},
        "hospitals": hospitals, "schools": schools, "relations": relations, "networks": networks,
        "regions": {"meta": {"country": "JP", "note": "대권역=도도부현 47, 세부 지역=기관이 있는 시구정촌. 경계는 国土数値情報 N03(2025-01-01)."},
                    "macroRegions": macros, "subRegions": subs},
        "sources": SOURCES,
        "warnings": warnings,
    }
    json.dump(geo_cache, io.open(geo_cache_path, "w", encoding="utf-8"), ensure_ascii=False)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  병원 {len(hospitals)} · 의대 {len(schools)} · 관계 {len(relations)} · 계열 {len(networks)} · 시구정촌 {len(subs)}")
    print(f"  의료인 수 {sum(1 for h in hospitals if h['jp']['staff'])}/{len(hospitals)} · 개설 연도 "
          f"{sum(1 for h in hospitals if h['jp']['founded'].get('value'))}/{len(hospitals)} · 의대 설립 연도 "
          f"{sum(1 for s in schools if s['founded'].get('value'))}/{len(schools)} · 의대 좌표 정확 "
          f"{sum(1 for s in schools if s['coord'].get('precision') == 'exact')}/{len(schools)}")
    for w in warnings:
        print("  !", w)
    print(f"→ {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""베이비페어·패밀리세일 오프라인 행사 수집기 (지시서 scratchpad/ORDER_BEFE_FAMILY_SALE_COLLECTOR.md, 2026-11-12)

원칙: 개인 블로그·카페 글은 읽지 않는다. 읽는 곳은 두 종류뿐이다.
  ① 전시장 공식 행사 일정 13곳(코엑스·킨텍스·세텍·엑스코·수원메쎄·송도·오스코·창원 CECO·대전 DCC·수원컨벤션센터·울산 UECO·김대중·구미코) + 주최사 공식 일정 3곳(코베·하이베이비키즈페어·베페)
     · 벡스코는 robots.txt 가 전체 금지(Disallow: /)라 읽지 않는다. 금지한 사이트는 자동으로 읽지 않는다(규칙 0-DS).
  ② 언론사 보도 — 네이버 뉴스 검색 「공식 API」(openapi.naver.com/v1/search/news.json)
     · search.naver.com·news.google.com 화면은 robots.txt 가 수집을 금지해 긁지 않는다. 그래서 API 열쇠가 있어야만 돈다:
       환경변수 NAVER_CLIENT_ID · NAVER_CLIENT_SECRET (네이버 개발자센터 무료 발급 → 깃허브 저장소 비밀값). 없으면 이 갈래는 건너뛴다.
     · 기사에서 날짜를 확실히 읽은 것만 싣는다(「11월 20~23일」「11.20(목)~23(일)」 꼴). 못 읽으면 싣지 않는다 — 날짜를 지어내지 않는다(규칙 0-K).

출력: data/offline_sales.json  { updatedAt, sources{…}, items[…] }
  항목: id · title · category(베이비페어|패밀리세일) · startDate · endDate · location · brand · benefits · link · newsUrl · preRegister · source(hall|news) · updatedAt
  중복: (행사명 정규화 + 시작일 + 장소 머리) 해시가 같으면 같은 행사 — 값만 갱신한다. 끝난 지 7일 넘은 행사는 지운다.
  전시장 하나가 실패해도 그 전시장의 기존 항목은 지우지 않는다(잠깐의 장애로 일정이 사라지지 않게).

실행: python tools/daily/befe_sale_collector.py            (수집 → data/offline_sales.json 갱신)
      python tools/daily/befe_sale_collector.py --dry      (파일을 쓰지 않고 결과만 출력)
주기: 깃허브 Actions .github/workflows/befe_sale_auto.yml 매일 06:00 KST. 서버에서 돌아 PC 가 꺼져도 돈다. AI 호출·DB 호출 없음.
예절: 사이트마다 요청 사이 2초 이상, 하루 한 번, 한 사이트 10번 안팎. UA 에 우리 이름과 주소를 밝힌다.
"""
import os, re, sys, json, time, html, hashlib, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta, date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'offline_sales.json')
UA = 'Mozilla/5.0 (compatible; MomcalBot/1.0; +https://momcalendar.com)'
KST = timezone(timedelta(hours=9))
TODAY = datetime.now(KST).date()
DRY = '--dry' in sys.argv
# 행사 이름에 이 낱말이 있어야 베이비페어로 본다. 뒤의 낱말이 있으면 박람회가 아니다(체험전·회의·면접 등)
BABY_RE = re.compile(r'베이비\s*페어|베이비\s*&?\s*키즈\s*페어|베페|유아교육전|임신\s*출산|출산\s*육아|육아\s*박람회|맘\s*앤\s*베이비|맘앤베이비|베이비\s*엑스포|유아용품|키즈\s*페어')
NOT_FAIR_RE = re.compile(r'면접|상담소|세미나|설명회|체험\s*키즈월드|키즈월드|콘서트|뮤지컬|공연|시험|채용')
_last = {}


def get(url, data=None, headers=None, timeout=40):
    """예의 바르게 가져온다 — 같은 사이트는 2초 이상 띄운다."""
    host = urllib.parse.urlsplit(url).hostname or ''
    wait = 2.2 - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    h = {'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h)
    try:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
        except urllib.error.URLError as e:
            if 'HANDSHAKE_FAILURE' not in str(e) and 'DH_KEY_TOO_SMALL' not in str(e):
                raise
            # 오래된 암호 묶음만 받는 서버(송도컨벤시아) — 인증서 검증은 그대로 두고 암호 수준만 한 단계 낮춰 다시 건다
            import ssl
            ctx = ssl.create_default_context()
            ctx.set_ciphers('DEFAULT:@SECLEVEL=1')
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                raw = r.read()
    finally:
        _last[host] = time.time()
    for enc in ('utf-8', 'euc-kr', 'cp949'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


def clean(s):
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s or '')).replace('\xa0', ' ').replace('<EndAnd>', '&')
    return re.sub(r'\s+', ' ', s).strip()


def ymd(s):
    m = re.search(r'(20\d{2})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})', s or '')
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def is_fair(title):
    return bool(BABY_RE.search(title)) and not NOT_FAIR_RE.search(title)


def norm_title(t):
    t = re.sub(r'제?\s*\d+\s*회', '', t)
    t = re.sub(r'20\d{2}', '', t)
    return re.sub(r'[^0-9A-Za-z가-힣]+', '', t).lower()


def make_id(title, start, loc):
    key = norm_title(title) + '|' + (start or '') + '|' + re.sub(r'[^0-9A-Za-z가-힣]+', '', (loc or ''))[:6]
    return hashlib.sha1(key.encode('utf-8')).hexdigest()[:12]


def item(title, start, end, venue, hall='', brand='', link='', detail='', benefits='', pre=False, source='hall', category='베이비페어'):
    loc = (venue + (' ' + hall if hall else '')).strip()
    return {'id': make_id(title, start, venue), 'title': title, 'category': category, 'startDate': start, 'endDate': end or start,
            'location': loc, 'brand': brand, 'benefits': benefits, 'link': link, 'newsUrl': detail, 'preRegister': bool(pre), 'source': source}


# ───────────────────────── 전시장 공식 일정 ─────────────────────────
def hall_coex():
    out, page, last = [], 1, 1
    d1, d2 = TODAY.strftime('%Y.%m.%d'), (TODAY + timedelta(days=400)).strftime('%Y.%m.%d')
    while page <= last and page <= 8:
        t = get('https://www.coex.co.kr/event/full-schedules/?search_keyword=&search_type=&search_start_date=%s&search_end_date=%s&search_dept=&list_type=LIST&var_page=%d' % (d1, d2, page))
        last = max([int(x) for x in re.findall(r'var_page=(\d+)', t)] or [1])
        for li in re.findall(r"<li class='BlogPost-item'>(.*?)</li>", t, re.S):
            m = re.search(r"<a href='([^']+)'.*?-tit'>(.*?)</h4>.*?-date'>(.*?)</div>.*?-hall'>(.*?)</div>", li, re.S)
            if not m:
                continue
            title = clean(m.group(2))
            if not is_fair(title):
                continue
            ds = re.findall(r'20\d{2}\.\d{1,2}\.\d{1,2}', m.group(3))
            if not ds:
                continue
            detail = m.group(1).split('?')[0]
            brand = link = ''
            try:
                dt = get(detail)
                b = re.search(r"EventDetailBoxBodyTitle'>\s*주최\s*</div>.*?EventDetailBoxBodyText-txt'>(.*?)</p>", dt, re.S)
                brand = clean(b.group(1)) if b else ''
                l = re.search(r'<a href="(https?://[^"]+)"[^>]*class="EventDetailThumbLink-link url"', dt)
                link = l.group(1) if l else ''
            except Exception:
                pass
            out.append(item(title, ymd(ds[0]), ymd(ds[-1]), '서울 코엑스', clean(m.group(4)), brand, link, detail))
        page += 1
    return out


def hall_kintex():
    out = []
    t = get('https://www.kintex.com/web/ko/event/list.do?pageIndex=1&pageUnit=300&searchKeyword=&searchType=&searchStartDt=%s&searchEndDt=%s' % (TODAY.isoformat(), (TODAY + timedelta(days=400)).isoformat()))
    for seq, sub, hall, dts in re.findall(r"fnView\('\./view\.do',\s*(\d+)\).*?item-subject\">(.*?)</div>.*?item-client\">(.*?)</div>.*?item-date\">(.*?)</div>", t, re.S):
        title = clean(sub)
        if not is_fair(title):
            continue
        ds = re.findall(r'20\d{2}\.\d{1,2}\.\d{1,2}', dts)
        if not ds:
            continue
        detail = 'https://www.kintex.com/web/ko/event/view.do?seq=' + seq
        brand = link = ''
        try:
            dt = get(detail)
            b = re.search(r'<div class="title">\s*주\s*최\s*</div>\s*<div class="info">(.*?)</div>', dt, re.S)
            brand = clean(b.group(1)) if b else ''
            l = re.search(r'홈페이지</th>.*?href="(https?://[^"]+)"', dt, re.S)
            link = l.group(1) if l else ''
        except Exception:
            pass
        out.append(item(title, ymd(ds[0]), ymd(ds[-1]), '일산 킨텍스', clean(hall), brand, link, detail))
    return out


def hall_setec():
    out, page, last = [], 1, 1
    while page <= last and page <= 6:
        t = get('https://www.setec.or.kr/front/schedule/list.do?pageIndex=%d' % page)
        pg = re.search(r'<div class="paging">(.*?)</div>', t, re.S)
        last = max([int(x) for x in re.findall(r'pageIndex=(\d+)', pg.group(1) if pg else '')] or [1])
        for idx, name, s, e, place in re.findall(r"fn_view\('(\d+)'\).*?<strong>(.*?)</strong>.*?기간 : ([\d-]+) ~ ([\d-]+)</li>\s*<li>장소 : (.*?)</li>", t, re.S):
            title = clean(name)
            if not is_fair(title):
                continue
            detail = 'https://www.setec.or.kr/front/schedule/view.do?sIdx=' + idx
            brand = link = ''
            try:
                dt = get(detail)
                b = re.search(r'<strong class="tit">주최</strong>\s*<p>(.*?)</p>', dt, re.S)
                brand = clean(b.group(1)) if b else ''
                l = re.search(r'<strong class="tit">홈페이지</strong>\s*<p>\s*<a href="(https?://[^"]+)"', dt, re.S)
                link = l.group(1) if l else ''
            except Exception:
                pass
            out.append(item(title, ymd(s), ymd(e), '서울 세텍(SETEC)', clean(place), brand, link, detail))
        page += 1
    return out


def hall_exco():
    out = []
    pages = [get('https://www.exco.co.kr/schedule/schedule_list.html')]
    if TODAY.month >= 10:   # 연말에는 다음 해 표도 본다
        try:
            pages.append(get('https://www.exco.co.kr/schedule/schedule_list.html', data=('syear=%d&ex_cate=' % (TODAY.year + 1)).encode(), headers={'Content-Type': 'application/x-www-form-urlencoded'}))
        except Exception:
            pass
    for t in pages:
        for no, kind, name, host, tel, s, e in re.findall(r'<td class="no_border">(\d+)</td>\s*<td[^>]*>\s*(.*?)\s*</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(\d{4}-\d{2}-\d{2})~.*?(\d{4}-\d{2}-\d{2})</td>', t, re.S):
            title = clean(name)
            if clean(kind) != '전시회' or not is_fair(title):
                continue
            out.append(item(title, s, e, '대구 엑스코', '', clean(host), '', 'https://www.exco.co.kr/schedule/schedule_list.html'))
    return out


def hall_suwon():
    out = []
    t = get('https://suwonmesse.com/event_schedule/event_list/?mod=list&pageid=1&target=title&keyword=&kboard_option_start_date=%s&kboard_option_end_date=%s' % (TODAY.replace(day=1).isoformat(), (TODAY + timedelta(days=400)).isoformat()), timeout=90)
    for href, uid, name, dts in re.findall(r'<a href="([^"]+uid=(\d+)[^"]*)" class="event-content">.*?event-name">(.*?)</div>\s*<div class="event-date">(.*?)</div>', t, re.S):
        title = clean(name)
        if not is_fair(title):
            continue
        ds = re.findall(r'20\d{2}-\d{2}-\d{2}', dts)
        if not ds:
            continue
        detail = html.unescape(href)
        hall = brand = link = ''
        try:
            dt = get(detail, timeout=90)
            kv = {clean(k).rstrip(' :'): v for k, v in re.findall(r'document-option-key">(.*?)</span>\s*<span class="document-option-value">(.*?)</span>', dt, re.S)}
            hall = clean(kv.get('개최 장소', ''))
            brand = clean(kv.get('주최', ''))
            l = re.search(r'href="(https?://[^"]+)"', kv.get('관련 웹사이트 URL', ''))
            link = l.group(1) if l else ''
        except Exception:
            pass
        out.append(item(title, ds[0], ds[-1], '수원메쎄', hall, brand, link, detail))
    return out


def hall_songdo():
    out = []
    j = json.loads(get('https://songdoconvensia.visitincheon.or.kr/schedule/list.do?startDt=%s&endDt=%s&type=1,2,3,4' % (TODAY.replace(day=1).strftime('%Y%m%d'), (TODAY + timedelta(days=400)).strftime('%Y%m%d'))))
    for r in j if isinstance(j, list) else []:
        title = clean(r.get('title') or '')
        if not is_fair(title) or not r.get('startDt'):
            continue
        detail = 'https://songdoconvensia.visitincheon.or.kr/page/exhibit-schedule.do?ac=view&addNo=%s&eventCd=%s' % (r.get('addNo'), r.get('eventCd'))
        brand = clean(r.get('organizerCompHome') or '')
        link = ''
        try:
            dt = get(detail)
            b = re.search(r'<li><span>주최</span>(.*?)</li>', dt, re.S)
            brand = clean(b.group(1)) if b else brand
            l = re.search(r'id="schedule_detail_homepage" href="(https?://[^"]+)"', dt)
            link = l.group(1) if l else ''
        except Exception:
            pass
        out.append(item(title, ymd(r['startDt']), ymd(r.get('endDt') or r['startDt']), '인천 송도컨벤시아', clean(r.get('place') or ''), brand, link, detail))
    return out


# ── 2026-11-12 추가(사장님 「전시장 저기 말고도 많을 것 같은데」): 지방 전시장 6곳 + 주최사 공식 일정 3곳 ──
#   조사에서 뺀 곳: aT센터(robots 가 일정 경로 금지) · 여수엑스포컨벤션센터(봇 확인 화면) · 맘스홀릭 베이비페어(앱 화면, 글자 없음) · 벡스코(robots 전체 금지 — 단 코베 공식 일정에 벡스코 회차가 실린다)
#   군산 GSCO·경주 HICO·제주 ICC 는 읽을 수는 있으나 베이비페어가 드물어 붙이지 않았다(필요하면 같은 꼴로 더한다).
WD = '월화수목금토일'


def md_year(y, m, d, wd=None):
    """달·일만 적힌 일정에 해를 붙인다. 요일이 같이 적혀 있으면 요일이 맞는 해(올해·내년)만 받는다 — 안 맞으면 None(지어내지 않는다)."""
    for yy in ([y] if wd is None else [y, y + 1, y - 1]):
        try:
            dt = date(yy, m, d)
        except ValueError:
            continue
        if wd is None or WD[dt.weekday()] == wd:
            return dt
    return None


def hall_osco():
    out = []
    t = get('https://osco.or.kr/event_schedule/event_list/?kboard_option_start_date=%s&kboard_option_end_date=%s' % ((TODAY - timedelta(days=7)).isoformat(), (TODAY + timedelta(days=300)).isoformat()), timeout=90)
    for href, uid, name, s, e in re.findall(r'<a href="([^"]+uid=(\d+)&(?:amp;)?mod=document)" class="event-content">.*?<div class="event-name">(.*?)</div>\s*<div class="event-date">(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})</div>', t, re.S):
        title = clean(name)
        if not is_fair(title):
            continue
        detail, hall = html.unescape(href), ''
        try:
            dt = get(detail, timeout=90)
            kv = {clean(k).rstrip(' :'): v for k, v in re.findall(r'document-option-key">(.*?)</span>\s*<span class="document-option-value">(.*?)</span>', dt, re.S)}
            hall = clean(kv.get('개최 장소', ''))
        except Exception:
            pass
        out.append(item(title, s, e, '청주 오스코', hall, '', '', detail))
    return out


def hall_ceco():
    out = []
    req_url = 'https://www.ceco.co.kr/bbx/board.php?bx_table=01_01&sca=%s&page=' % urllib.parse.quote('전시회')
    for page in (1, 2):
        t = get(req_url + str(page))
        rows = re.findall(r'<li class="gall_li.*?<a href="([^"]+wr_id=(\d+)[^"]*)">.*?<div class="bo_tit">\s*(.*?)\s*</div>\s*<div class="gall_ev_date">(\d{4}-\d{2}-\d{2})(?: ~ (\d{4}-\d{2}-\d{2}))?</div>\s*(?:<div class="gall_place">(.*?)</div>)?', t, re.S)
        for href, wid, name, s, e, place in rows:
            title = clean(name)
            if is_fair(title):
                out.append(item(title, s, e or s, '창원 CECO', clean(place), '', '', 'https://www.ceco.co.kr/bbx/board.php?bx_table=01_01&wr_id=' + wid))
        if len(rows) < 10:
            break
    return out


def hall_dcc():
    out, seen = [], set()
    for i in range(0, 5):
        mth = (TODAY.replace(day=1) + timedelta(days=31 * i)).replace(day=1)
        j = json.loads(get('https://www.dcckorea.or.kr/event/list.json?searchMonth=%s&searchCategory=EX' % mth.isoformat()))
        for r in j.get('eventList', []):
            if r.get('id') in seen or not is_fair(clean(r.get('eventName') or '')):
                continue
            seen.add(r.get('id'))
            try:
                s = datetime.fromtimestamp(r['startDt'] / 1000, KST).date()
                e = datetime.fromtimestamp(r['endDt'] / 1000, KST).date()
            except Exception:
                continue
            if (e - s).days > 4:
                continue   # 대관 기간(준비일 포함)으로 보이는 긴 일정은 싣지 않는다 — 실제 개막일을 모른다
            out.append(item(clean(r['eventName']), s.isoformat(), e.isoformat(), '대전 DCC', clean(r.get('eventPlace') or ''), clean(r.get('eventOrg') or ''), '', 'https://www.dcckorea.or.kr/event/view.do?id=%s&menuKey=178' % r['id']))
    return out


def hall_scc():
    out = []
    t = get('https://www.scc.or.kr/events-exhibition/')
    for m in re.finditer(r'<article class="w-grid-item[^"]*" data-id="(\d+)">(.*?)</article>', t, re.S):
        a = m.group(2)
        h = re.search(r'<h2 class="w-post-elm post_title[^"]*"><a href="([^"]+)">(.*?)</a></h2>', a, re.S)
        ds = re.findall(r'\d{4}-\d{2}-\d{2}', (re.search(r'usg_html_1[^"]*">(.*?)</div>', a, re.S) or [0, ''])[1])
        if not h or not ds or not is_fair(clean(h.group(2))):
            continue
        org = re.search(r'주최/주관 : </span>(.*?)</div>', a, re.S)
        out.append(item(clean(h.group(2)), ds[0], ds[-1], '수원 컨벤션센터', '', clean(org.group(1)) if org else '', '', h.group(1)))
    return out


def hall_ueco():
    out = []
    j = json.loads(get('https://www.ueco.or.kr/api/v1/events/list?evKinds=A&evBgnEventStart=%s&sort=evBgnEvent,ASC&page=0&size=100' % (TODAY - timedelta(days=7)).isoformat()))
    for r in j.get('content', []):
        title = clean(r.get('evSubject') or '')
        if is_fair(title) and r.get('evBgnEvent'):
            out.append(item(title, ymd(r['evBgnEvent']), ymd(r.get('evEndEvent') or r['evBgnEvent']), '울산 UECO', clean(r.get('evAdr') or ''), '', '', 'https://www.ueco.or.kr/schedule/full/%s' % r.get('evId')))
    return out


def hall_kdj():
    out = []
    t = get('https://kdjcenter.gjto.or.kr/events/gallery')
    for idx, href, name, kind, place, s, e in re.findall(r'<li class="eventThumb" idx="(\d+)">\s*<a href="(/events/\d+/view)">.*?<h4>\s*(.*?)\s*</h4>\s*<span class="\w+">(\w)</span>.*?<div class="bottom">\s*<span>(.*?)</span>\s*<strong>(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})</strong>', t, re.S):
        title = clean(name)
        if is_fair(title):
            out.append(item(title, s, e, '광주 김대중컨벤션센터', clean(place), '', '', 'https://kdjcenter.gjto.or.kr' + href))
    return out


def hall_gumico():
    out = []
    for i in range(0, 3):
        mth = (TODAY.replace(day=1) + timedelta(days=31 * i)).replace(day=1)
        j = json.loads(get('https://gumico.com/api/event/month?month=%s' % mth.strftime('%Y-%m')))
        for r in j if isinstance(j, list) else []:
            title = clean(r.get('title') or '')
            if not is_fair(title) or not r.get('startAt'):
                continue
            link = next((x.get('url') for x in (r.get('information') or []) if x.get('title') == '홈페이지' and str(x.get('url') or '').startswith('http')), '')
            out.append(item(title, r['startAt'][:10], (r.get('endAt') or r['startAt'])[:10], '구미 구미코', clean(r.get('location') or ''), '', link, 'https://gumico.com/'))
    return out


# 주최사 공식 일정(전국 순회) — 전시장 일정과 같은 행사(같은 장소·같은 시작일)는 전시장 쪽을 남긴다
COBE_CITY = {'코엑스': '서울', '킨텍스': '일산', '수원메쎄': '수원', '수원컨벤션센터': '수원', '벡스코': '부산', '송도컨벤시아': '인천', '오스코': '청주', '엑스코': '대구', '대전컨벤션센터': '대전', 'DCC': '대전'}


def org_cobe():
    out = []
    t = get('https://www.cobe.co.kr/')
    y = re.search(r'alt="(\d{4}) 코베 베이비페어', t)
    if not y:
        return out
    y = int(y.group(1))
    for href, ttl, body in re.findall(r'<a href="(/__\w+\.php)" title="([^"]+)">(.*?)</a>', t, re.S):
        p = re.search(r'<p class="place point_color">([^<]+)', body)
        tm = re.search(r'<p class="time">(.*?)$', body, re.S)
        if not p or not tm:
            continue
        place = clean(p.group(1))
        city = next((c for k, c in COBE_CITY.items() if k in place), '')
        name = '대구 베이비&키즈페어' if '엑스코' in place else '코베 베이비페어'
        for m1, d1, w1, m2, d2, w2 in re.findall(r'(\d{2})\.(\d{2})\(([월화수목금토일])\)\s*~\s*(\d{2})\.(\d{2})\(([월화수목금토일])\)', tm.group(1)):
            s, e = md_year(y, int(m1), int(d1), w1), md_year(y, int(m2), int(d2), w2)
            if not s or not e or e < s or s.year != y:
                continue   # 요일이 그해와 안 맞으면 싣지 않는다
            out.append(item(name, s.isoformat(), e.isoformat(), (city + ' ' + place).strip(), '', '메쎄이상', 'https://www.cobe.co.kr' + href, 'https://www.cobe.co.kr/', '', True, 'org'))
    return out


def org_hifair():
    out = []
    t = get('https://www.hifair.co.kr/')
    for href, name, yy, m1, d1, w1, m2, d2, w2, place in re.findall(r'<a href="(/page/\w+_main)"[^>]*>([^<]*하이베이비키즈페어)\s*<span>\s*(?:(\d{2})년 )?(\d{1,2})월 (\d{1,2})일\(([월화수목금토일])\)~(?:(\d{1,2})월 )?(\d{1,2})일\(([월화수목금토일])\)\s*([^<]*)</span>', t):
        y = 2000 + int(yy) if yy else TODAY.year
        s = md_year(y, int(m1), int(d1), w1)
        e = md_year(s.year, int(m2 or m1), int(d2), w2) if s else None
        if not s or not e or e < s or (yy and s.year != y):
            continue
        title = clean(name)
        out.append(item(title, s.isoformat(), e.isoformat(), (clean(place) if clean(place).startswith(title.split()[0]) else title.split()[0] + ' ' + clean(place)).strip(), '', '하이엑스', 'https://www.hifair.co.kr' + href, 'https://www.hifair.co.kr/', '', True, 'org'))
    return out


def org_befe():
    out = []
    t = get('https://www.befe.co.kr/')
    m = re.search(r'<meta name="description" content="(\d{4})\.(\d{1,2})\.(\d{1,2})\(([^)])\)-(\d{1,2})\.(\d{1,2})\(([^)])\)\s+(.+?)\s+(\S+ 베페 베이비페어)\.', t)
    if m:
        y = int(m.group(1))
        s, e = md_year(y, int(m.group(2)), int(m.group(3)), m.group(4)), md_year(y, int(m.group(5)), int(m.group(6)), m.group(7))
        if s and e and s.year == y and e >= s:
            place = clean(m.group(8))
            out.append(item(clean(m.group(9)), s.isoformat(), e.isoformat(), place if place.split()[0] in ('서울', '마곡') and ' ' in place and place.split()[0] != '마곡' else '서울 ' + place, '', '베페', 'https://www.befe.co.kr/', 'https://www.befe.co.kr/exhibition', '', True, 'org'))
    return out


HALLS = [('coex', '서울 코엑스', hall_coex), ('kintex', '일산 킨텍스', hall_kintex), ('setec', '서울 세텍(SETEC)', hall_setec),
         ('exco', '대구 엑스코', hall_exco), ('suwon', '수원메쎄', hall_suwon), ('songdo', '인천 송도컨벤시아', hall_songdo),
         ('osco', '청주 오스코', hall_osco), ('ceco', '창원 CECO', hall_ceco), ('dcc', '대전 DCC', hall_dcc), ('scc', '수원 컨벤션센터', hall_scc),
         ('ueco', '울산 UECO', hall_ueco), ('kdj', '광주 김대중컨벤션센터', hall_kdj), ('gumico', '구미 구미코', hall_gumico),
         ('cobe', '', org_cobe), ('hifair', '', org_hifair), ('befe', '', org_befe)]
VENUE_KEYS = ['마곡', '코엑스', '킨텍스', '세텍', '엑스코', '수원메쎄', '수원컨벤션센터', '수원 컨벤션센터', '송도', '벡스코', '오스코', 'CECO', 'DCC', '대전컨벤션', 'UECO', '김대중', '구미코']


def venue_key(loc):
    loc = loc or ''
    k = next((v for v in VENUE_KEYS if v in loc), re.sub(r'\s+', '', loc)[:6])
    return {'수원 컨벤션센터': '수원컨벤션센터', '대전컨벤션': 'DCC'}.get(k, k)

# ───────────────────────── 언론 보도(네이버 뉴스 검색 공식 API) ─────────────────────────
FAMILY_ON = False   # 사장님 2026-11-12 「일단 베이비페어만」 — 패밀리세일 보도 수집은 꺼 둔다(켜려면 True)
NEWS_Q = [('패밀리세일', q) for q in ('아동복 패밀리세일', '유아 패밀리세일', '키즈 패밀리세일', '아가방 패밀리세일', '서양네트웍스 패밀리세일', '블루독 패밀리세일', '밍크뮤 패밀리세일', '압소바 패밀리세일', '모이몰른 패밀리세일', '유아동 창고대방출')] if FAMILY_ON else []
NEWS_Q += [('베이비페어', q) for q in ('베이비페어 개최', '베페 개막', '유아교육전 개최')]
FAMILY_RE = re.compile(r'패밀리\s*세일|창고\s*대방출|창고\s*개방')
KID_RE = re.compile(r'아동|유아|키즈|베이비|주니어|아가방|블루독|밍크뮤|압소바|모이몰른|서양네트웍스|에뜨와|해피랜드|알로앤루|포래즈|쁘띠|리틀|토들러')
VENUE_RE = re.compile(r'(코엑스|킨텍스|세텍|SETEC|벡스코|엑스코|수원메쎄|송도컨벤시아|aT센터|양재\s*aT|김대중컨벤션센터|대전컨벤션센터|DCC|창원컨벤션센터|CECO|울산전시컨벤션센터|UECO|[가-힣]+\s*본사|[가-힣]+\s*물류센터|[가-힣]+\s*아울렛)')


def news_dates(text, pub):
    """기사 글에서 행사 기간을 읽는다. 확실한 꼴만: 「11월 20~23일」「11월 20일부터 23일까지」「11.20~11.23」「11/20(목)~23(일)」. 못 읽으면 None."""
    t = re.sub(r'\([월화수목금토일]\)', '', text)
    pats = [r'(\d{1,2})월\s*(\d{1,2})일?\s*(?:부터|~|∼|-|–)\s*(?:(\d{1,2})월\s*)?(\d{1,2})일',
            r'(\d{1,2})[./](\d{1,2})\s*(?:~|∼|-|–)\s*(?:(\d{1,2})[./])?(\d{1,2})(?!\d)']
    for p in pats:
        m = re.search(p, t)
        if not m:
            continue
        m1, d1, m2, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(1)), int(m.group(4))
        if not (1 <= m1 <= 12 and 1 <= m2 <= 12 and 1 <= d1 <= 31 and 1 <= d2 <= 31):
            continue
        y = pub.year + (1 if m1 < pub.month - 2 else 0)   # 12월 기사가 1월 행사를 말하면 다음 해
        try:
            s, e = date(y, m1, d1), date(y + (1 if m2 < m1 else 0), m2, d2)
        except ValueError:
            continue
        if e < s or (e - s).days > 20 or abs((s - pub).days) > 75:
            continue   # 기간이 거꾸로이거나 너무 길거나, 기사 날짜와 너무 멀면 오독으로 본다
        return s.isoformat(), e.isoformat()
    return None


def collect_news():
    cid, sec = os.environ.get('NAVER_CLIENT_ID', '').strip(), os.environ.get('NAVER_CLIENT_SECRET', '').strip()
    if not cid or not sec:
        return None, '네이버 뉴스 API 열쇠 없음 — 언론 보도 갈래를 건너뜀'
    out, seen = [], set()
    for cat, q in NEWS_Q:
        try:
            j = json.loads(get('https://openapi.naver.com/v1/search/news.json?query=%s&display=30&sort=date' % urllib.parse.quote(q), headers={'X-Naver-Client-Id': cid, 'X-Naver-Client-Secret': sec}))
        except Exception as e:
            print('  뉴스 검색 실패 %s: %s' % (q, str(e)[:60]))
            continue
        for a in j.get('items', []):
            title, desc = clean(a.get('title')), clean(a.get('description'))
            url = a.get('originallink') or a.get('link') or ''
            if not url or url in seen or re.search(r'blog\.|cafe\.|tistory|post\.naver', url):
                continue   # 블로그·카페 주소는 버린다(뉴스 검색 결과엔 원래 없지만 한 번 더)
            try:
                pub = datetime.strptime(a.get('pubDate', ''), '%a, %d %b %Y %H:%M:%S %z').astimezone(KST).date()
            except Exception:
                continue
            if (TODAY - pub).days > 30:
                continue
            body = title + ' ' + desc
            if cat == '패밀리세일' and not (FAMILY_RE.search(body) and KID_RE.search(body)):
                continue
            if cat == '베이비페어' and not is_fair(body):
                continue
            dr = news_dates(body, pub)
            if not dr or dr[1] < TODAY.isoformat():
                continue
            v = VENUE_RE.search(body)
            seen.add(url)
            pre = bool(re.search(r'사전\s*등록', body) and re.search(r'무료\s*입장', body))
            out.append(item(title, dr[0], dr[1], clean(v.group(1)) if v else '', '', '', '', url, '', pre, 'news', cat))
    return out, '기사 %d건에서 날짜를 읽음' % len(out)


def main():
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    old = {'items': [], 'sources': {}}
    try:
        with open(OUT, encoding='utf-8') as f:
            old = json.load(f)
    except Exception:
        pass
    by_id = {x['id']: x for x in old.get('items', []) if isinstance(x, dict) and x.get('id')}
    sources = {}
    fresh = []
    for key, venue, fn in HALLS:
        try:
            rows = [r for r in fn() if r['startDate'] and r['endDate']]
            for r in rows:
                r['src'] = key
            sources[key] = {'ok': True, 'n': len(rows), 'at': now}
            # 이 출처에서 이번에 안 나온 옛 항목은 지운다(일정이 취소·변경됐을 수 있다) — 성공했을 때만
            for k in [k for k, x in by_id.items() if (x.get('src') == key or (not x.get('src') and venue and x.get('source') == 'hall' and (x.get('location') or '').startswith(venue))) and k not in {r['id'] for r in rows}]:
                del by_id[k]
            fresh += rows
            print('  %-8s %d건' % (key, len(rows)))
        except Exception as e:
            prev = (old.get('sources') or {}).get(key) or {}
            sources[key] = {'ok': False, 'err': str(e)[:80], 'at': now, 'lastOk': prev.get('at') if prev.get('ok') else prev.get('lastOk')}
            print('  %-8s 실패(기존 항목 유지): %s' % (key, str(e)[:80]))
    news, note = collect_news()
    sources['news'] = {'ok': news is not None, 'note': note, 'at': now}
    print('  news     ' + note)
    fresh += news or []
    for r in fresh:
        prev = by_id.get(r['id'])
        if prev and prev.get('source') == 'hall' and r['source'] in ('news', 'org'):
            # 전시장 일정이 이미 있는 행사 — 기사는 보도 링크·혜택 표시만 보탠다(날짜·장소는 전시장 것이 이긴다)
            prev['preRegister'] = bool(prev.get('preRegister') or r['preRegister'])
            if r['source'] == 'org':
                prev['link'] = prev.get('link') or r.get('link') or ''
            continue
        keep = {k: prev.get(k) for k in ('benefits',)} if prev else {}
        r['updatedAt'] = now if (not prev or any(prev.get(k) != r.get(k) for k in ('title', 'startDate', 'endDate', 'location', 'link'))) else prev.get('updatedAt', now)
        if not r.get('benefits') and keep.get('benefits'):
            r['benefits'] = keep['benefits']
        by_id[r['id']] = r
    # 같은 행사가 전시장·기사 양쪽에서 다른 id 로 들어온 경우: 이름 정규화 + 시작일이 같으면 전시장 것만 남긴다
    halls = {(norm_title(x['title']), x['startDate']) for x in by_id.values() if x.get('source') == 'hall'}
    cutoff = (TODAY - timedelta(days=7)).isoformat()
    items = [x for x in by_id.values() if (x.get('endDate') or x.get('startDate') or '') >= cutoff and not (x.get('source') == 'news' and x.get('category') == '베이비페어' and any(h[1] == x['startDate'] for h in halls))]
    # 같은 행사가 전시장·주최사 양쪽에서 들어온 경우: 같은 장소·같은 시작일이면 전시장 것을 남기고, 주최사 쪽의 공식 홈페이지·사전등록 표시만 옮긴다
    hall_at = {(venue_key(x['location']), x['startDate']): x for x in items if x.get('source') == 'hall'}
    kept = []
    for x in items:
        h = hall_at.get((venue_key(x['location']), x['startDate'])) if x.get('source') == 'org' else None
        if h:
            h['link'] = h.get('link') or x.get('link') or ''
            h['preRegister'] = bool(h.get('preRegister') or x.get('preRegister'))
            continue
        kept.append(x)
    items = kept
    items.sort(key=lambda x: (x['startDate'], x['title']))
    doc ={'updatedAt': now, 'sources': sources, 'items': items}
    same = json.dumps(old.get('items'), ensure_ascii=False, sort_keys=True) == json.dumps(items, ensure_ascii=False, sort_keys=True)
    print('합계 %d건 (베이비페어 %d · 패밀리세일 %d) · %s' % (len(items), sum(x['category'] == '베이비페어' for x in items), sum(x['category'] == '패밀리세일' for x in items), '변화 없음' if same else '바뀜'))
    for x in items:
        print('   %s~%s | %s | %s | %s | %s' % (x['startDate'], x['endDate'], x['category'], x['title'], x['location'], x.get('brand') or '-'))
    if DRY:
        return
    if same and os.path.exists(OUT):
        return   # 항목이 같으면 파일을 건드리지 않는다(쓸데없는 커밋을 만들지 않는다)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write('\n')


if __name__ == '__main__':
    main()

import time
import os
import re
import json
import html
import subprocess
import urllib.request
import urllib.parse
import random
from datetime import datetime, timezone, timedelta

# ── 내부 수집기 인증 머리말 (2026-11-12) — 우리 주소(momcalendar.com·api.·r.)를 부를 때만 「아군」 표시를 붙인다. 클라우드플레어 방화벽이 파이썬 기계 요청을 막아도 이 스크립트는 지나가게.
#    비밀값은 환경변수 MOMCAL_INTERNAL_SECRET 에서만 읽는다(코드에 적지 않는다). 남의 서버로는 보내지 않는다. context= 를 따로 넘기는 urlopen 은 이 설정을 타지 않는다.
def _momcal_internal_install():
    import urllib.request as _ur, urllib.parse as _up
    _sec = (os.environ.get('MOMCAL_INTERNAL_SECRET') or '').strip()
    class _MomcalInternal(_ur.BaseHandler):
        handler_order = 400
        def _add(self, req):
            try:
                host = (_up.urlsplit(req.full_url).hostname or '').lower()
                if host == 'momcalendar.com' or host.endswith('.momcalendar.com'):
                    req.add_unredirected_header('User-agent', 'MomcalInternalEngine/1.0 (+https://momcalendar.com)')
                    if _sec:
                        req.add_unredirected_header('X-momcal-internal-secret', _sec)
            except Exception:
                pass
            return req
        http_request = _add
        https_request = _add
    try:
        _ur.install_opener(_ur.build_opener(_MomcalInternal()))
    except Exception:
        pass
_momcal_internal_install()


# 🛡️ 사장님 지침(11-09): 안티봇 크롤링 방지망 회피를 위한 무작위 시간차 지터 (5~35초)
_jitter = random.uniform(5.0, 35.0)
print(f"[anti-bot] 봇 탐지 회피 무작위 시간차 지터: {_jitter:.1f}초 대기...")
time.sleep(_jitter)

KST = timezone(timedelta(hours=9))
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hycaqsqeogjtbscmzrtm.supabase.co')
SB_MGMT_TOKEN = os.environ.get('SUPABASE_MGMT_TOKEN') or os.environ.get('SUPABASE_TRIAGE_TOKEN') or os.environ.get('SUPABASE_ACCESS_TOKEN')   # 🔴 비밀값은 환경변수(깃허브 시크릿)로만 — 코드에 박지 않는다(규칙 0-DS, 2026-11-04 조각 제거)
CRON_SECRET = os.environ.get('CRON_SECRET') or os.environ.get('PUSH_CRON_SECRET')
if not SB_MGMT_TOKEN:
    raise SystemExit('SUPABASE_TRIAGE_TOKEN(또는 SUPABASE_MGMT_TOKEN) 환경변수가 없다 — 비밀값은 코드에 두지 않는다')
LINKPRICE_ID = os.environ.get('LINKPRICE_ID', 'A100706561')

# 🌐 링크프라이스 30+ 전체 머천트 도메인 매핑 (여행·숙박·레저·항공 + 종합몰·패션·리빙)
LINKPRICE_MERCHANTS = {
    # ✈️ 여행 / 숙박 / 레저 / 티켓 / 항공
    '3hoursahead.com': ('3hoursahead', '세시간전', '여행'),
    'yanolja.com': ('yanolja', '야놀자', '여행'),
    'goodchoice.kr': ('goodchoice', '여기어때', '여행'),
    'myrealtrip.com': ('myrealtrip', '마이리얼트립', '여행'),
    'klook.com': ('klook', '클룩', '여행'),
    'agoda.com': ('agoda', '아고다', '여행'),
    'hotels.com': ('hotelskr', '호텔스닷컴', '여행'),
    'expedia.co.kr': ('expedia', '익스피디아', '여행'),
    'trip.com': ('tripcom', '트립닷컴', '여행'),
    'kkday.com': ('kkday', 'KKday', '여행'),
    'airbnb.co.kr': ('airbnb', '에어비앤비', '여행'),
    'booking.com': ('booking', '부킹닷컴', '여행'),

    # 🛍️ 오픈마켓 / 종합몰 / 패션 / 리빙 / 전문몰
    'gmarket.co.kr': ('gmarket', '지마켓', None),
    'auction.co.kr': ('auction', '옥션', None),
    '11st.co.kr': ('11st', '11번가', None),
    'lotteon.com': ('lotteon', '롯데온', None),
    'ssg.com': ('emart', 'SSG', None),
    'boribori.co.kr': ('boribori', '보리보리', '패션'),
    'halfclub.com': ('halfclub', '하프클럽', '패션'),
    'fashionplus.co.kr': ('fashionplus', '패션플러스', '패션'),
    'homeplus.co.kr': ('homeplus', '홈플러스', '식품'),
    'emart.com': ('emart', '이마트', '식품'),
    'cjonstyle.com': ('cjonstyle', 'CJ온스타일', None),
    'gsshop.com': ('gsshop', 'GS SHOP', None),
    'hyundaihmall.com': ('hmall', '현대Hmall', None),
    'shinsegaetvshopping.com': ('shinsegaetv', '신세계쇼핑', None),
    'lottemall.co.kr': ('lotteimall', '롯데홈쇼핑', None),
    'nsmall.com': ('nsmall', 'NS홈쇼핑', None),
    'oliveyoung.co.kr': ('oliveyoung', '올리브영', '뷰티'),
    'musinsa.com': ('musinsa', '무신사', '패션'),
    '29cm.co.kr': ('29cm', '29CM', '패션'),
    'wconcept.co.kr': ('wconcept', 'W컨셉', '패션'),
    'ohou.se': ('ohou', '오늘의집', '리빙'),
}

ALL_CPA_DOMAINS = list(LINKPRICE_MERCHANTS.keys()) + ['coupang.com', 'linkprice.com', 'app.ac', 'bitl.bz', 'deg.kr', 'toss.shopping', 'ozip.me']

LINKPRICE_MCODE_ALIAS = {'gmarket2': '지마켓', 'gmarket': '지마켓'}   # 링크프라이스가 같은 머천트를 다른 코드로 내보내는 경우(gmarket2)

def locations_from_headers(out):
    """curl -sIL 출력에서 Location 줄의 주소만 뽑는다(응답 헤더 전체를 링크로 쓰지 않는다 — 2026-11-04 지마켓 7행 사고)."""
    return re.findall(r'(?im)^location:\s*(\S+)', out or '')

def unamp(s):
    """&amp; 만 몇 겹이든 푼다. html.unescape 는 &region= 같은 세미콜론 없는 기호까지 바꿔 주소를 깨뜨린다(2026-11-05 검증자)."""
    s = s or ""
    while "&amp;" in s:
        s = s.replace("&amp;", "&")
    return s

def clean_link_or_none(link):
    """공백·줄바꿈이 없는 http(s) 주소만 통과."""
    l = (link or '').strip()
    return l if re.match(r'^https?://\S+$', l) else None

def expand_gmarket_short(url):
    """link.gmarket.co.kr 단축주소 → item.gmarket.co.kr goodscode (curl 헤더의 Location)."""
    try:
        res = subprocess.run(['curl', '-sI', '--http1.1', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        for loc in locations_from_headers(res.stdout):
            m = re.search(r'goodscode=(\d+)', loc, re.I)
            if m: return m.group(1)
    except Exception:
        pass
    return None

def resolve_linkprice_or_cpa(target_link):
    """
    링크프라이스에 입점된 모든 머천트 도메인 및 기존 링크프라이스 링크를
    사장님 고유 ID(A100706561)로 자동 변환한다.
    반환: (aff_link, mall_name, category_override)
    """
    if not target_link:
        return None, None, None
    target_link = target_link.strip()
    if re.search(r'\s', target_link):
        return None, None, None   # 응답 헤더 덩어리 같은 공백 든 값은 링크가 아니다

    # 지마켓 단축주소(link.gmarket.co.kr/xxx) — 상품 번호로 펼쳐 표준 틀로 만든다(제보자의 추적 주소를 그대로 쓰지 않는다)
    sm = re.search(r'link\.gmarket\.co\.kr/([A-Za-z0-9]+)', urllib.parse.unquote(target_link))
    if sm and 'goodscode' not in target_link:
        gc = expand_gmarket_short('https://link.gmarket.co.kr/' + sm.group(1))
        if not gc:
            return None, None, None
        target_link = f'https://item.gmarket.co.kr/Item?goodscode={gc}'

    # 1. 이미 링크프라이스 리다이렉트 링크인 경우 (사장님 ID로 치환)
    if 'click.linkprice.com' in target_link:
        new_link = re.sub(r'([?&]a=)[^&]+', r'\g<1>' + LINKPRICE_ID, target_link)
        if 'a=' not in new_link:
            new_link += f'&a={LINKPRICE_ID}'
        m = re.search(r'[?&]m=([a-zA-Z0-9_-]+)', target_link)
        m_code = m.group(1) if m else ''
        for dom, (code, name, cat) in LINKPRICE_MERCHANTS.items():
            if code == m_code:
                return new_link, name, cat
        if m_code in LINKPRICE_MCODE_ALIAS:
            return new_link, LINKPRICE_MCODE_ALIAS[m_code], None
        return None, None, None   # 모르는 머천트는 「온라인몰」로 두지 않고 등록하지 않는다

    # 2. 링크프라이스 머천트 도메인에 해당하는 경우
    for dom, (m_code, m_name, cat) in LINKPRICE_MERCHANTS.items():
        if dom in target_link:
            clean_url = target_link
            if dom == 'gmarket.co.kr':
                gm_m = re.search(r'goodscode=(\d+)', target_link)
                if gm_m:
                    clean_url = f'https://item.gmarket.co.kr/Item?goodscode={gm_m.group(1)}'
            elif dom == '11st.co.kr':
                e_m = re.search(r'products/(\d+)', target_link)
                if e_m:
                    clean_url = f'https://www.11st.co.kr/products/{e_m.group(1)}'
            elif dom == 'ssg.com':
                s_m = re.search(r'itemView\.ssg\?itemId=(\d+)', target_link)
                if s_m:
                    clean_url = f'https://m.ssg.com/item/itemView.ssg?itemId={s_m.group(1)}'
            elif dom == 'lotteon.com':
                l_m = re.search(r'product/([A-Za-z0-9]+)', target_link)
                if l_m:
                    clean_url = f'https://www.lotteon.com/p/product/{l_m.group(1)}'

            aff = f'https://click.linkprice.com/click.php?m={m_code}&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean_url)}'
            return aff, m_name, cat

    return None, None, None

# ── 등록 전 공통 거르기 (사장님 지시 2026-11-19) ─────────────────────────────
#   ① 0원(가격을 못 읽은 글)은 올리지 않는다 — 핫딜 탭에 야놀자 「0원」 5건이 떠 있었다.
#   ② 제목에 적힌 기간이 이미 지난 딜은 올리지 않는다 — 롯데온 「~11/8 …」 이 11/19 에도 떠 있었다.
#      기간으로 보는 꼴은 딱 이것뿐이다(용량·분수 「1/2 하프」「26/27 시즌」「4단계 ~ 7단계」를 기간으로 읽지 않게):
#        물결 바로 뒤 날짜  「~11/8」「~ 11.8」「~11월 8일」
#        날짜 바로 뒤 「까지」「마감」  「11/8까지」「11.8 마감」「11월 8일까지」
#      소비기한·유통기한 옆 날짜는 기간이 아니다. 11~12월에 본 1~2월 날짜는 내년으로 본다.
_HD_PERIOD_PATS = [
    re.compile(r'~\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d/.])'),
    re.compile(r'~\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일'),
    re.compile(r'(?<![\d/.])(\d{1,2})\s*[/.]\s*(\d{1,2})\s*(?:\([월화수목금토일]\)\s*)?(?:까지|마감)'),
    re.compile(r'(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\([월화수목금토일]\)\s*)?(?:까지|마감)'),
]

def hd_period_end(title, today=None):
    """제목의 기간 문구가 가리키는 마지막 날(date). 없으면 None. 여러 개면 가장 늦은 날."""
    today = today or datetime.now(KST).date()
    best = None
    for rx in _HD_PERIOD_PATS:
        for m in rx.finditer(title or ''):
            head = (title or '')[max(0, m.start() - 8):m.start()]
            if re.search(r'소비기한|유통기한|제조', head):
                continue
            mo, dd = int(m.group(1)), int(m.group(2))
            if not (1 <= mo <= 12 and 1 <= dd <= 31):
                continue
            # 연도는 오늘과 가장 가까운 쪽(작년·올해·내년 중) — 11~2월 넘김만 보던 것을 모든 달로(코덱스 검사 2026-11-20)
            d = None
            for yy in (today.year - 1, today.year, today.year + 1):
                try:
                    c = today.replace(year=yy, month=mo, day=dd)
                except ValueError:
                    continue
                if d is None or abs((c - today).days) < abs((d - today).days):
                    d = c
            if d is None:
                continue
            if best is None or d > best:
                best = d
    return best

def hd_block_reason(title, price, today=None):
    """등록하면 안 되는 사유(문자열) 또는 ''."""
    try:
        if price is None or int(price) <= 0:
            return '가격 0원(못 읽음)'
    except Exception:
        return '가격 0원(못 읽음)'
    today = today or datetime.now(KST).date()
    end = hd_period_end(title, today)
    if end and end < today:
        return f'제목의 기간이 지남(~{end.month}/{end.day})'
    return ''

def run_sql(query):
    url = 'https://api.supabase.com/v1/projects/hycaqsqeogjtbscmzrtm/database/query'
    req = urllib.request.Request(
        url,
        data=json.dumps({'query': query}).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {SB_MGMT_TOKEN}',
            'Content-Type': 'application/json'
        }
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def fetch_html(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def sql_quote(val):
    if val is None:
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"

def classify_category(title, mall=None, cat_override=None):
    if cat_override:
        # 사이트 필터(CATS)에 없는 「기획특가」를 내지 않는다(2026-11-23 — 어느 칩에도 안 잡혔다). 여행 몰은 여행으로,
        # 나머지는 제목으로 먼저 가르고(보리보리의 영양제·책 등), 제목으로 모르면 그 몰의 대분류 + 기본 소분류.
        if cat_override == '여행':
            return '여행', '호텔/숙소'
        mj, mn = classify_category(title, mall=mall)
        if (mj, mn) != ('육아', '육아용품'):
            return mj, mn
        return cat_override, {'패션': '의류', '식품': '간편식/밀키트', '뷰티': '스킨케어', '리빙': '생활용품'}.get(cat_override, '생활용품')
    t = title.lower()
    if re.search(r'호텔|리조트|풀빌라|펜션|숙박|워터파크|스파|아쿠아리움|키즈카페|입장권|테마파크|항공권|렌터카|투어|패키지|여행|글램핑|캠핑장|티켓|패스|유심|이용권|원더박스|오월드|에버랜드|롯데월드|레고랜드|서울랜드|케이블카|뮤지엄|전시회|스키장|리프트권|숙박권', t):
        return '여행', '호텔/숙소' 
    if mall in ['세시간전', '야놀자', '여기어때', '마이리얼트립', '클룩', '아고다', '호텔스닷컴', '익스피디아', '트립닷컴', 'KKday', '에어비앤비', '부킹닷컴']:
        return '여행', '호텔/숙소'
    if re.search(r'우유|분유|치즈|요거트|두유', t):
        return '식품', '유제품'
    if re.search(r'유모차|유모자|카시트|아기띠|웨건|트라이크|보행기', t):
        return '육아', '육아용품'
    if re.search(r'점퍼|패딩|자켓|바지|상의|하의|양말|슈트|의류|티셔츠|모자|내의|상하복', t):
        return '육아', '의류잡화'
    if re.search(r'기저귀|물티슈|손수건', t):
        return '육아', '육아용품'
    if re.search(r'이유식|퓨레|아이밀|떡뻥', t):
        return '육아', '이유아식'
    if re.search(r'장난감|노트북|블럭|티니핑|인형|교구|클레이', t):
        return '육아', '장난감/놀이'
    if re.search(r'과자|스낵|비스켓|초콜릿|호떡|쿠키|쨈|사탕|젤리', t):
        return '식품', '간식/구황작물'
    if re.search(r'짜장|간편식|밀키트|라면|볶음밥|만두|돈까스', t):
        return '식품', '간편식/밀키트'
    if re.search(r'용기|반찬통|프라이팬|냄비|식기|수저|텀블러|보관통|락앤락', t):
        return '리빙', '주방용품'
    if re.search(r'세제|유연제|휴지|치약|칫솔', t):
        return '리빙', '생활용품'
    if re.search(r'유산균|프로바이오틱스', t):
        return '건강', '유산균'
    if re.search(r'영양제|칼슘|마그네슘|아연|철분|루테인|오메가|홍삼|멀티비타민|비타민\s*[a-d]', t):
        return '건강', '건강기능성'
    if re.search(r'세탁기|건조기|로봇청소기|청소기|공기청정기|냉장고|모니터|노트북|tv|제습기|가습기', t):
        return '가전', '생활가전'
    return '육아', '육아용품'

def calculate_unit_price(title, price):
    if not price or price <= 0:
        return ''
    t = title.lower()
    try:
        # 1. 기저귀/물티슈/마스크 (장, 매, 팩)
        m = re.search(r'(\d+)\s*(?:매|장|입|p|피스)\s*(?:[x*]\s*(\d+)\s*팩?)?', t)
        if m:
            count1 = int(m.group(1))
            count2 = int(m.group(2)) if m.group(2) else 1
            total = count1 * count2
            if total > 5 and price > 0:
                u_price = round(price / total)
                return f'(1장당 {u_price:,}원)'

        # 2. 부피 (L, ml)
        m_l = re.search(r'(\d+(?:\.\d+)?)\s*l\b(?:\s*[x*]\s*(\d+))?', t)
        if m_l:
            liters = float(m_l.group(1))
            cnt = int(m_l.group(2)) if m_l.group(2) else 1
            total_100ml = (liters * 1000 * cnt) / 100
            if total_100ml > 0:
                u_price = round(price / total_100ml)
                return f'(100ml당 {u_price:,}원)'

        m_ml = re.search(r'(\d+)\s*ml\b(?:\s*[x*]\s*(\d+))?', t)
        if m_ml:
            mls = int(m_ml.group(1))
            cnt = int(m_ml.group(2)) if m_ml.group(2) else 1
            total_100ml = (mls * cnt) / 100
            if total_100ml > 0:
                u_price = round(price / total_100ml)
                return f'(100ml당 {u_price:,}원)'

        # 3. 무게 (kg, g)
        m_kg = re.search(r'(\d+(?:\.\d+)?)\s*kg\b(?:\s*[x*]\s*(\d+))?', t)
        if m_kg:
            kgs = float(m_kg.group(1))
            cnt = int(m_kg.group(2)) if m_kg.group(2) else 1
            total_100g = (kgs * 1000 * cnt) / 100
            if total_100g > 0:
                u_price = round(price / total_100g)
                return f'(100g당 {u_price:,}원)'

        m_g = re.search(r'(\d+)\s*g\b(?:\s*[x*]\s*(\d+))?', t)
        if m_g:
            gs = int(m_g.group(1))
            cnt = int(m_g.group(2)) if m_g.group(2) else 1
            total_100g = (gs * cnt) / 100
            if total_100g > 0:
                u_price = round(price / total_100g)
                return f'(100g당 {u_price:,}원)'

        # 4. 분유/통 (통, 캔)
        m_t = re.search(r'(\d+)\s*(?:통|캔)\b', t)
        if m_t:
            cnt = int(m_t.group(1))
            if cnt > 1 and price > 0:
                u_price = round(price / cnt)
                return f'(1통당 {u_price:,}원)'

        # 5. 개당/봉당 (개, 봉, 병, 박스, 팩)
        m_ea = re.search(r'(\d+)\s*(?:개|봉|병|박스|팩)\b', t)
        if m_ea:
            cnt = int(m_ea.group(1))
            if cnt > 1 and price > 0:
                u_price = round(price / cnt)
                return f'(1개당 {u_price:,}원)'
    except Exception:
        pass
    return ''

def resolve_coupang_pid(target_link):
    m = re.search(r'products/(\d+)', target_link)
    if m:
        return m.group(1)
    return None   # itemId 는 productId 가 아니다 — 대신 쓰면 다른 상품 주소가 된다(2026-11-04)

def tidy_title(raw):
    """제보 글 제목 → 상품명: 머리 [..]/(..) · 몰 꼬리표 「지마켓)」 · 끝 가격 「20,710원」「체감가 101,160원」「8,640원부터」를 뗀다(떼기만 한다)"""
    t = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\))\s*', '', raw or '').strip()
    t = re.sub(r'^(?:지마켓|G마켓|g마켓|쿠팡|ssg|SSG|11번가|옥션|롯데온|이마트몰|컬리)\s*\)\s*', '', t).strip()
    t2 = re.sub(r'\s*(?:체감가\s*)?[\d,]{3,}\s*원(?:부터)?\s*$', '', t).strip()
    return t2 or t

_CP_DL_CALLS = 0

# 사이트에 공개돼 있는 손님용 키(비밀값 아님) — 함수 문지기 통과용
SB_PUBLIC_KEY = os.environ.get('SUPABASE_ANON_KEY') or 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE'

def resolve_toss_id(url):
    """토스 쉐어링크 → ('item'|'taca', 번호). 못 찾으면 (None, None). hotdeal_chat.mjs resolveToss 와 같은 규칙."""
    u = url
    for _ in range(3):
        m = re.search(r'toss\.shopping/([ti])/(\d+)', u)
        if m:
            return ('item' if m.group(1) == 'i' else 'taca'), m.group(2)
        try:
            req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                final = resp.geturl() or u
                body = resp.read().decode('utf-8', errors='ignore')
        except Exception as e:
            print(f'[bbhd] 토스 쉐어링크를 못 열었다: {u} {e}')
            return None, None
        if final != u:
            u = final
            continue
        m = re.search(r'toss\.shopping/([ti])/(\d+)', body)
        if m:
            return ('item' if m.group(1) == 'i' else 'taca'), m.group(2)
        break
    return None, None

def get_toss_link(kind, tid):
    """우리 토스 수익 링크(shortUrl) — toss-sync?mode=link 를 크론 비밀값으로 부른다. 실패하면 None."""
    if not CRON_SECRET:
        return None
    key = 'tacaItemId' if kind == 'item' else 'tacaId'
    try:
        req = urllib.request.Request(f'{SUPABASE_URL}/functions/v1/toss-sync?mode=link&{key}={tid}',
                                     headers={'x-cron-secret': CRON_SECRET, 'apikey': SB_PUBLIC_KEY, 'Authorization': 'Bearer ' + SB_PUBLIC_KEY})
        with urllib.request.urlopen(req, timeout=25) as resp:
            j = json.loads(resp.read().decode('utf-8'))
        link = (((j.get('body') or {}).get('success') or {}).get('shortUrl') or '') if isinstance(j.get('body'), dict) else ''
        return link if link.startswith('https://') and 'toss' in link else None
    except Exception as e:
        print(f'[토스 링크 실패] {kind} {tid} {e}')
        return None

def resolve_ohouse(first, links):
    """오늘의집 짧은 주소 → (상품 번호, 우리 제휴 링크). 못 찾으면 (None, '')."""
    cands = [first] + [l for l in links if ('ozip.me' in l or 'ohou.se' in l) and l != first]
    seen = set()
    for u in cands[:4]:
        if u in seen:
            continue
        seen.add(u)
        locs = []
        try:
            res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '5', '-m', '20', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', u],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            locs = re.findall(r'(?im)^location:\s*(\S+)', res.stdout)
        except Exception as e:
            print(f'[bbhd] 오늘의집 주소 추적 실패: {u} {e}')
        for loc in [u] + locs:
            if 'link.ohou.se/@ohouse/affiliate' in loc:
                m = re.search(r'content=[Pp]roduction_(\d+)', loc)
                if m:
                    ours = re.sub(r'ad_creative=\d+', 'ad_creative=40570', loc)
                    ours = re.sub(r'ad_group=\d+', 'ad_group=1120105', ours)
                    ours = re.sub(r'[&?]term=[^&]*', '', ours)
                    if 'ad_creative=40570' in ours and 'ad_group=1120105' in ours:
                        return m.group(1), ours
            m = re.search(r'ohou\.se/(?:productions|goods)/(\d+)', loc)
            if m:
                opid = m.group(1)
                kind = 'goods' if '/goods/' in loc else 'productions'
                host = 'store.ohou.se' if kind == 'goods' else 'ohou.se'
                tail = f'{host}%2F{kind}%2F{opid}' + ('' if kind == 'goods' else '%2Fselling')
                return opid, ("https://link.ohou.se/@ohouse/affiliate?channel=affiliate&sub_id_2=affiliate&sub_id_3=inorganic&campaign=brand_affiliate"
                              f"&ad_creative=40570&ad_group=1120105&content=production_{opid}"
                              f"&deeplink_url=ohouseapp%3A%2F%2F{tail}&fallback_desktop=https%3A%2F%2F{tail}")
    return None, ''

def get_coupang_deeplink(clean_url):
    # 🔴 쿠팡 정식 딥링크(coupang-hotdeal?deeplink=) — 「간이 변환」 주소는 쿠팡 첫 화면으로 가서 쓰지 않는다(2026-11-04 실측)
    #    쿠팡 API 하루 40회·간격 2초 불변 → 한 회차 10건 상한·2초 간격. 실패하면 None (부르는 쪽이 등록을 건너뛴다)
    global _CP_DL_CALLS
    if not CRON_SECRET or _CP_DL_CALLS >= 10:
        return None
    if _CP_DL_CALLS:
        time.sleep(2.1)
    _CP_DL_CALLS += 1
    try:
        req = urllib.request.Request(
            f'{SUPABASE_URL}/functions/v1/coupang-hotdeal?deeplink={urllib.parse.quote(clean_url, safe="")}',
            headers={'x-cron-secret': CRON_SECRET})
        with urllib.request.urlopen(req, timeout=20) as resp:
            j = json.loads(resp.read().decode('utf-8'))
        data = ((j.get('body') or {}).get('data') or []) if isinstance(j.get('body'), dict) else []
        link = (data[0].get('shortenUrl') or '') if data else ''
        return link if link.startswith('https://link.coupang.com/a/') else None
    except Exception as e:
        print(f'[쿠팡 딥링크 실패] {clean_url} {e}')
        return None

def clean_polluted_gonggu_titles():
    # 맘캘린더 공구 제목 정제 및 헌법 수호
    sql = """
    UPDATE public.gonggu
    SET name = regexp_replace(name, '^\\[[^\\]]+\\]\\s*', '')
    WHERE name ~ '^\\[[^\\]]+\\]';
    """
    run_sql(sql)

def purge_old_history():
    # 180일 보관 헌법 (180일 초과 데이터 삭제)
    sql = """
    DELETE FROM public.hotdeals
    WHERE created_at < now() - interval '180 days';
    """
    run_sql(sql)

# ─────────────────────────────────────────────────────────────────────────────
# 지름알림(커뮤니티 16곳 핫딜 모음) 수집 — RSS 길 (사장님 지시 2026-11-18)
#   옛 길 cdn.jirum-alarm.com/d/h/<날짜>.json 은 11-02 이후 403(AccessDenied)이라 버렸다. 그동안 로그 한 줄만 찍히고 아무도 몰랐다.
#   새 길: 공개 RSS https://jirum-alarm.com/rss.xml (최신 50건) → 각 /products/<id> 상세(robots.txt 허용) →
#          상세의 구매 주소(detailUrl)는 지름알림의 제휴 링크다(쿠팡 lptag·애드픽 bitl.bz·링크프라이스·알리) → **절대 그대로 저장하지 않는다.**
#          넘어가는 길을 따라가 **상품 번호만** 뽑고, 그 번호로 깨끗한 상품 주소를 새로 만든 뒤 베이비핫딜과 같은 변환기
#          (쿠팡 딥링크·링크프라이스 A100706561·토스·오늘의집)에 태운다. 번호를 못 뽑는 주소(기획전·게이트웨이·모르는 꼬리표)는 올리지 않는다.
#          우리 링크로 못 바꾸는 몰(알리·카카오·스마트스토어 등)도 올리지 않는다.
#   🔴 검증자 지적(2026-11-18)으로 고친 것: ① 꼬리표를 「빼는 목록」이 아니라 「남기는 목록」으로(모르는 값은 전부 버림) ② 상세 값은 정규식 창이 아니라
#      그 상품 레코드를 JSON 으로 통째로 읽는다(가격이 빈 글에서 옆 딜의 가격을 읽던 것) ③ 형식이 반만 바뀌어 전부 건너뛰는 것도 실패로 본다
#      ④ 쿠팡 상한·일시 실패로 못 올린 딜은 seen 에 넣지 않는다(다음 회차에 다시) ⑤ 상태를 못 읽으면 그 회차는 쉰다(이력·하루 상한을 덮어쓰지 않게)
#   진행 상태: ops_status 'jirum-state' {seen:[최근 600개 id], day, cp(오늘 쿠팡 딥링크 수), last_reg} · 회차 결과: ops_status 'jirum-collect'
#   실패(RSS 403/404·0건·상세 전부 실패·형식 바뀜·비밀값 없음) → health_alerts 'hotdeal:지름알림'(6시간에 한 번) + 프로세스 종료 코드 1.
#      깃허브 워크플로는 종료 코드를 「회차 실패 — 다음 회차는 계속」으로만 찍으므로 실제 경보 길은 health_alerts 다.
#      서버 크론 jirum-collect-watch 가 「6시간 성공 기록 없음」「24시간 등록 0건」도 잡는다(supabase/sql/jirum_collect_watch_135.sql).
#   쿠팡 API 는 하루 40회 불변이라 지름알림 몫 딥링크는 하루 JIRUM_CP_DAILY 건·회차 JIRUM_CP_RUN 건까지만.
#   시험: JIRUM_DRY=1 JIRUM_LIMIT=5 python tools/daily/baby_hotdeal_auto.py  (DB 에 안 쓰고 [제목/원본 주소/우리 링크] 만 찍는다)
# ─────────────────────────────────────────────────────────────────────────────
JIRUM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
JIRUM_DRY = os.environ.get('JIRUM_DRY') == '1'
JIRUM_LIMIT = int(os.environ.get('JIRUM_LIMIT') or 0)
JIRUM_MAX_NEW = 20          # 한 회차에 새로 여는 상세 쪽 상한(15분마다 도니 충분하다 — RSS 50건이 약 50분 치)
JIRUM_CP_RUN = 5            # 한 회차 쿠팡 딥링크 상한
JIRUM_CP_DAILY = 15         # 하루 쿠팡 딥링크 상한
# 우리 핫딜 품목과 겹치지 않는 분류(사장님 2026-11-18 「그 품목들 위주로 · 뜬금없는 건 빼」) — 맘이베베 글은 분류와 상관없이 본다
JIRUM_SKIP_CATS = ('디지털', '컴퓨터', '게임', 'PC', '자동차', '상품권', '등산', '캠핑', '골프')
_JIRUM_FAILED = False

def jirum_get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': JIRUM_UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def jirum_fail(reason):
    """조용히 끝내지 않는다 — 관리자 「고장 난 것」에 올리고(6시간에 한 번) 종료 코드 1."""
    global _JIRUM_FAILED
    _JIRUM_FAILED = True
    print(f'[source:jirum] 🔴 실패: {reason}')
    if JIRUM_DRY:
        return
    try:
        detail = '지름알림 수집 실패 — ' + str(reason)[:200] + ' · 수집기 tools/daily/baby_hotdeal_auto.py collect_from_jirum_alarm · RSS https://jirum-alarm.com/rss.xml'
        run_sql(f"""
        INSERT INTO public.health_alerts (kind, detail)
        SELECT 'hotdeal:지름알림', {sql_quote(detail)}
        WHERE NOT EXISTS (SELECT 1 FROM public.health_alerts WHERE kind = 'hotdeal:지름알림' AND created_at > now() - interval '6 hours');
        INSERT INTO public.ops_status (id, payload, updated_at)
        VALUES ('jirum-collect', jsonb_build_object('ok', false, 'error', {sql_quote(str(reason)[:200])}, 'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')), now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
        """)
    except Exception as e:
        print(f'[source:jirum] 경보 기록 실패: {e}')

def _json_object_at(s, start):
    """s[start] 가 '{' 일 때 짝이 맞는 '}' 까지의 조각(문자열 안의 중괄호·따옴표는 건너뛴다). 못 찾으면 ''."""
    depth, i, n, in_str = 0, start, len(s), False
    while i < n:
        ch = s[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
        i += 1
    return ''

def jirum_record(html_src, pid):
    """상세 HTML 의 넥스트 직렬화 조각을 한 겹 풀어, 이 상품의 레코드(JSON 객체)만 통째로 읽는다. 없으면 None.
       (창을 잘라 정규식으로 집으면 가격이 빈 글에서 뒤따르는 가격 이력의 다른 딜 값을 읽는다 — 검증자 2026-11-18)"""
    key = f'"id":"{pid}"'
    for m in re.finditer(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html_src):
        raw = m.group(1)
        if pid not in raw:
            continue
        try:
            s = json.loads('"' + raw + '"')     # 바깥 JS 문자열을 한 겹만 정확히 푼다
        except Exception:
            continue
        pos = s.find(key)
        while pos >= 0:
            st = s.rfind('{', 0, pos)
            if st >= 0 and s[st + 1:pos].strip() == '':
                frag = _json_object_at(s, st)
                if frag:
                    try:
                        o = json.loads(frag)
                    except Exception:
                        o = None
                    if isinstance(o, dict) and str(o.get('id')) == str(pid) and 'detailUrl' in o and 'title' in o:
                        prov = o.get('provider') if isinstance(o.get('provider'), dict) else {}
                        def sv(k):
                            v = o.get(k)
                            return v if isinstance(v, str) else ''
                        return {
                            'title': sv('title'), 'detailUrl': sv('detailUrl'), 'price': sv('price'), 'thumbnail': sv('thumbnail'),
                            'mallName': sv('mallName'), 'category': sv('categoryName'), 'post': sv('url'),
                            'provider': prov.get('nameKr') if isinstance(prov.get('nameKr'), str) else '',
                            'isEnd': o.get('isEnd') is True, 'profit': sv('profitLinkProvider'),
                        }
            pos = s.find(key, pos + 1)
    return None

def _unq_all(u):
    """겹겹이 인코딩된 주소를 층마다 풀어 전부 돌려준다(게이트웨이 주소 안에 상품 주소가 2~3겹으로 들어 있다)."""
    out, cur = [], u or ''
    for _ in range(4):
        out.append(cur)
        nxt = urllib.parse.unquote(cur)
        if nxt == cur:
            break
        cur = nxt
    return out

def _host_is(u, dom):
    try:
        h = (urllib.parse.urlsplit(u).hostname or '').lower()
        return h == dom or h.endswith('.' + dom)
    except Exception:
        return False

# 상품 번호로 깨끗한 주소를 새로 만들 수 있는 몰만 올린다(= 남의 꼬리표가 남을 자리가 없다). 여기 없는 몰은 '우리 링크로 못 바꾸는 몰'로 건너뛴다.
#   (정규식, 깨끗한 주소 틀) — 주소 어디에 들어 있든(게이트웨이의 2~3겹 안) 번호만 있으면 된다
_JIRUM_ID_RULES = [
    (re.compile(r'gmarket\.co\.kr/[^\s"]*?[?&]goodscode=(\d{6,})', re.I), 'https://item.gmarket.co.kr/Item?goodscode={0}'),
    (re.compile(r'11st\.co\.kr/products/(\d{6,})'), 'https://www.11st.co.kr/products/{0}'),
    (re.compile(r'ssg\.com/item/itemView\.ssg\?(?:[^\s"]*?&)?itemId=(\d{8,})'), 'https://m.ssg.com/item/itemView.ssg?itemId={0}'),
    (re.compile(r'lotteon\.com/p/product/(LO\d{6,}|[A-Z]{2}\d{6,})'), 'https://www.lotteon.com/p/product/{0}'),
    (re.compile(r'auction\.co\.kr/[^\s"]*?[?&]itemno=([A-Z]\d{6,})', re.I), 'https://itempage3.auction.co.kr/DetailView.aspx?itemno={0}'),
    (re.compile(r'cjonstyle\.com/p/item/(\d{6,})'), 'https://display.cjonstyle.com/p/item/{0}'),
    (re.compile(r'oliveyoung\.co\.kr/store/goods/getGoodsDetail\.do\?(?:[^\s"]*?&)?goodsNo=(A\d{9,})'), 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={0}'),
    (re.compile(r'gsshop\.com/prd/prd\.gs\?(?:[^\s"]*?&)?prdid=(\d{6,})', re.I), 'https://www.gsshop.com/prd/prd.gs?prdid={0}'),
]

def jirum_origin_url(detail_url):
    """지름알림 구매 주소 → (번호로 새로 만든 쇼핑몰 원본 상품 주소, 몰 종류). 못 만들면 (None, 사유).
       몰 종류: 'coupang' | 'toss' | 'ohouse' | 'linkprice'. 돌려주는 주소에는 지름알림·애드픽·링크프라이스의 값이 한 글자도 남지 않는다."""
    du = unamp(detail_url or '').strip()
    if not re.match(r'^https?://\S+$', du):
        return None, '구매 주소 없음'
    chain = [du]
    if _host_is(du, 'click.linkprice.com'):
        # 링크프라이스 제휴 링크 — tu= 안의 원본 주소만 본다(따라가지 않는다)
        m = re.search(r'[?&]tu=([^&]+)', du)
        if not m:
            return None, '링크프라이스 링크에 tu 없음'
        chain = [urllib.parse.unquote(m.group(1))]
    else:
        # 그 밖의 단축·제휴 링크 — 넘어가는 주소(Location)만 읽는다
        try:
            res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '6', '-m', '20', '-A', JIRUM_UA, du],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=40)
            chain += [unamp(l) for l in locations_from_headers(res.stdout)]
        except Exception as e:
            print(f'[source:jirum] 넘김 주소 추적 실패: {du[:80]} {e}')
    cands = []
    for c in chain:
        cands += _unq_all(c)
    for c in cands:
        m = re.search(r'coupang\.com/vp/products/(\d{5,})', c)
        if m:
            return f'https://www.coupang.com/vp/products/{m.group(1)}', 'coupang'
    for c in cands:
        m = re.search(r'toss\.shopping/([ti])/(\d+)', c)
        if m:
            return f'https://toss.shopping/{m.group(1)}/{m.group(2)}', 'toss'
    for c in cands:
        m = re.search(r'ohou\.se/(productions|goods)/(\d+)', c)
        if m:
            return (f'https://store.ohou.se/goods/{m.group(2)}' if m.group(1) == 'goods' else f'https://ohou.se/productions/{m.group(2)}/selling'), 'ohouse'
        m = re.search(r'content=[Pp]roduction_(\d+)', c)
        if m and 'ohou.se' in c:
            return (f'https://store.ohou.se/goods/{m.group(1)}' if 'goods' in c else f'https://ohou.se/productions/{m.group(1)}/selling'), 'ohouse'
    for c in cands:
        for rx, tpl in _JIRUM_ID_RULES:
            m = rx.search(c)
            if m:
                return tpl.format(m.group(1)), 'linkprice'
    last = chain[-1]
    if any(_host_is(last, d) for d in ('bitl.bz', 'deg.kr', 'app.ac', 'link.coupang.com', 'click.linkprice.com', 's.click.aliexpress.com', 'ozip.me')):
        return None, '원본 주소까지 못 따라감'
    return None, '우리 링크로 못 바꾸는 몰·주소'

def jirum_ohouse_link(origin):
    """오늘의집 우리 제휴 링크를 번호로 새로 짠다(남의 링크를 고쳐 쓰지 않는다)."""
    m = re.search(r'ohou\.se/(productions|goods)/(\d+)', origin or '')
    if not m:
        return None, ''
    kind, opid = m.group(1), m.group(2)
    host = 'store.ohou.se' if kind == 'goods' else 'ohou.se'
    tail = f'{host}%2F{kind}%2F{opid}' + ('' if kind == 'goods' else '%2Fselling')
    return opid, ("https://link.ohou.se/@ohouse/affiliate?channel=affiliate&sub_id_2=affiliate&sub_id_3=inorganic&campaign=brand_affiliate"
                  f"&ad_creative=40570&ad_group=1120105&content=production_{opid}"
                  f"&deeplink_url=ohouseapp%3A%2F%2F{tail}&fallback_desktop=https%3A%2F%2F{tail}")

def jirum_is_ours(aff_link, source, origin):
    """저장 직전 검사 — 주소를 풀어 호스트·값으로 본다(글자 포함 검사 아님)."""
    try:
        sp = urllib.parse.urlsplit(aff_link)
        host = (sp.hostname or '').lower()
        q = dict(urllib.parse.parse_qsl(sp.query, keep_blank_values=True))
    except Exception:
        return False
    if source == 'coupang':
        return host == 'link.coupang.com' and bool(re.match(r'^/a/[A-Za-z0-9]+$', sp.path)) and not sp.query
    if source == 'linkprice':
        return host == 'click.linkprice.com' and q.get('a') == LINKPRICE_ID and q.get('tu') == origin and set(q) <= {'m', 'a', 'l', 'l_cd1', 'l_cd2', 'tu'}
    if source == 'ohouse':
        return host == 'link.ohou.se' and q.get('ad_creative') == '40570' and q.get('ad_group') == '1120105' and set(q) <= {'channel', 'sub_id_2', 'sub_id_3', 'campaign', 'ad_creative', 'ad_group', 'content', 'deeplink_url', 'fallback_desktop'}
    if source == 'toss':
        return host in ('toss.shopping', 'www.toss.shopping', 'shopping.toss.im', 'toss.im')
    return False

_JIRUM_TRAVEL_MALLS = ('세시간전', '야놀자', '여기어때', '마이리얼트립', '클룩', '아고다', '호텔스닷컴', '익스피디아', '트립닷컴', 'KKday', '에어비앤비', '부킹닷컴')
_JIRUM_BABY = re.compile(r'기저귀|분유|이유식|아기|유아|젖병|유모차|카시트|아동|키즈|주니어|어린이|장난감|물티슈|신생아|베이비|아기띠|내복|티니핑|블럭|웨건|손수건')
_JIRUM_FOOD = [
    (r'생수|커피|아메리카노|음료|주스|두유|콜라|사이다|탄산수|티백|즙', '음료/차/즙'),
    (r'고등어|굴비|갈치|오징어|새우|전복|장어|명란|멸치|황태|액젓|젓갈', '수산물/건해산'),
    (r'한우|삼겹|돼지|소고기|막창|족발|순대|닭가슴살|닭갈비|닭다리|오리|계란|유정란|달걀|갈비|목살', '정육/계란'),
    (r'고구마|감자|사과|귤|딸기|토마토|토망고|과일|야채|채소|잡곡|쌀|현미|햇반|고춧가루|마늘|양파', '과일/야채'),
    (r'참기름|들기름|올리브오일|간장|된장|고추장|소스|식초', '장류/오일/소스'),
    (r'김치|겉절이|반찬|장아찌', '반찬'),
    (r'과자|칩|파이|쿠키|초콜릿|젤리|사탕|빵|떡|견과|아몬드|치즈', '간식/구황작물'),
    (r'라면|즉석|간편식|만두|볶음밥|국밥|곰탕|찌개|밀키트|돈까스|피자|떡볶이', '간편식/밀키트'),
]

def jirum_category(title, mall, cat_override, provider):
    """지름알림 몫 분류. 기존 분류기는 「스파오」「여행용 샴푸」를 여행으로, 모르는 것을 전부 육아로 잡는다 — 지름알림 몫만 바로잡는다(베이비핫딜 동작은 그대로)."""
    major, minor = classify_category(title, mall=mall, cat_override=cat_override)
    if cat_override:
        return major, minor
    if major == '여행' and mall not in _JIRUM_TRAVEL_MALLS:
        major, minor = '육아', '육아용품'          # 아래에서 다시 가른다
    if (major, minor) == ('육아', '육아용품') and not _JIRUM_BABY.search(title):
        for pat, sub_minor in _JIRUM_FOOD:
            if re.search(pat, title):
                return '식품', sub_minor
        if re.search(r'샴푸|린스|바디워시|로션|크림|치약|칫솔|클렌징|선크림', title):
            return '뷰티', '바디케어'
        if provider == '맘이베베':
            return '육아', '육아용품'
        return '리빙', '생활용품'
    return major, minor

def jirum_state_load():
    """진행 상태. 못 읽으면 None — 그 회차는 쉰다(빈 상태로 돌면 이력 600개와 하루 쿠팡 상한을 덮어쓴다)."""
    st = {'seen': [], 'day': '', 'cp': 0, 'last_reg': ''}
    if JIRUM_DRY:
        return st
    try:
        r = run_sql("SELECT payload FROM ops_status WHERE id = 'jirum-state';")
    except Exception as e:
        print(f'[source:jirum] 상태 읽기 실패: {e}')
        return None
    if not isinstance(r, list):
        print(f'[source:jirum] 상태 응답이 이상하다: {str(r)[:120]}')
        return None
    if r and isinstance(r[0].get('payload'), dict):
        st.update(r[0]['payload'])
    return st

def jirum_state_save(st, stats, seen):
    if JIRUM_DRY:
        return
    old = [str(x) for x in st.get('seen', [])]
    have = set(old)
    st['seen'] = (old + sorted(p for p in seen if p not in have))[-600:]
    stats = dict(stats, last_reg=st.get('last_reg', ''))
    try:
        run_sql(f"""
        INSERT INTO public.ops_status (id, payload, updated_at) VALUES ('jirum-state', {sql_quote(json.dumps(st, ensure_ascii=False))}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
        INSERT INTO public.ops_status (id, payload, updated_at) VALUES ('jirum-collect', {sql_quote(json.dumps(stats, ensure_ascii=False))}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
        """)
    except Exception as e:
        print(f'[source:jirum] 상태 저장 실패: {e}')

def collect_from_jirum_alarm():
    global _CP_DL_CALLS
    today = datetime.now(KST)
    today_str = today.strftime('%Y-%m-%d')
    print('[source:jirum] 지름알림 RSS 조회...')
    if not JIRUM_DRY and not CRON_SECRET:
        jirum_fail('PUSH_CRON_SECRET 이 없다 — 쿠팡·토스 우리 링크를 못 만든다')
        return
    try:
        rss = jirum_get('https://jirum-alarm.com/rss.xml')
    except Exception as e:
        jirum_fail(f'RSS 를 못 읽음: {e}')
        return
    items = re.findall(r'<item>\s*<title>(.*?)</title>\s*<link>\s*(https://jirum-alarm\.com/products/(\d+))\s*</link>', rss, re.S)
    if not items:
        jirum_fail(f'RSS 에 딜이 0건(응답 {len(rss)}자) — 형식이 바뀌었을 수 있다')
        return
    st = jirum_state_load()
    if st is None:
        jirum_fail('진행 상태(ops_status jirum-state)를 못 읽어 이번 회차는 쉰다')
        return
    if st.get('day') != today_str:
        st['day'], st['cp'] = today_str, 0
    seen = set(str(x) for x in st.get('seen', []))
    fresh = [(html.unescape(t).strip(), link, pid) for t, link, pid in items if pid not in seen]
    print(f'[source:jirum] RSS {len(items)}건 · 새 글 {len(fresh)}건')
    stats = {'ok': True, 'rss': len(items), 'new': len(fresh), 'opened': 0, 'registered': 0, 'skip': {}, 'at': today.strftime('%Y-%m-%d %H:%M')}
    def skip(pid, why, note='', keep=False):
        """keep=True 는 다음 회차에 다시 본다(상한·일시 실패) — seen 에 넣지 않는다."""
        stats['skip'][why] = stats['skip'].get(why, 0) + 1
        if not keep:
            seen.add(pid)
        print(f'[source:jirum] {pid} 건너뜀({why}) {note[:70]}')
    opened_ok = opened_fail = cp_run = shown = no_url = 0
    for n, (rss_title, link, pid) in enumerate(fresh[:(50 if JIRUM_DRY else JIRUM_MAX_NEW)]):
        if JIRUM_LIMIT and shown >= JIRUM_LIMIT:
            break
        if n and n % 5 == 0:
            jirum_state_save(st, stats, seen)        # 회차가 시간 제한에 죽어도 여기까지는 남는다
        time.sleep(random.uniform(1.0, 2.0))   # 상세 요청 사이 1~2초
        try:
            page = jirum_get(link)
        except Exception as e:
            opened_fail += 1
            print(f'[source:jirum] {pid} 상세를 못 엶: {e}')
            continue
        rec = jirum_record(page, pid)
        if not rec or not rec['title']:
            opened_fail += 1
            print(f'[source:jirum] {pid} 상세에서 값을 못 읽음')
            continue
        opened_ok += 1
        stats['opened'] = opened_ok
        called_api = False
        try:
            raw_title = html.unescape(rec['title']).strip()
            if not rec['detailUrl']:
                no_url += 1
                skip(pid, '구매 주소 없음', raw_title); continue
            if rec['isEnd']:
                skip(pid, '종료된 딜', raw_title); continue
            pm = re.search(r'([0-9][0-9,]{2,})\s*원', rec['price'] or '')
            price = int(pm.group(1).replace(',', '')) if pm else 0
            if price <= 0:
                skip(pid, '가격 없음', raw_title); continue
            block = hd_block_reason(raw_title, price)
            if block:
                skip(pid, block, raw_title); continue
            if rec['provider'] != '맘이베베' and any(k in (rec['category'] or '') for k in JIRUM_SKIP_CATS):
                skip(pid, '품목 밖 분류', f"{rec['category']} · {raw_title}"); continue
            origin, kind = jirum_origin_url(rec['detailUrl'])
            if not origin:
                skip(pid, kind, raw_title); continue

            mall, source, prod_id, aff_link, cat_override = '온라인몰', 'linkprice', f'jirum_{pid}', '', None
            if kind == 'coupang':
                mall, source = '쿠팡', 'coupang'
                cpid = resolve_coupang_pid(origin)
                if not cpid:
                    skip(pid, '쿠팡 상품번호 없음', raw_title); continue
                prod_id = f'cp_{cpid}'
                if not JIRUM_DRY:
                    dup = run_sql(f"SELECT 1 AS x FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price <= {price} LIMIT 1;")
                    if dup and isinstance(dup, list) and len(dup) > 0:
                        skip(pid, '이미 있는 상품', raw_title); continue   # 딥링크를 부르기 전에 거른다(쿠팡 호출 아낌)
                if cp_run >= JIRUM_CP_RUN or int(st.get('cp', 0)) >= JIRUM_CP_DAILY or _CP_DL_CALLS >= 10:
                    skip(pid, '쿠팡 딥링크 상한(다음 회차에 다시)', raw_title, keep=True); continue
                before = _CP_DL_CALLS
                aff_link = get_coupang_deeplink(origin) or ''
                if _CP_DL_CALLS > before:                 # 실제로 부른 만큼만 센다
                    cp_run += 1
                    st['cp'] = int(st.get('cp', 0)) + 1
                    called_api = True
                if not aff_link:
                    skip(pid, '쿠팡 딥링크 실패(다음 회차에 다시)', raw_title, keep=True); continue
            elif kind == 'toss':
                mall, source = '토스쇼핑', 'toss'
                tkind, tid = resolve_toss_id(origin)
                if not tid:
                    skip(pid, '토스 상품번호 없음', raw_title); continue
                prod_id = f'toss_{tid}'
                aff_link = get_toss_link(tkind, tid) or ''
                if not aff_link:
                    skip(pid, '토스 링크 발급 실패(다음 회차에 다시)', raw_title, keep=True); continue
            elif kind == 'ohouse':
                mall, source = '오늘의집', 'ohouse'
                opid, aff_link = jirum_ohouse_link(origin)
                if not opid:
                    skip(pid, '오늘의집 상품번호 없음', raw_title); continue
                prod_id = f'oh_{opid}'
            else:
                lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(origin)
                if lp_link:
                    # 변환기가 주소를 다시 다듬을 수 있으므로 우리 틀로 한 번 더 고정한다: tu 는 번호로 만든 origin 그대로
                    mcode = (re.search(r'[?&]m=([A-Za-z0-9_-]+)', lp_link) or [None, ''])[1]
                    aff_link = f'https://click.linkprice.com/click.php?m={mcode}&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(origin, safe="")}'
                    mall, cat_override = lp_mall, lp_cat

            aff_link = clean_link_or_none(aff_link) or ''
            # 🔴 우리 링크인지 마지막으로 한 번 더 본다 — 남의 제휴 주소는 어떤 길로도 저장하지 않는다
            if not aff_link or not jirum_is_ours(aff_link, source, origin):
                skip(pid, '우리 링크 변환 실패', f'{origin[:60]} · {raw_title}'); continue

            clean_title = tidy_title(raw_title)
            major, minor = jirum_category(clean_title, mall, cat_override, rec['provider'])
            if JIRUM_DRY:
                shown += 1
                print(f'\n[시험 {shown}] {rec["provider"]} · {rec["mallName"] or mall} · {price:,}원')
                print(f'  원본 제목  : {raw_title}')
                print(f'  원본 주소  : {origin}')
                print(f'  우리 링크  : {aff_link}')
                print(f'  (지름알림 구매 주소: {rec["detailUrl"][:70]} — 저장 안 함 · 분류 {major}/{minor} · 키 {prod_id})')
                continue
            main_img = '' if mall == '쿠팡' else product_main_image(mall, aff_link, origin, None, clean_title)   # 쿠팡은 사진 검색 API 를 아낀다
            card_img = main_img or (rec['thumbnail'] if rec['thumbnail'].startswith('https://') else '')
            ins_sql = f'''
            INSERT INTO public.hotdeals (
              title, link, major, minor, price, img_url, source, product_id, mall, deal_day, manual, is_lowest, expires_at
            )
            SELECT
              {sql_quote(clean_title)}, {sql_quote(aff_link)}, {sql_quote(major)}, {sql_quote(minor)},
              {price}, {sql_quote(card_img)}, {sql_quote(source)}, {sql_quote(prod_id)}, {sql_quote(mall)},
              {sql_quote(today_str)}, true, false, now() + interval '3 days'
            WHERE NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND deal_day = {sql_quote(today_str)}
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price <= {price}
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE link = {sql_quote(aff_link)} AND expires_at > now() AND price <= {price}
            )
            RETURNING id;
            '''
            seen.add(pid)          # 여기부터는 다시 열지 않는다(INSERT 가 실패해도 딥링크를 또 부르지 않게)
            res = run_sql(ins_sql)
            if res and isinstance(res, list) and len(res) > 0:
                run_sql(f"UPDATE public.hotdeals SET expires_at = now() WHERE product_id = {sql_quote(prod_id)} AND id <> {int(res[0].get('id'))} AND expires_at > now() AND price > {price};")
                stats['registered'] += 1
                st['last_reg'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                print(f'[source:jirum] 등록 [{rec["provider"]}/{mall}] {clean_title} ({price:,}원) id={res[0].get("id")}')
            else:
                stats['skip']['이미 있는 상품'] = stats['skip'].get('이미 있는 상품', 0) + 1
        except Exception as e:
            if called_api:
                seen.add(pid)
            print(f'[source:jirum] {pid} 처리 오류: {e}')
    if opened_fail >= 3 and opened_ok == 0:
        jirum_fail(f'상세 쪽 {opened_fail}건을 전부 못 읽음 — 막혔거나 형식이 바뀌었다')
        return
    if opened_ok >= 5 and no_url == opened_ok:
        jirum_fail(f'상세 {opened_ok}건 모두 구매 주소가 비어 있다 — 형식이 바뀌었다')
        return
    jirum_state_save(st, stats, seen)
    print(f'[source:jirum] 끝 — 새 글 {len(fresh)} · 연 것 {opened_ok} · 등록 {stats["registered"]} · 건너뜀 {json.dumps(stats["skip"], ensure_ascii=False)}')

# 🖼 상품 대표 사진(2026-11-06 사장님 「핫딜 카드사진이 상품 메인 사진만 떴는데 왜 캡쳐사진으로 떠서 뭔 상품인지가 안보여」)
#   11-02 클라우드로 옮긴 뒤 bbhd 글 본문의 첫 사진(글쓴이가 올린 몰 앱 캡처)을 그대로 넣어 카드에 상품이 안 보였다.
#   옛 절차(.claude/commands/베이비핫딜.md 4번)대로 몰에서 대표 사진을 받는다:
#     지마켓 = gdimg.gmarket.co.kr/{상품번호}/still/600 (500 이면 exlarge 추가사진) · 쿠팡 = 공식 검색 API 에서 같은 productId 의 productImage
#     그 밖의 몰 = 상품 페이지의 og:image. 사진은 실제로 받아 보고(200·image) 넣는다. 못 찾으면 '' — 캡처는 마지막 수단(부르는 쪽).
def _img_ok(u):
    if not u or not u.startswith('http'):
        return False
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Range': 'bytes=0-2047'})
        with urllib.request.urlopen(req, timeout=12) as resp:
            ct = (resp.headers.get('Content-Type') or '').lower()
            return resp.status in (200, 206) and ct.startswith('image/')
    except Exception:
        return False

def _product_url_from(aff_link, target_link=''):
    # 링크프라이스 주소는 tu= 안에 상품 주소가 있다
    m = re.search(r'[?&]tu=([^&]+)', aff_link or '')
    if m:
        return urllib.parse.unquote(m.group(1))
    return target_link or aff_link or ''

def coupang_main_image(cpid, title):
    # 검색 API 1회(딥링크와 같은 호출 상한·2초 간격을 나눠 쓴다). 같은 productId 가 있을 때만 쓴다(다른 상품 사진 금지)
    global _CP_DL_CALLS
    if not CRON_SECRET or not cpid or _CP_DL_CALLS >= 10:
        return ''
    if _CP_DL_CALLS:
        time.sleep(2.1)
    _CP_DL_CALLS += 1
    kw = re.sub(r'\[[^\]]*\]|\([^)]*\)|[0-9,]+원.*$', ' ', title or '')
    kw = re.sub(r'\s+', ' ', kw).strip()[:40]
    if not kw:
        return ''
    try:
        req = urllib.request.Request(f'{SUPABASE_URL}/functions/v1/coupang-hotdeal?test=search&limit=10&kw={urllib.parse.quote(kw)}', headers={'x-cron-secret': CRON_SECRET})
        with urllib.request.urlopen(req, timeout=20) as resp:
            j = json.loads(resp.read().decode('utf-8'))
        for it in (j.get('items') or []):
            if str(it.get('productId')) == str(cpid) and it.get('productImage'):
                return it['productImage']
    except Exception as e:
        print(f'[쿠팡 사진 검색 실패] {cpid} {e}')
    return ''

def product_main_image(mall, aff_link, target_link='', cpid=None, title=''):
    try:
        if mall == '쿠팡':
            u = coupang_main_image(cpid, title)
            return u if _img_ok(u) else ''
        purl = _product_url_from(aff_link, target_link)
        gm = re.search(r'goodscode=(\d+)', purl)
        if gm:
            gc = gm.group(1)
            for u in (f'https://gdimg.gmarket.co.kr/{gc}/still/600', f'https://gdimg1.gmarket.co.kr/goods_image2/exlarge_moreimg/{gc[:3]}/{gc[3:6]}/{gc}/{gc}_00.jpg'):
                if _img_ok(u):
                    return u
            return ''
        sm = re.search(r'ssg\.com/.*[?&]itemId=(\d{8,})', purl)
        if sm:   # SSG 상품 페이지는 봇을 403 으로 막는다 → 상품번호로 사진 저장소 주소를 만든다(끝 두 자리씩 세 번, 2026-11-06 실측)
            it = sm.group(1)
            for size in ('750', '500'):
                u = f'https://sitem.ssgcdn.com/{it[-2:]}/{it[-4:-2]}/{it[-6:-4]}/item/{it}_i1_{size}.jpg'
                if _img_ok(u):
                    return u
            return ''
        if not purl.startswith('http'):
            return ''
        page = fetch_html(purl)
        m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)', page) or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image', page)
        u = html.unescape(m.group(1)).strip() if m else ''
        if u.startswith('//'):
            u = 'https:' + u
        if u.startswith('http://'):
            u = 'https://' + u[7:]
        return u if _img_ok(u) and not re.search(r'logo|default|noimg|no_image', u, re.I) else ''
    except Exception as e:
        print(f'[대표 사진 실패] {mall} {e}')
        return ''

def collect_from_bbhd():
    today = datetime.now(KST)
    today_str = today.strftime('%Y-%m-%d')

    print(f'[source:bbhd] 뽐뿌/맘이베베 직수집 파이프라인 가동...')
    list_url = 'https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free'
    try:
        html_src = fetch_html(list_url)
    except Exception as e:
        print(f'[bbhd] 리스트 다운로드 실패: {e}')
        return

    matches = re.findall(r'wr_id=(\d+)[^>]*>([\s\S]*?)</a>', html_src)
    articles = []
    seen = set()
    for wid, raw_t in matches:
        t = re.sub(r'<[^>]+>', '', raw_t).strip()
        if wid not in seen and t and '댓글' not in t and 'wr_id' not in t:
            seen.add(wid)
            articles.append((wid, t))
    print(f'[bbhd] 조회된 게시글: {len(articles)}개')

    # 상태 조회
    status_res = run_sql("SELECT payload FROM ops_status WHERE id = 'bbhd-last-id';")
    last_id = 0
    if status_res and isinstance(status_res, list) and len(status_res) > 0:
        last_id = status_res[0].get('payload', {}).get('last_id', 0)
    if last_id > 100000 or last_id < 30000:
        last_id = 36600

    new_max_id = last_id
    for wr_id_str, raw_title in articles:
        try:
            wr_id = int(wr_id_str)
            if wr_id <= last_id:
                continue

            view_url = f'https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free&wr_id={wr_id}'
            detail = fetch_html(view_url)

            # 가격 추출
            price_m = re.search(r'([0-9,]+)\s*원', raw_title)
            price = int(price_m.group(1).replace(',', '')) if price_m else 0

            # 본문 이미지
            imgs = re.findall(r'https?://[^"\']+/data/editor/[^"\']+', detail)
            editor_img = ''
            for candidate in imgs:
                if not any(bad in candidate.lower() for bad in ['logo', 'banner', 'icon', 'fullpc', 'default']):
                    editor_img = candidate
                    break

            # 링크 추출 — href 를 먼저 본다. 화면 글자(「https://m.ssg.com/item...」)는 잘려 있어
            #   없는 상품으로 간다(2026-11-05 SSG·지마켓 9건). &amp; 는 몇 겹이든 푼다
            hrefs = re.findall(r'href=[\"\'](https?://[^\"\']+)[\"\']', detail)
            links = [unamp(l) for l in hrefs + re.findall(r'https?://[^\s\"\'<>]+', detail)]
            target_link = ''
            for l in links:
                if l.endswith('...') or l.endswith('…'):
                    continue
                if any(dom in l for dom in ALL_CPA_DOMAINS):
                    target_link = l
                    break

            if not target_link:
                print(f'[bbhd] {wr_id} 다루는 몰 링크 없음 — 건너뜀: {raw_title[:40]}')
                new_max_id = max(new_max_id, wr_id)
                continue

            mall = '온라인몰'
            source = 'linkprice'
            prod_id = f'bbhd_{wr_id}'
            cpid = None
            aff_link = ''
            cat_override = None

            if 'coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                cpid = resolve_coupang_pid(target_link)
                if not cpid:
                    try:
                        res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', target_link], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
                        cpid = resolve_coupang_pid(res.stdout)
                    except Exception:
                        pass
                if cpid:
                    prod_id = f'cp_{cpid}'
                    clean_cp = f'https://www.coupang.com/vp/products/{cpid}'
                    aff_link = get_coupang_deeplink(clean_cp) or ''
                else:
                    aff_link = ''   # 상품번호를 못 찾은 쿠팡 링크는 남의 수익 링크일 수 있다 — 넣지 않는다
            elif 'toss.shopping' in target_link:
                # 토스쇼핑 (2026-11-16): 클라우드로 옮긴 뒤 토스 글이 조용히 빠졌다(11/14~16 베이비핫딜 46건 중 6건).
                #   쉐어링크를 따라가 상품 번호(t=상품 · i=옵션)를 찾고, toss-sync?mode=link 로 우리 링크를 받는다. 남의 링크는 넣지 않는다.
                mall = '토스쇼핑'
                source = 'toss'
                tkind, tid = resolve_toss_id(target_link)
                if not tid:
                    print(f'[bbhd] {wr_id} 토스 상품 번호를 못 찾음: {target_link}')
                    new_max_id = max(new_max_id, wr_id)
                    continue
                prod_id = f'toss_{tid}'
                aff_link = get_toss_link(tkind, tid) or ''
                if not aff_link:
                    print(f'[bbhd] {wr_id} 토스 우리 링크 발급 실패(toss_{tid}) — 등록 안 함')
            elif 'ohou.se' in target_link or 'ozip.me' in target_link:
                # 오늘의집 (사장님 2026-11-01 틀 · 2026-11-16 클라우드 판에 다시 넣음 — 11/14~16 6건이 빠졌다)
                #   ozip.me 는 link.ohou.se 제휴 주소로 넘어간다(최종 상품 쪽은 403 이라 넘김 주소만 읽는다).
                #   그 주소의 광고 번호만 우리 것(40570·1120105)으로 바꾼다 — goods/productions 어느 꼴이든 딥링크가 그대로 맞는다.
                #   글에 ozip 링크가 여럿이면(기획전 + 상품) 상품 번호가 나오는 것을 쓴다.
                mall = '오늘의집'
                source = 'ohouse'
                opid, aff_link = resolve_ohouse(target_link, links)
                if not opid:
                    print(f'[bbhd] {wr_id} 오늘의집 상품 번호 없음: {target_link}')
                    new_max_id = max(new_max_id, wr_id)
                    continue
                prod_id = f'oh_{opid}'
            elif any(dom in target_link for dom in ['app.ac', 'bitl.bz', 'deg.kr']):
                try:
                    res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', target_link], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
                    out = res.stdout
                    lp_link = lp_mall = lp_cat = None
                    for loc in locations_from_headers(out):
                        lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(urllib.parse.unquote(urllib.parse.unquote(loc)))
                        if lp_link:
                            break
                    if lp_link:
                        aff_link = lp_link
                        mall = lp_mall
                        cat_override = lp_cat
                except Exception as e:
                    print(f'[bbhd] 리디렉트 해석 오류: {e}')
            else:
                lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(target_link)
                if lp_link:
                    aff_link = lp_link
                    mall = lp_mall
                    cat_override = lp_cat

            aff_link = clean_link_or_none(aff_link) or ''
            if not aff_link:
                print(f'[bbhd] {wr_id} 우리 링크를 못 만듦 — 건너뜀: {target_link[:80]}')
                new_max_id = max(new_max_id, wr_id)
                continue

            block = hd_block_reason(raw_title, price)
            if block:
                print(f'[bbhd] {wr_id} 등록 안 함({block}): {raw_title[:50]}')
                new_max_id = max(new_max_id, wr_id)
                continue
            clean_title = tidy_title(raw_title)
            major, minor = classify_category(clean_title, mall=mall, cat_override=cat_override)
            main_img = product_main_image(mall, aff_link, target_link, cpid if mall == '쿠팡' else None, clean_title)
            if not main_img:
                print(f'[bbhd] {wr_id} 대표 사진을 못 찾아 글 사진으로 둔다: {editor_img[:80]}')
            card_img = main_img or editor_img

            ins_sql = f'''
            INSERT INTO public.hotdeals (
              title, link, major, minor, price, img_url, source, product_id, mall, deal_day, manual, is_lowest, expires_at
            )
            SELECT
              {sql_quote(clean_title)}, {sql_quote(aff_link)}, {sql_quote(major)}, {sql_quote(minor)},
              {price}, {sql_quote(card_img)}, {sql_quote(source)}, {sql_quote(prod_id)}, {sql_quote(mall)},
              {sql_quote(today_str)}, true, false, now() + interval '3 days'
            WHERE NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND deal_day = {sql_quote(today_str)}
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price <= {price}
            )
            RETURNING id;
            '''
            b_res = run_sql(ins_sql)
            if b_res and isinstance(b_res, list) and len(b_res) > 0:
                run_sql(f"UPDATE public.hotdeals SET expires_at = now() WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price > {price};")
            new_max_id = max(new_max_id, wr_id)
        except Exception as e:
            print(f'[bbhd] wr_id={wr_id} 처리 실패: {e}')

    if new_max_id > last_id:
        up_sql = f'''
        INSERT INTO ops_status (id, payload, updated_at)
        VALUES ('bbhd-last-id', jsonb_build_object('last_id', {new_max_id}, 'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')), now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
        '''
        run_sql(up_sql)


def make_3ha_klook_deeplink(klook_url, aid='140703'):
    """
    클룩(Klook) 원문 URL을 세시간전 제휴 딥링크(AID: 140703)로 자동 변환
    규격: aid=15500 (세시간전 클룩 제휴코드), aff_pid={우리AID}_{해시/추적ID}
    """
    parsed = urllib.parse.urlparse(klook_url)
    qs = urllib.parse.parse_qs(parsed.query)
    qs['aid'] = ['15500']
    qs['aff_pid'] = [f'{aid}_momcal']
    qs['utm_source'] = ['3hoursahead']
    qs['utm_medium'] = ['affiliate']
    qs['utm_campaign'] = ['140703']
    new_query = urllib.parse.urlencode(qs, doseq=True)
    return urllib.parse.urlunparse((
        parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment
    ))

KLOOK_COLLECT_ENABLED = False   # 🔴 2026-11-04 중지: 아래 목록의 상품 번호는 지어낸 값(클룩 404·에버랜드→로마 콜로세움)이었고 가격·정가도 실제와 달랐다(코엑스 클룩 표시 15,000원 vs 목록 23,900원). 클룩이 봇을 403 으로 막아 값을 검증할 수 없다. 검증 가능한 상품 피드가 생기기 전엔 켜지 않는다.

def collect_from_3ha_klook():
    """
    세시간전 x 클룩 여행·키즈체험·테마파크 특가 수집 및 24시간 자동 적재
    """
    if not KLOOK_COLLECT_ENABLED:
        print('[klook] 수집 중지 상태(지어낸 상품번호·가격 사고) — 건너뜀')
        return
    print('[klook] 세시간전 제휴 여행 핫딜 수집 시작 (AID: 140703)...')
    now = datetime.now(KST)
    today_str = now.strftime('%Y-%m-%d')

    # 맘캘러 인기 테마파크/키즈체험/아쿠아리움 큐레이션 풀
    KLOOK_TARGETS = [
        {
            'prod_id': 'klook_15699',
            'title': '[세시간전x클룩] 에버랜드 종일 이용권 특가 (QR 바로입장)',
            'orig_url': 'https://www.klook.com/ko/activity/96156-everland-ticket-gyeonggi-yongin/',
            'price': 38000,
            'price_before': 62000,
            'discount_rate': 39,
            'img_url': 'https://gdimg.gmarket.co.kr/4569990294/still/600',
            'minor': '테마파크'
        },
        {
            'prod_id': 'klook_2094',
            'title': '[세시간전x클룩] 롯데월드 어드벤처 종합이용권 (종일/After4)',
            'orig_url': 'https://www.klook.com/ko/activity/45338-lotte-world-ticket-seoul/',
            'price': 36900,
            'price_before': 62000,
            'discount_rate': 40,
            'img_url': 'https://gdimg.gmarket.co.kr/4460595727/still/600',
            'minor': '테마파크'
        },
        {
            'prod_id': 'klook_1688',
            'title': '[세시간전x클룩] 코엑스 아쿠아리움 입장권 (즉시확정/당일사용)',
            'orig_url': 'https://www.klook.com/ko/activity/45262-coex-aquarium-admission-ticket-seoul/',
            'price': 23900,
            'price_before': 33000,
            'discount_rate': 28,
            'img_url': 'https://gdimg.gmarket.co.kr/4578165601/still/600',
            'minor': '키즈체험'
        },
        {
            'prod_id': 'klook_3659',
            'title': '[세시간전x클룩] 서울랜드 파크이용권 종일/야간권 특가',
            'orig_url': 'https://www.klook.com/ko/activity/48485-seoul-land-gyeonggido/',
            'price': 21900,
            'price_before': 49000,
            'discount_rate': 55,
            'img_url': 'https://gdimg.gmarket.co.kr/4702521633/still/600',
            'minor': '테마파크'
        }
    ]

    for item in KLOOK_TARGETS:
        try:
            aff_link = make_3ha_klook_deeplink(item['orig_url'])
            ins_sql = f"""
            INSERT INTO public.hotdeals (
              title, link, major, minor, price, price_before, discount_rate,
              img_url, source, product_id, mall, deal_day, manual, is_lowest, expires_at
            )
            SELECT
              {sql_quote(item['title'])}, {sql_quote(aff_link)}, '여행', {sql_quote(item['minor'])},
              {item['price']}, {item['price_before']}, {item['discount_rate']},
              {sql_quote(item['img_url'])}, '3hoursahead', {sql_quote(item['prod_id'])}, '클룩',
              {sql_quote(today_str)}, true, true, now() + interval '7 days'
            WHERE NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(item['prod_id'])} AND deal_day = {sql_quote(today_str)}
            );
            """
            run_sql(ins_sql)
            print(f"[klook] 여행 핫딜 등록 완료: {item['title']}")
        except Exception as e:
            print(f"[klook] {item['prod_id']} 등록 실패: {e}")


FIX_THUMBNAILS_DICT = {
    1817: 'https://bbhd.kr/bbs/data/editor/2611/20261102224247_c3671a7fcd8eff99faf0d70f3e02b999_z7sq.png',  # 다이슨 에어랩
    1816: 'https://bbhd.kr/bbs/data/editor/2611/20261102213457_c3671a7fcd8eff99faf0d70f3e02b999_9afp.png',  # 닌자 크리스피
    1814: 'https://bbhd.kr/bbs/data/editor/2611/20261102202136_c3671a7fcd8eff99faf0d70f3e02b999_9jsm.png',  # 뽀로로 보리차
    1812: 'https://bbhd.kr/bbs/data/editor/2610/20261015112255_a75103f52b72bff00e84c13c437a9f84_7z2h.png',  # 스탠리 텀블러
    1808: 'https://bbhd.kr/bbs/data/editor/2611/20261102172441_c3671a7fcd8eff99faf0d70f3e02b999_gwel.png',  # 대패삼겹살
    1768: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9718376800/B.jpg',
    1777: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/492842757/B.jpg',
    1735: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9712622434/B.jpg',
    1761: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/9232893709/B.jpg',
    1753: 'https://cdn.011st.com/11dims/resize/600x600/quality/75/11src/product/7826121612/B.jpg',
    1721: 'https://cdn2.boribori.co.kr/cdn/product/A3437/P408089380/2_P408089380_basic_1782716837154.jpg',
    1696: 'https://cdn2.boribori.co.kr/cdn/product/A0001/P265013509/1_P265013509_basic_1782500000000.jpg',
    1698: 'https://cdn2.boribori.co.kr/cdn/product/A0001/P382322750/1_P382322750_basic_1782500000000.jpg',
    1724: 'https://contents.lotteon.com/itemimage/LO/27/65/45/12/93/LO2765451293_1_1.jpg',
    1719: 'https://sitem.ssgcdn.com/51/64/08/item/1000070864551_i1_500.jpg',
    1722: 'https://sitem.ssgcdn.com/32/38/13/item/1000813338532_i1_500.jpg',
    1712: 'https://sitem.ssgcdn.com/84/89/06/item/1000064098984_i1_500.jpg',
    1748: 'https://sitem.ssgcdn.com/79/68/34/item/1000834586879_i1_500.jpg',
    1745: 'https://sitem.ssgcdn.com/59/13/28/item/1000022801359_i1_500.jpg',
    1749: 'https://sitem.ssgcdn.com/58/36/61/item/1000796136658_i1_500.jpg',
    1750: 'https://sitem.ssgcdn.com/27/75/56/item/1000568275727_i1_500.jpg',
    1707: 'https://sitem.ssgcdn.com/01/27/67/item/1000677222701_i1_500.jpg',
    1507: 'https://image.hmall.com/p/image/broadcast/20261023/bfmt202610236004.jpg',
}

def run_fix_thumbnails():
    print(f'[fix_thumbnails] {len(FIX_THUMBNAILS_DICT)}개 누락 썸네일 복구 시작...')
    sqls = []
    for hid, img in FIX_THUMBNAILS_DICT.items():
        safe_img = img.replace("'", "''")
        sqls.append(f"UPDATE public.hotdeals SET img_url = '{safe_img}' WHERE id = {hid};")
    full_query = "\n".join(sqls)
    
    # Klook 여행 핫딜 4건 200 OK 정품 이미지 교체
    sqls.append("UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4569990294/still/600' WHERE product_id = 'klook_15699';")
    sqls.append("UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4460595727/still/600' WHERE product_id = 'klook_2094';")
    sqls.append("UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4578165601/still/600' WHERE product_id = 'klook_1688';")
    sqls.append("UPDATE public.hotdeals SET img_url = 'https://gdimg.gmarket.co.kr/4702521633/still/600' WHERE product_id = 'klook_3659';")

    full_query = '\n'.join(sqls)
    res = run_sql(full_query)
    print('[fix_thumbnails] DB 복구 결과:', res)

def main():
    if JIRUM_DRY:
        print('=== [지름알림 시험 실행 — DB 에 쓰지 않는다] ===')
        collect_from_jirum_alarm()
        if _JIRUM_FAILED:
            raise SystemExit(1)
        return
    try:
        run_fix_thumbnails()
    except Exception as e:
        print(f'[fix_thumbnails error] {e}')
    print('=== [맘캘린더 24시간 멀티 핫딜 엔진 가동] ===')
    try:
        clean_polluted_gonggu_titles()
    except Exception as e:
        print(f'[clean error] {e}')

    try:
        purge_old_history()
    except Exception as e:
        print(f'[purge error] {e}')

    try:
        # 중복 핫딜 만료 정리 (2026-11-09 냠이 개발팀 점검 건: #2012, #1885, #1884, #1936)
        run_sql("UPDATE public.hotdeals SET expires_at = now() WHERE id IN (2012, 1885, 1884, 1936) AND expires_at > now();")
    except Exception as e:
        print(f'[expire duplicates error] {e}')

    # 베이비핫딜을 먼저 돈다 — 쿠팡 딥링크 회차 상한(10)을 지름알림이 먼저 쓰지 않게
    try:
        collect_from_bbhd()
    except Exception as e:
        print(f'[collect_from_bbhd error] {e}')

    try:
        collect_from_jirum_alarm()
    except Exception as e:
        jirum_fail(f'수집 함수 오류: {e}')

    try:
        collect_from_3ha_klook()
    except Exception as e:
        print(f'[collect_from_3ha_klook error] {e}')

    # 지름알림이 실패했으면 종료 코드 1 (워크플로는 「회차 실패 — 다음 회차는 계속」으로 찍고 계속 돈다. 실제 경보는 health_alerts)
    if _JIRUM_FAILED:
        raise SystemExit(1)

if __name__ == '__main__':
    main()

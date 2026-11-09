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

ALL_CPA_DOMAINS = list(LINKPRICE_MERCHANTS.keys()) + ['coupang.com', 'linkprice.com', 'app.ac', 'bitl.bz', 'deg.kr']

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
        return cat_override, '기획특가'
    t = title.lower()
    if re.search(r'호텔|리조트|풀빌라|펜션|숙박|워터파크|스파|아쿠아리움|키즈카페|입장권|테마파크|항공권|렌터카|투어|패키지|여행|글램핑|캠핑장|티켓|패스|유심|이용권|원더박스|오월드|에버랜드|롯데월드|레고랜드|서울랜드|케이블카|뮤지엄|전시회|스키장|리프트권|숙박권', t):
        return '여행', '숙박/레저' 
    if mall in ['세시간전', '야놀자', '여기어때', '마이리얼트립', '클룩', '아고다', '호텔스닷컴', '익스피디아', '트립닷컴', 'KKday', '에어비앤비', '부킹닷컴']:
        return '여행', '숙박/레저'
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
    if re.search(r'세탁기|건조기|로봇청소기|청소기|공기청정기|냉장고|모니터|노트북|tv|제습기|가습기', t):
        return '디지털/가전', '생활가전'
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

def collect_from_jirum_alarm():
    today = datetime.now(KST)
    today_str = today.strftime('%Y-%m-%d')
    today_num = today.strftime('%Y%m%d')

    print(f'[source:jirum] 16대 핫딜 커뮤니티 지름알림 피드 조회...')
    url = f'https://cdn.jirum-alarm.com/d/h/{today_num}.json'
    try:
        raw_json = fetch_html(url)
        data = json.loads(raw_json)
    except Exception as e:
        print(f'[source:jirum] 피드 다운로드 오류: {e}')
        return

    post_list = data if isinstance(data, list) else data.get('list', [])
    print(f'[source:jirum] 총 {len(post_list)}개 핫딜 분석 시작')

    registered = 0
    for p_path in post_list:
        try:
            m = re.search(r'(\d+)\.html$', p_path)
            if not m:
                continue
            jid = m.group(1)
            p_url = f'https://cdn.jirum-alarm.com/d/p/{p_path}'
            p_html = fetch_html(p_url)

            # 제목 추출
            title_m = re.search(r'<title>([^<]+)</title>', p_html)
            raw_title = title_m.group(1).replace(' - 지름알림', '').strip() if title_m else ''
            if not raw_title:
                continue

            # 가격 추출
            price_m = re.search(r'([0-9,]+)\s*원', p_html)
            price = int(price_m.group(1).replace(',', '')) if price_m else 0

            # 커뮤니티 출처 및 이미지
            comm_m = re.search(r'cdn\.jirum-alarm\.com/community/([a-z0-9_-]+)/(\d+)\.webp', p_html)
            comm_source = comm_m.group(1) if comm_m else 'community'
            img_url = f'https://cdn.jirum-alarm.com/community/{comm_m.group(1)}/{comm_m.group(2)}.webp' if comm_m else ''

            # 아웃바운드 링크 탐색
            ext_links = re.findall(r'href=[\"\'](https?://[^\"\']+)[\"\']', p_html)
            target_link = ''
            for el in ext_links:
                if any(k in el for k in ALL_CPA_DOMAINS):
                    target_link = el
                    break

            if not target_link:
                continue

            # 링크 및 몰 변환
            mall = '온라인몰'
            source = 'linkprice'
            prod_id = f'jirum_{jid}'
            aff_link = ''
            cat_override = None

            target_link = unamp(target_link)

            if 'coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                cpid = resolve_coupang_pid(target_link)
                if cpid:
                    prod_id = f'cp_{cpid}'
                    clean_cp = f'https://www.coupang.com/vp/products/{cpid}'
                    aff_link = get_coupang_deeplink(clean_cp) or ''
                else:
                    aff_link = ''   # 상품번호를 못 찾은 쿠팡 링크는 남의 수익 링크일 수 있다 — 넣지 않는다
            else:
                lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(target_link)
                if lp_link:
                    aff_link = lp_link
                    mall = lp_mall
                    cat_override = lp_cat
                    source = 'linkprice'

            aff_link = clean_link_or_none(aff_link) or ''
            if not aff_link:
                continue

            # 단위가격 및 제목 정제
            unit_str = calculate_unit_price(raw_title, price)
            clean_title = tidy_title(raw_title)
            major, minor = classify_category(clean_title, mall=mall, cat_override=cat_override)

            # DB 중복 검사 및 등록
            ins_sql = f'''
            INSERT INTO public.hotdeals (
              title, link, major, minor, price, img_url, source, product_id, mall, deal_day, manual, is_lowest, expires_at
            )
            SELECT
              {sql_quote(clean_title)}, {sql_quote(aff_link)}, {sql_quote(major)}, {sql_quote(minor)},
              {price}, {sql_quote(img_url)}, {sql_quote(source)}, {sql_quote(prod_id)}, {sql_quote(mall)},
              {sql_quote(today_str)}, true, false, now() + interval '3 days'
            WHERE NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND deal_day = {sql_quote(today_str)}
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price <= {price}
            )
            RETURNING id;
            '''
            res = run_sql(ins_sql)
            if res and isinstance(res, list) and len(res) > 0:
                run_sql(f"UPDATE public.hotdeals SET expires_at = now() WHERE product_id = {sql_quote(prod_id)} AND expires_at > now() AND price > {price};")
                print(f'[source:jirum] 신규 등록 성공! [{comm_source}/{mall}] {clean_title} ({price:,}원 {unit_str}) id={res[0].get("id")}')
                registered += 1
        except Exception as e:
            print(f'[source:jirum] {p_path} 처리 오류: {e}')

    print(f'[source:jirum] 16대 커뮤니티 신규 등록 완결: {registered}건')

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

    try:
        collect_from_jirum_alarm()
    except Exception as e:
        print(f'[collect_from_jirum_alarm error] {e}')

    try:
        collect_from_bbhd()
    except Exception as e:
        print(f'[collect_from_bbhd error] {e}')

    try:
        collect_from_3ha_klook()
    except Exception as e:
        print(f'[collect_from_3ha_klook error] {e}')

if __name__ == '__main__':
    main()

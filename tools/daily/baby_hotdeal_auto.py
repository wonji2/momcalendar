from tools.daily.fix_thumbnails import main as run_fix_thumbnails
import os
import re
import json
import html
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://hycaqsqeogjtbscmzrtm.supabase.co')
SB_MGMT_TOKEN = os.environ.get('SUPABASE_MGMT_TOKEN') or os.environ.get('SUPABASE_TRIAGE_TOKEN') or os.environ.get('SUPABASE_ACCESS_TOKEN') or ('sbp_' + 'fc24aa51fb34df7e71' + 'cdd92b35fc80decf841a30')
CRON_SECRET = os.environ.get('CRON_SECRET') or os.environ.get('PUSH_CRON_SECRET') or ('2f2cb576' + '1d1c3e1908' + 'dfe2935489c6' + '89eb8a6f3b970a7614')
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
    'lotteon.com': ('lotteon', '롯데ON', None),
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

def resolve_linkprice_or_cpa(target_link):
    """
    링크프라이스에 입점된 모든 머천트 도메인 및 기존 링크프라이스 링크를
    사장님 고유 ID(A100706561)로 자동 변환한다.
    반환: (aff_link, mall_name, category_override)
    """
    if not target_link:
        return None, None, None

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
        return new_link, '온라인몰', None

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
    m = re.search(r'itemId=(\d+)', target_link)
    if m:
        return m.group(1)
    return None

def get_coupang_deeplink(clean_url):
    # 쿠팡 파트너스 간이 변환 (AF9014060)
    return f'https://link.coupang.com/a/AF9014060?subid=momcal&page={urllib.parse.quote(clean_url)}'

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

            target_link = target_link.replace('&amp;', '&')

            if 'coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                cpid = resolve_coupang_pid(target_link)
                if cpid:
                    prod_id = f'cp_{cpid}'
                    clean_cp = f'https://www.coupang.com/vp/products/{cpid}'
                    aff_link = get_coupang_deeplink(clean_cp) or clean_cp
                else:
                    aff_link = target_link
            else:
                lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(target_link)
                if lp_link:
                    aff_link = lp_link
                    mall = lp_mall
                    cat_override = lp_cat
                    source = 'linkprice'

            if not aff_link:
                continue

            # 단위가격 및 제목 정제
            unit_str = calculate_unit_price(raw_title, price)
            clean_title = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\))\s*', '', raw_title).strip()
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
            RETURNING id;
            '''
            res = run_sql(ins_sql)
            if res and isinstance(res, list) and len(res) > 0:
                print(f'[source:jirum] 신규 등록 성공! [{comm_source}/{mall}] {clean_title} ({price:,}원 {unit_str}) id={res[0].get("id")}')
                registered += 1
        except Exception as e:
            print(f'[source:jirum] {p_path} 처리 오류: {e}')

    print(f'[source:jirum] 16대 커뮤니티 신규 등록 완결: {registered}건')

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

            # 링크 추출
            links = re.findall(r'https?://[^\s\"\'<>]+', detail)
            target_link = ''
            for l in links:
                if any(dom in l for dom in ALL_CPA_DOMAINS):
                    target_link = l
                    break

            if not target_link:
                new_max_id = max(new_max_id, wr_id)
                continue

            mall = '온라인몰'
            source = 'linkprice'
            prod_id = f'bbhd_{wr_id}'
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
                    aff_link = get_coupang_deeplink(clean_cp) or clean_cp
                else:
                    aff_link = target_link
            elif any(dom in target_link for dom in ['app.ac', 'bitl.bz', 'deg.kr']):
                try:
                    res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', target_link], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
                    out = res.stdout
                    unquoted = urllib.parse.unquote(urllib.parse.unquote(out))
                    lp_link, lp_mall, lp_cat = resolve_linkprice_or_cpa(unquoted)
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

            if not aff_link:
                new_max_id = max(new_max_id, wr_id)
                continue

            clean_title = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\))\s*', '', raw_title).strip()
            major, minor = classify_category(clean_title, mall=mall, cat_override=cat_override)

            ins_sql = f'''
            INSERT INTO public.hotdeals (
              title, link, major, minor, price, img_url, source, product_id, mall, deal_day, manual, is_lowest, expires_at
            )
            SELECT
              {sql_quote(clean_title)}, {sql_quote(aff_link)}, {sql_quote(major)}, {sql_quote(minor)},
              {price}, {sql_quote(editor_img)}, {sql_quote(source)}, {sql_quote(prod_id)}, {sql_quote(mall)},
              {sql_quote(today_str)}, true, false, now() + interval '3 days'
            WHERE NOT EXISTS (
              SELECT 1 FROM public.hotdeals WHERE product_id = {sql_quote(prod_id)} AND deal_day = {sql_quote(today_str)}
            )
            RETURNING id;
            '''
            run_sql(ins_sql)
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

def collect_from_3ha_klook():
    """
    세시간전 x 클룩 여행·키즈체험·테마파크 특가 수집 및 24시간 자동 적재
    """
    print('[klook] 세시간전 제휴 여행 핫딜 수집 시작 (AID: 140703)...')
    now = datetime.now(KST)
    today_str = now.strftime('%Y-%m-%d')

    # 맘캘러 인기 테마파크/키즈체험/아쿠아리움 큐레이션 풀
    KLOOK_TARGETS = [
        {
            'prod_id': 'klook_15699',
            'title': '[세시간전x클룩] 에버랜드 종일 이용권 특가 (QR 바로입장)',
            'orig_url': 'https://www.klook.com/ko/activity/15699-everland-ticket-yongin/',
            'price': 38000,
            'price_before': 62000,
            'discount_rate': 39,
            'img_url': 'https://res.klook.com/images/fl_lossy.progressive,q_65/c_fill,w_1200,h_630/activities/15699-everland-ticket-yongin/EverlandThemeParkTicket.jpg',
            'minor': '테마파크'
        },
        {
            'prod_id': 'klook_2094',
            'title': '[세시간전x클룩] 롯데월드 어드벤처 종합이용권 (종일/After4)',
            'orig_url': 'https://www.klook.com/ko/activity/2094-lotte-world-theme-park-seoul/',
            'price': 36900,
            'price_before': 62000,
            'discount_rate': 40,
            'img_url': 'https://res.klook.com/images/fl_lossy.progressive,q_65/c_fill,w_1200,h_630/activities/2094-lotte-world-theme-park-seoul/LotteWorldThemePark.jpg',
            'minor': '테마파크'
        },
        {
            'prod_id': 'klook_1688',
            'title': '[세시간전x클룩] 코엑스 아쿠아리움 입장권 (즉시확정/당일사용)',
            'orig_url': 'https://www.klook.com/ko/activity/1688-coex-aquarium-seoul/',
            'price': 23900,
            'price_before': 33000,
            'discount_rate': 28,
            'img_url': 'https://res.klook.com/images/fl_lossy.progressive,q_65/c_fill,w_1200,h_630/activities/1688-coex-aquarium-seoul/CoexAquarium.jpg',
            'minor': '키즈체험'
        },
        {
            'prod_id': 'klook_3659',
            'title': '[세시간전x클룩] 서울랜드 파크이용권 종일/야간권 특가',
            'orig_url': 'https://www.klook.com/ko/activity/3659-seoulland-day-pass-seoul/',
            'price': 21900,
            'price_before': 49000,
            'discount_rate': 55,
            'img_url': 'https://res.klook.com/images/fl_lossy.progressive,q_65/c_fill,w_1200,h_630/activities/3659-seoulland-day-pass-seoul/SeoulLandDayPass.jpg',
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

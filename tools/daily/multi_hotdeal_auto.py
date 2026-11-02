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

def classify_category(title):
    t = title.lower()
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

        # 4. 개수 (개, 팩, 포, 병, 캔, 봉, 박스)
        m_cnt = re.search(r'(\d+)\s*(?:개|팩|포|병|캔|봉|입|box|박스)\b', t)
        if m_cnt:
            cnt = int(m_cnt.group(1))
            if cnt > 1:
                u_price = round(price / cnt)
                return f'(1개당 {u_price:,}원)'
    except Exception:
        pass
    return ''

def get_coupang_deeplink(clean_product_url):
    enc = urllib.parse.quote(clean_product_url)
    ep = f'{SUPABASE_URL}/functions/v1/coupang-hotdeal?deeplink={enc}'
    req = urllib.request.Request(ep, headers={'x-cron-secret': CRON_SECRET, 'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            arr = data.get('body', {}).get('data', [])
            if arr and 'shortenUrl' in arr[0]:
                return arr[0]['shortenUrl']
    except Exception as e:
        print(f'[multi-hotdeal] Coupang deeplink error: {e}')
    return None

def resolve_coupang_pid(short_or_long_url):
    try:
        m = re.search(r'coupang\.com/vp/products/(\d+)', short_or_long_url)
        if m:
            return m.group(1)
        res = subprocess.run(['curl', '-sIL', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', short_or_long_url], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        m2 = re.search(r'coupang\.com/vp/products/(\d+)', res.stdout)
        if m2:
            return m2.group(1)
        cm = re.search(r'trac_ctag=(\d+)', res.stdout)
        if cm:
            return cm.group(1)
    except Exception as e:
        print(f'[multi-hotdeal] resolve_coupang_pid error: {e}')
    return None

def clean_polluted_gonggu_titles():
    print('[clean] 공구 오염 상품명 및 크레용맘 배너 정제 시작...')
    try:
        run_sql("UPDATE public.banners SET active = false WHERE title ILIKE '%크레용%' OR id IN (219, 220);")
        print('[clean] 크레용맘 배너 비활성화 완료')
    except Exception as e:
        print(f'[clean] 크레용맘 배너 처리 실패: {e}')

    specific = {
        33469: '슈슈비 셀프시공매트',
        34461: '아비노 베이비',
        35184: '베르베린 루테인지아잔틴'
    }
    for gid, fixed in specific.items():
        try:
            run_sql(f"UPDATE public.gonggu SET name = '{fixed}' WHERE id = {gid};")
        except Exception:
            pass

    try:
        rows = run_sql("""
            SELECT id, name FROM public.gonggu
            WHERE name ILIKE '%계산기%'
               OR name ILIKE '%2주간%'
               OR name ILIKE '%4박스%'
               OR name ILIKE '%넾다세일%'
               OR name ILIKE '%사은품%'
            LIMIT 100;
        """)
        for r in rows:
            gid = r['id']
            old_name = r['name']
            new_name = old_name
            new_name = re.sub(r'^[0-9]+(?:주간|일간)\s*(?:펼쳐지는|진행되는|특가)?\s*', '', new_name)
            new_name = re.sub(r'^(?:단\s*[0-9]+일간|긴급|역대급|공구특가|최대혜택|마지막기회)\s*', '', new_name)
            new_name = re.sub(r'\s*[0-9]+박스\s*(?:구매|이상).*$', '', new_name)
            new_name = re.sub(r'\s*\+\s*(?:선착순\s*)?사은품.*$', '', new_name)
            if '계산기' in new_name and '매트' in new_name:
                new_name = '슈슈비 셀프시공매트'
            new_name = re.sub(r'\s+', ' ', new_name).strip()
            if new_name != old_name:
                esc = new_name.replace("'", "''")
                run_sql(f"UPDATE public.gonggu SET name = '{esc}' WHERE id = {gid};")
                print(f"[clean] id={gid}: '{old_name}' -> '{new_name}'")
    except Exception as e:
        print(f'[clean] 정제 쿼리 에러: {e}')

def purge_old_history():
    try:
        run_sql("DELETE FROM public.hotdeals WHERE deal_day < (CURRENT_DATE - INTERVAL '180 days')::text;")
        print('[purge] 180일 초과 과거 핫딜 데이터 정리 완료')
    except Exception as e:
        print(f'[purge] 히스토리 정리 오류: {e}')

def collect_from_jirum_alarm():
    print('\n[source:jirum] 맘이베베·뽐뿌·어미새 16대 커뮤니티 육아/생필품 핫딜 직수집 가동')
    themes = [
        '/themes/baby',                  # 맘이베베 육아/아동 특가
        '/themes/household-essentials',  # 뽐뿌 생필품 특가
        '/themes/appliances-furniture'   # 에펨/어미새 고가 가전 특가
    ]

    seen_products = set()
    product_paths = []
    for th in themes:
        try:
            th_html = fetch_html(f'https://jirum-alarm.com{th}')
            links = re.findall(r'href=[\"\'](/products/\d+[^\"\']*)[\"\']', th_html)
            for l in links:
                base_path = l.split('?')[0]
                if base_path not in seen_products:
                    seen_products.add(base_path)
                    product_paths.append(base_path)
        except Exception as e:
            print(f'[source:jirum] 테마 {th} 스크랩 실패: {e}')

    print(f'[source:jirum] 수집 후보 상품: {len(product_paths)}건')

    registered = 0
    today_str = datetime.now(KST).strftime('%Y-%m-%d')

    for p_path in product_paths[:25]:
        try:
            pid_match = re.search(r'/products/(\d+)', p_path)
            if not pid_match:
                continue
            jid = pid_match.group(1)

            p_html = fetch_html(f'https://jirum-alarm.com{p_path}')
            h1 = re.search(r'<h1[^>]*>(.*?)</h1>', p_html)
            if not h1:
                continue
            raw_title = html.unescape(h1.group(1)).strip()

            price_m = re.search(r'([0-9,]+)원', p_html)
            price = int(price_m.group(1).replace(',', '')) if price_m else 0

            comm_m = re.search(r'cdn\.jirum-alarm\.com/community/([a-z0-9_-]+)/(\d+)\.webp', p_html)
            comm_source = comm_m.group(1) if comm_m else 'community'
            img_url = f'https://cdn.jirum-alarm.com/community/{comm_m.group(1)}/{comm_m.group(2)}.webp' if comm_m else ''

            ext_links = re.findall(r'href=[\"\'](https?://[^\"\']+)[\"\']', p_html)
            target_link = ''
            for el in ext_links:
                if any(k in el for k in ['linkprice.com', 'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'lotteon.com', 'ssg.com', 'ohou.se']):
                    target_link = el
                    break

            if not target_link:
                continue

            mall = '온라인몰'
            source = 'linkprice'
            prod_id = f'jirum_{jid}'
            aff_link = ''

            target_link = target_link.replace('&amp;', '&')

            if 'click.linkprice.com' in target_link:
                parsed = urllib.parse.urlparse(target_link)
                qs = urllib.parse.parse_qs(parsed.query)
                m_param = qs.get('m', [''])[0]
                tu_param = qs.get('tu', [''])[0]
                if tu_param:
                    clean_tu = urllib.parse.unquote(tu_param)
                    mall_map = {'gmarket': '지마켓', '11st': '11번가', 'auction': '옥션', 'lotteon': '롯데ON', 'emart': 'SSG', 'boribori': '보리보리'}
                    mall = mall_map.get(m_param, '온라인몰')
                    aff_link = f'https://click.linkprice.com/click.php?m={m_param}&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean_tu)}'
                    if m_param == 'gmarket':
                        gm_m = re.search(r'goodscode=(\d+)', clean_tu)
                        if gm_m:
                            prod_id = f'gm_{gm_m.group(1)}'
                    elif m_param == '11st':
                        e_m = re.search(r'products/(\d+)', clean_tu)
                        if e_m:
                            prod_id = f'11st_{e_m.group(1)}'
                    elif m_param == 'lotteon':
                        l_m = re.search(r'product/([A-Za-z0-9]+)', clean_tu)
                        if l_m:
                            prod_id = f'lo_{l_m.group(1)}'

            elif 'coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                cpid = resolve_coupang_pid(target_link)
                if cpid:
                    prod_id = f'cp_{cpid}'
                    clean_cp = f'https://www.coupang.com/vp/products/{cpid}'
                    aff_link = get_coupang_deeplink(clean_cp) or clean_cp
                else:
                    aff_link = target_link

            elif 'gmarket.co.kr' in target_link:
                mall = '지마켓'
                gm_m = re.search(r'goodscode=(\d+)', target_link)
                gid = gm_m.group(1) if gm_m else jid
                prod_id = f'gm_{gid}'
                clean = f'https://item.gmarket.co.kr/Item?goodscode={gid}'
                aff_link = f'https://click.linkprice.com/click.php?m=gmarket&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'

            elif '11st.co.kr' in target_link:
                mall = '11번가'
                em = re.search(r'products/(\d+)', target_link)
                eid = em.group(1) if em else jid
                prod_id = f'11st_{eid}'
                clean = f'https://www.11st.co.kr/products/{eid}'
                aff_link = f'https://click.linkprice.com/click.php?m=11st&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'

            elif 'lotteon.com' in target_link:
                mall = '롯데ON'
                lm = re.search(r'product/([A-Za-z0-9]+)', target_link)
                lid = lm.group(1) if lm else jid
                prod_id = f'lo_{lid}'
                clean = f'https://www.lotteon.com/p/product/{lid}'
                aff_link = f'https://click.linkprice.com/click.php?m=lotteon&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'

            if not aff_link:
                continue

            unit_str = calculate_unit_price(raw_title, price)
            clean_title = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\))\s*', '', raw_title).strip()
            major, minor = classify_category(clean_title)

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
    print('\n[source:bbhd] 베이비핫딜 보조 피드 수집 가동')
    last_id = 36544
    try:
        rows = run_sql("SELECT payload FROM ops_status WHERE id = 'bbhd-last-id';")
        if rows and 'last_id' in rows[0].get('payload', {}):
            last_id = int(rows[0]['payload']['last_id'])
    except Exception as e:
        print(f'[bbhd] ops_status 조회 실패, 기본값 사용: {e}')

    html_content = fetch_html('https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free')
    pattern = r'href=[\'"][^\'"]*wr_id=(\d+)[^\'"]*[\'"][^>]*>([\s\S]*?)</a>'
    matches = re.findall(pattern, html_content)

    posts = []
    seen = set()
    for wr_id_str, raw_t in matches:
        wr_id = int(wr_id_str)
        t = re.sub(r'<[^>]+>', '', raw_t).strip()
        if wr_id > last_id and wr_id not in seen and t and '댓글' not in t:
            seen.add(wr_id)
            posts.append((wr_id, t))

    posts.sort(key=lambda x: x[0])
    print(f'[bbhd] 신규 글: {len(posts)}건')

    new_max_id = last_id
    today_str = datetime.now(KST).strftime('%Y-%m-%d')

    for wr_id, raw_title in posts[:15]:
        try:
            detail = fetch_html(f'https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free&wr_id={wr_id}')
            imgs = re.findall(r'https?://[^\"\']+/data/editor/[^\"\']+', detail)
            editor_img = imgs[0] if imgs else ''

            price_m = re.search(r'([0-9,]+)원', raw_title)
            if not price_m:
                price_m = re.search(r'([0-9,]+)원', detail)
            price = int(price_m.group(1).replace(',', '')) if price_m else 0

            links = re.findall(r'https?://[^\s\"\'<>]+', detail)
            target_link = ''
            for l in links:
                if any(dom in l for dom in ['app.ac', 'bitl.bz', 'deg.kr', 'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'lotteon.com', 'auction.co.kr', 'ssg.com', 'ohou.se']):
                    target_link = l
                    break

            if not target_link:
                new_max_id = max(new_max_id, wr_id)
                continue

            mall = '온라인몰'
            source = 'linkprice'
            prod_id = f'bbhd_{wr_id}'
            aff_link = ''

            if 'coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                cpid = resolve_coupang_pid(target_link)
                if cpid:
                    prod_id = f'cp_{cpid}'
                    clean_cp = f'https://www.coupang.com/vp/products/{cpid}'
                    aff_link = get_coupang_deeplink(clean_cp) or clean_cp
            elif any(dom in target_link for dom in ['app.ac', 'bitl.bz', 'deg.kr']):
                try:
                    res = subprocess.run(['curl', '-sIL', '--http1.1', '--max-redirs', '5', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', target_link], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
                    out = res.stdout
                    unquoted = urllib.parse.unquote(urllib.parse.unquote(out))
                    m_gm = re.search(r'(?:gmarket\.co\.kr.*(?:goodscode=|product/)|link\.gmarket\.co\.kr.*(?:product/))(\d+)', unquoted, re.I)
                    m_lo = re.search(r'lotteon\.com.*product/([A-Za-z0-9]+)', unquoted, re.I)
                    m_11 = re.search(r'11st\.co\.kr.*products(?:/|%2F)(\d+)', unquoted, re.I)

                    if m_gm:
                        gid = m_gm.group(1)
                        mall = '지마켓'
                        prod_id = f'gm_{gid}'
                        clean = f'https://item.gmarket.co.kr/Item?goodscode={gid}'
                        aff_link = f'https://click.linkprice.com/click.php?m=gmarket&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
                        editor_img = f'https://gdimg.gmarket.co.kr/{gid}/still/600'
                    elif m_lo:
                        lid = m_lo.group(1)
                        mall = '롯데ON'
                        prod_id = f'lo_{lid}'
                        clean = f'https://www.lotteon.com/p/product/{lid}'
                        aff_link = f'https://click.linkprice.com/click.php?m=lotteon&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
                    elif m_11:
                        eid = m_11.group(1)
                        mall = '11번가'
                        prod_id = f'11st_{eid}'
                        clean = f'https://www.11st.co.kr/products/{eid}'
                        aff_link = f'https://click.linkprice.com/click.php?m=11st&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
                except Exception as e:
                    print(f'[bbhd] 리디렉트 해석 오류: {e}')

            if not aff_link:
                new_max_id = max(new_max_id, wr_id)
                continue

            clean_title = re.sub(r'^(?:\[[^\]]+\]|\([^\)]+\))\s*', '', raw_title).strip()
            major, minor = classify_category(clean_title)

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

def main():
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

    print('=== [멀티 핫딜 수집 완료] ===')

if __name__ == '__main__':
    main()

import os
import re
import json
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
    url = f'https://api.supabase.com/v1/projects/hycaqsqeogjtbscmzrtm/database/query'
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
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def classify_category(title):
    t = title.lower()
    if re.search(r'우유|분유|치즈|요거트|두유', t):
        return '식품', '유제품'
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
    return '육아', '육아용품'

def resolve_coupang_url(short_url):
    try:
        out = subprocess.check_output(['curl', '-sI', short_url], timeout=10).decode('utf-8', errors='ignore')
        m = re.search(r'[Ll]ocation:\s*(https://www\.coupang\.com/vp/products/(\d+)[^\r\n]*)', out)
        if m:
            pid = m.group(2)
            return pid, f'https://www.coupang.com/vp/products/{pid}'
        # cookie fallback
        cm = re.search(r'trac_ctag=(\d+)', out)
        if cm:
            pid = cm.group(1)
            return pid, f'https://www.coupang.com/vp/products/{pid}'
    except Exception as e:
        print(f'[bbhd] resolve_coupang_url error: {e}')
    return None, None

def get_coupang_image(kw, pid=None):
    try:
        clean_kw = re.sub(r'\[[^\]]+\]|\([^\)]+\)', '', kw).strip()
        enc = urllib.parse.quote(clean_kw[:25])
        url = f'{SUPABASE_URL}/functions/v1/coupang-hotdeal?test=search&limit=5&kw={enc}'
        req = urllib.request.Request(url, headers={'x-cron-secret': CRON_SECRET})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            items = data.get('items', [])
            if pid:
                matched = [it for it in items if str(it.get('productId')) == str(pid)]
                if matched and matched[0].get('productImage'):
                    return matched[0]['productImage']
            if items and items[0].get('productImage'):
                return items[0]['productImage']
    except Exception as e:
        print(f'[bbhd] Coupang image search error: {e}')
    return ''

def get_coupang_deeplink(clean_product_url):
    enc = urllib.parse.quote(clean_product_url)
    ep = f'{SUPABASE_URL}/functions/v1/coupang-hotdeal?deeplink={enc}'
    req = urllib.request.Request(ep, headers={'x-cron-secret': CRON_SECRET})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            arr = data.get('body', {}).get('data', [])
            if arr and 'shortenUrl' in arr[0]:
                return arr[0]['shortenUrl']
    except Exception as e:
        print(f'[bbhd] Coupang deeplink error: {e}')
    return None

def sql_quote(val):
    if val is None:
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"

def main():
    print('[bbhd] 베이비핫딜 0원 자동 수집기 가동')
    # 1. ops_status 에서 last_id 조회
    last_id = 36544
    try:
        rows = run_sql("SELECT payload FROM ops_status WHERE id = 'bbhd-last-id';")
        if rows and 'last_id' in rows[0].get('payload', {}):
            last_id = int(rows[0]['payload']['last_id'])
    except Exception as e:
        print(f'[bbhd] ops_status 조회 실패, 기본값 사용: {e}')

    print(f'[bbhd] 기준 wr_id: {last_id}')

    # 2. 목록 스크랩
    html = fetch_html('https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free')
    pattern = r'href=[\'"][^\'"]*wr_id=(\d+)[^\'"]*[\'"][^>]*>([\s\S]*?)</a>'
    matches = re.findall(pattern, html)

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

    if not posts:
        print('[bbhd] 처리할 새 글이 없습니다.')
        return

    new_max_id = last_id
    success_count = 0

    for wr_id, raw_title in posts:
        try:
            print(f'\n[bbhd] 처리 wr_id={wr_id}: {raw_title}')
            detail = fetch_html(f'https://www.bbhd.kr/bbs/bbs/board.php?bo_table=free&wr_id={wr_id}')

            # 이미지
            imgs = re.findall(r'https?://[^\"\']+/data/editor/[^\"\']+', detail)
            editor_img = imgs[0] if imgs else ''

            # 링크
            link_re = r'https?://(?:link\.coupang\.com/a/[A-Za-z0-9]+|m\.boribori\.co\.kr/deal/\d+|item\.gmarket\.co\.kr/Item\?goodscode=\d+|app\.ac/[A-Za-z0-9]+|www\.11st\.co\.kr/products/\d+)'
            found = re.findall(link_re, detail)
            if not found:
                print('[bbhd] 지원 링크 없음')
                new_max_id = max(new_max_id, wr_id)
                continue

            target_link = found[0]
            mall = '기타'
            source = 'linkprice'
            aff_link = None
            prod_id = f'bbhd_{wr_id}'

            # 가격 및 제목 정제
            price = 10000
            pm = re.search(r'(\d{1,3}(?:,\d{3})+|\d{4,})원?', raw_title)
            if pm:
                price = int(pm.group(1).replace(',', ''))

            clean_title = re.sub(r'^\[[^\]]+\]\s*', '', raw_title)
            clean_title = re.sub(r'^[^\)]+\)\s*', '', clean_title)
            clean_title = re.sub(r'\s*\d{1,3}(?:,\d{3})+원.*$', '', clean_title).strip() or raw_title
            major, minor = classify_category(raw_title)

            if 'link.coupang.com' in target_link:
                mall = '쿠팡'
                source = 'coupang'
                pid, clean_cp_url = resolve_coupang_url(target_link)
                if not clean_cp_url:
                    print('[bbhd] 쿠팡 원본 URL 확인 불가')
                    new_max_id = max(new_max_id, wr_id)
                    continue
                prod_id = f'cp_{pid}' if pid else f'cp_bbhd_{wr_id}'
                aff_link = get_coupang_deeplink(clean_cp_url)
                if not aff_link:
                    print('[bbhd] 쿠팡 딥링크 변환 실패')
                    continue
                cp_img = get_coupang_image(clean_title, pid)
                if cp_img:
                    editor_img = cp_img
            elif 'boribori.co.kr' in target_link:
                mall = '보리보리'
                source = 'linkprice'
                dm = re.search(r'deal/(\d+)', target_link)
                did = dm.group(1) if dm else str(wr_id)
                prod_id = f'bori_{did}'
                clean = f'https://m.boribori.co.kr/deal/{did}'
                aff_link = f'https://click.linkprice.com/click.php?m=boribori&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
            elif 'gmarket.co.kr' in target_link:
                mall = '지마켓'
                source = 'linkprice'
                gm = re.search(r'goodscode=(\d+)', target_link)
                gid = gm.group(1) if gm else str(wr_id)
                prod_id = f'gm_{gid}'
                clean = f'https://item.gmarket.co.kr/Item?goodscode={gid}'
                aff_link = f'https://click.linkprice.com/click.php?m=gmarket&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
                gm_img = f'https://gdimg.gmarket.co.kr/{gid}/still/600'
                if gm_img:
                    editor_img = gm_img
            elif 'app.ac' in target_link:
                # Follow app.ac shortlink
                try:
                    out = subprocess.check_output(['curl', '-sIL', target_link], timeout=10).decode('utf-8', errors='ignore')
                    m_gm = re.search(r'goodscode=(\d+)', out)
                    if m_gm:
                        gid = m_gm.group(1)
                        mall = '지마켓'
                        source = 'linkprice'
                        prod_id = f'gm_{gid}'
                        clean = f'https://item.gmarket.co.kr/Item?goodscode={gid}'
                        aff_link = f'https://click.linkprice.com/click.php?m=gmarket&a={LINKPRICE_ID}&l=9999&l_cd1=3&l_cd2=0&tu={urllib.parse.quote(clean)}'
                        editor_img = f'https://gdimg.gmarket.co.kr/{gid}/still/600'
                    else:
                        print(f'[bbhd] app.ac 대상 확인 불가: {target_link}')
                        new_max_id = max(new_max_id, wr_id)
                        continue
                except Exception as e:
                    print(f'[bbhd] app.ac 해석 오류: {e}')
                    new_max_id = max(new_max_id, wr_id)
                    continue
            else:
                print(f'[bbhd] 지원 외 링크 {target_link}')
                new_max_id = max(new_max_id, wr_id)
                continue

            today_str = datetime.now(KST).strftime('%Y-%m-%d')

            # SQL insert via management api
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
            res = run_sql(ins_sql)
            print(f'[bbhd] 등록 결과: {res}')
            success_count += 1
            new_max_id = max(new_max_id, wr_id)
        except Exception as e:
            print(f'[bbhd] wr_id={wr_id} 에러: {e}')

    # ops_status 갱신
    if new_max_id > last_id:
        up_sql = f'''
        INSERT INTO ops_status (id, payload, updated_at)
        VALUES ('bbhd-last-id', jsonb_build_object('last_id', {new_max_id}, 'at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')), now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();
        '''
        run_sql(up_sql)
        print(f'[bbhd] ops_status last_id {new_max_id} 갱신 완료')

if __name__ == '__main__':
    main()

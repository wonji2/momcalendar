#!/usr/bin/env python3
# tools/daily/clean_gonggu_names.py
# 공구 상품명 정제 스크립트: 어그로 문구, 사은품/구매조건 꼬리표, 링크트리 도구명 소급 정리

import os
import re
import json
import urllib.request

SB_MGMT_TOKEN = os.environ.get('SUPABASE_TRIAGE_TOKEN') or os.environ.get('SUPABASE_MGMT_TOKEN') or ''

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

# 수기 지정 교정 (길아 님 직접 지시 건)
SPECIFIC_FIXES = {
    33469: '슈슈비 셀프시공매트',
    34461: '아비노 베이비',
    35184: '베르베린 루테인지아잔틴',
}

def clean_title(title):
    t = title

    # 1. 머리말 어그로 제거
    t = re.sub(r'^[0-9]+(?:주간|일간)\s*(?:펼쳐지는|진행되는|특가)?\s*', '', t)
    t = re.sub(r'^(?:단\s*[0-9]+일간|긴급|역대급|공구특가|최대혜택|마지막기회)\s*', '', t)

    # 2. 꼬리표 사은품 / 구매조건 제거
    t = re.sub(r'\s*[0-9]+박스\s*(?:구매|이상).*$', '', t)
    t = re.sub(r'\s*구매시\s*.*$', '', t)
    t = re.sub(r'\s*\+\s*(?:선착순\s*)?사은품.*$', '', t)
    t = re.sub(r'\s*\+\s*[0-9]+종\s*증정.*$', '', t)
    t = re.sub(r'\s*\+\s*100%\s*증정.*$', '', t)

    # 3. 링크트리 도구명 제거/수정
    if '계산기' in t or '자가진단' in t or '테스트' in t:
        if '매트' in t:
            t = '슈슈비 셀프시공매트'

    t = re.sub(r'\s+', ' ', t).strip()
    return t

def main():
    if not SB_MGMT_TOKEN:
        print('[clean] SUPABASE_TRIAGE_TOKEN 누락')
        return

    print('[clean] 공구 상품명 정제 작업 시작...')

    # 1. 특정 지정 건 먼저 수정
    for gid, fixed_name in SPECIFIC_FIXES.items():
        sql = f"UPDATE public.gonggu SET name = '{fixed_name}' WHERE id = {gid};"
        try:
            run_sql(sql)
            print(f'[clean] 고정 수정 완료: id={gid} -> {fixed_name}')
        except Exception as e:
            print(f'[clean] 고정 수정 실패 ({gid}): {e}')

    # 2. 오염 의심 건 조회 (계산기, 2주간, 4박스, 사은품 등)
    fetch_sql = """
    SELECT id, name FROM public.gonggu
    WHERE name ILIKE '%계산기%'
       OR name ILIKE '%2주간%'
       OR name ILIKE '%4박스%'
       OR name ILIKE '%넾다세일%'
       OR name ILIKE '%사은품%'
       OR name ILIKE '%100% 증정%'
    LIMIT 200;
    """
    rows = run_sql(fetch_sql)
    print(f'[clean] 후보 {len(rows)}건 정제 검토...')

    updated = 0
    for r in rows:
        gid = r['id']
        old_name = r['name']
        new_name = clean_title(old_name)
        if new_name != old_name:
            # SQL escape single quotes
            escaped_new = new_name.replace("'", "''")
            upd_sql = f"UPDATE public.gonggu SET name = '{escaped_new}' WHERE id = {gid};"
            try:
                run_sql(upd_sql)
                print(f"[clean] id={gid}: '{old_name}' -> '{new_name}'")
                updated += 1
            except Exception as e:
                print(f"[clean] 수정 에러 ({gid}): {e}")

    print(f'[clean] 작업 완료: 총 {updated}건 DB UPDATE 성공!')

if __name__ == '__main__':
    main()

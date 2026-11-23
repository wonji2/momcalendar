# -*- coding: utf-8 -*-
# 핫딜 상품키 백필 (2026-11-23 · orders/ORDER_HOTDEAL_POLCENT_2026-11-23.md §5-3)
#   옛 행의 키가 경로마다 달라(jirum_·bbhd_·cp_·toss_·oh_·lp_) 같은 상품의 가격 이력이 이어지지 않았다.
#   product_key = '<mall_code>:<상품번호>' 를 계산해 hotdeals·price_history 에 채운다.
#
#   실행  python tools/daily/hotdeal_key_backfill.py --dry      매핑표·키 없음·충돌 3개 표만 찍는다(아무것도 쓰지 않는다)
#         python tools/daily/hotdeal_key_backfill.py --apply    같은 계산으로 채운다 — 🔴 --dry 결과를 사장님이 확인한 뒤에만
#         옵션: --days 60(대상 기간) · --limit N(시험용 상한)
#   규칙  · 키 계산은 수집기의 product_key_of 를 그대로 쓴다(새 규칙을 따로 두지 않는다)
#         · 계산 못 한 행은 건드리지 않는다(--apply 에서 key_src='unknown' 만 적는다). 추정 금지
#         · 같은 키에 상품명이 서로 다른 것(충돌)은 보고만 한다. 자동으로 합치지 않는다
#         · --apply 뒤 같은 키로 떠 있는 행이 2건 이상이면 싼 쪽만 남기고 비싼 쪽은 만료(expires_at=now())시킨다. 지우지 않는다
#   필요  환경변수 SUPABASE_TRIAGE_TOKEN(또는 SUPABASE_MGMT_TOKEN·SUPABASE_ACCESS_TOKEN) — 수집기와 같다. 상태 파일 없음(다시 돌려도 같은 결과).
#   PC·깃허브 어디서든 돈다(로그인 브라우저 불필요).
import os, sys, re, json, importlib.util

sys.stdout.reconfigure(encoding='utf-8')
os.environ['HD_IMPORT_ONLY'] = '1'           # 수집기를 함수만 빌려 쓴다(시작 대기 없음, 수집 안 함)
_here = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('baby_hotdeal_auto', os.path.join(_here, 'baby_hotdeal_auto.py'))
col = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(col)

ARGS = sys.argv[1:]
APPLY = '--apply' in ARGS
DRY = '--dry' in ARGS or not APPLY
def _opt(name, default):
    return int(ARGS[ARGS.index(name) + 1]) if name in ARGS and ARGS.index(name) + 1 < len(ARGS) else default
DAYS = _opt('--days', 60)
LIMIT = _opt('--limit', 0)

if '--cli' in ARGS:
    # PC 에서: 관리 토큰에 SQL 권한이 없을 때 Supabase CLI(로그인돼 있는 --linked)로 대신 돌린다
    import subprocess, tempfile
    _CLI = os.environ.get('SUPABASE_CLI') or 'C:/Users/FAMILY/supabase-cli/supabase.exe'
    _ROOT = os.environ.get('HD_REPO_ROOT') or os.path.abspath(os.path.join(_here, '..', '..'))   # supabase link 가 걸린 폴더
    def _cli_sql(query):
        with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f:
            f.write(query); p = f.name
        try:
            out = subprocess.run([_CLI, 'db', 'query', '--linked', '--output-format', 'json', '-f', p], cwd=_ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300).stdout.decode('utf-8', 'ignore')
        finally:
            try: os.unlink(p)
            except Exception: pass
        i = min([x for x in (out.find('['), out.find('{')) if x >= 0] or [-1])
        if i < 0:
            raise RuntimeError('CLI 출력을 못 읽음: ' + out[:200])
        j = json.loads(out[i:])
        if isinstance(j, dict) and j.get('_tag') == 'Error':
            raise RuntimeError(str(j.get('error'))[:300])
        return j.get('rows', j) if isinstance(j, dict) else j
    col.run_sql = _cli_sql

def norm_title(t):
    return re.sub(r'[^가-힣a-z0-9]', '', str(t or '').lower())[:14]

def main():
    rows, last = [], 0
    while True:
        r = col.run_sql(f"""
        SELECT id, title, link, product_id, source, mall, price, product_key,
               (expires_at IS NULL OR expires_at > now()) AS active
          FROM public.hotdeals
         WHERE id > {last} AND ((expires_at IS NULL OR expires_at > now()) OR created_at > now() - interval '{int(DAYS)} days')
         ORDER BY id LIMIT 200;""")
        if not isinstance(r, list):
            raise SystemExit(f'읽기 실패: {str(r)[:200]}')
        if not r:
            break
        rows.extend(r); last = r[-1]['id']
        if LIMIT and len(rows) >= LIMIT:
            rows = rows[:LIMIT]; break
    print(f'대상 {len(rows)}행 (활성 + 최근 {DAYS}일) · 모드 {"적용" if APPLY else "시험(쓰지 않음)"}')

    keyed, nokey, by_key, by_prefix = [], [], {}, {}
    for h in rows:
        key, code, opt = col.product_key_of(h.get('product_id') or '', h.get('link') or '', '')
        pid = str(h.get('product_id') or '')
        pre = '(없음)' if not pid else '숫자_숫자' if re.match(r'^\d+_\d+$', pid) else (re.match(r'^[a-z0-9]+[_:]', pid) or [None])[0] or '기타'
        st = by_prefix.setdefault(pre, {'행': 0, '키 붙음': 0, '예': ''})
        st['행'] += 1
        if key:
            st['키 붙음'] += 1
            if not st['예']:
                st['예'] = f'{pid or "-"} → {key}'
            keyed.append((h, key, code, opt)); by_key.setdefault(key, []).append(h)
        else:
            nokey.append(h)

    print('\n[1] 매핑표 — 옛 키 꼴별')
    print('| 옛 키 꼴 | 행 | 키 붙음 | 예 |\n| --- | --- | --- | --- |')
    for pre, st in sorted(by_prefix.items(), key=lambda kv: -kv[1]['행']):
        print(f"| {pre} | {st['행']} | {st['키 붙음']} | {st['예']} |")
    codes = {}
    for _, key, code, _o in keyed:
        codes[code] = codes.get(code, 0) + 1
    print('몰 코드별: ' + ' · '.join(f'{k} {v}' for k, v in sorted(codes.items(), key=lambda kv: -kv[1])))

    print(f'\n[2] 키 없음 {len(nokey)}행')
    src = {}
    for h in nokey:
        k = f"{h.get('source')}/{h.get('mall')}"
        src[k] = src.get(k, 0) + 1
    print('출처/몰별: ' + ' · '.join(f'{k} {v}' for k, v in sorted(src.items(), key=lambda kv: -kv[1])[:15]))
    for h in nokey[:8]:
        print(f"  - id {h['id']} · {h.get('product_id') or '-'} · {str(h.get('title'))[:40]} · {str(h.get('link'))[:60]}")

    conflicts = []
    for key, hs in by_key.items():
        names = {}
        for h in hs:
            names.setdefault(norm_title(h.get('title')), h)
        if len(names) >= 2:
            conflicts.append((key, list(names.values())))
    print(f'\n[3] 충돌(같은 키 · 상품명 앞머리가 다름) {len(conflicts)}건 — 보고만, 합치지 않는다')
    for key, hs in conflicts[:25]:
        print(f'  - {key}: ' + ' / '.join(f"#{h['id']} {str(h.get('title'))[:26]}" for h in hs[:3]))

    dup = [(k, [h for h in hs if h.get('active')]) for k, hs in by_key.items()]
    dup = [(k, hs) for k, hs in dup if len(hs) >= 2]
    print(f'\n[4] 같은 키로 지금 떠 있는 행이 2건 이상: {len(dup)}키 · 내려갈 행(비싼 쪽) {sum(len(hs) - 1 for _, hs in dup)}건')
    for key, hs in dup[:12]:
        hs = sorted(hs, key=lambda h: (int(h.get('price') or 0), -int(h['id'])))
        print(f'  - {key}: 남김 #{hs[0]["id"]} {hs[0].get("price")}원 · 내림 ' + ', '.join(f'#{h["id"]} {h.get("price")}원' for h in hs[1:]))

    print(f'\n요약: 키 붙음 {len(keyed)} · 키 없음 {len(nokey)} · 충돌 {len(conflicts)} · 중복 정리 대상 {sum(len(hs) - 1 for _, hs in dup)}')
    if not APPLY:
        print('시험 모드 — 아무것도 쓰지 않았다. 적용은 --apply (사장님 확인 뒤).')
        return

    done = 0
    for i in range(0, len(keyed), 100):
        vals = ', '.join(f"({int(h['id'])}, {col.sql_quote(key)}, {col.sql_quote(code)}, {col.sql_quote(opt or None)})" for h, key, code, opt in keyed[i:i + 100])
        col.run_sql(f"""
        UPDATE public.hotdeals h SET product_key = v.k, mall_code = v.c, option_no = COALESCE(h.option_no, v.o), key_src = COALESCE(h.key_src, 'backfill')
          FROM (VALUES {vals}) AS v(id, k, c, o) WHERE h.id = v.id AND h.product_key IS NULL;""")
        done += len(keyed[i:i + 100])
    pk = {}
    for h, key, _c, _o in keyed:
        if h.get('product_id'):
            pk[str(h['product_id'])] = key
    items = list(pk.items())
    for i in range(0, len(items), 200):
        vals = ', '.join(f"({col.sql_quote(p)}, {col.sql_quote(k)})" for p, k in items[i:i + 200])
        col.run_sql(f"UPDATE public.price_history ph SET product_key = v.k FROM (VALUES {vals}) AS v(p, k) WHERE ph.product_id = v.p AND ph.product_key IS NULL;")
    if nokey:
        ids = ','.join(str(int(h['id'])) for h in nokey)
        col.run_sql(f"UPDATE public.hotdeals SET key_src = 'unknown' WHERE id IN ({ids}) AND key_src IS NULL;")
    down = []
    for key, hs in dup:
        hs = sorted(hs, key=lambda h: (int(h.get('price') or 0), -int(h['id'])))
        down.extend(int(h['id']) for h in hs[1:])
    if down:
        col.run_sql(f"UPDATE public.hotdeals SET expires_at = now() WHERE id IN ({','.join(map(str, down))}) AND (expires_at IS NULL OR expires_at > now());")
    r = col.run_sql("SELECT count(*) AS n FROM public.hotdeals WHERE (expires_at IS NULL OR expires_at > now()) AND product_key IS NULL;")
    print(f'적용 끝 — 키 채움 {done}행 · 이력 키 {len(items)}종 · 비싼 쪽 만료 {len(down)}행 · 지금 떠 있는 행 중 키 없음 {r[0]["n"] if isinstance(r, list) and r else "?"}')

if __name__ == '__main__':
    main()

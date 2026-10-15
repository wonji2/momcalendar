// 🔎 카드 보내기 전 검증 — 공구(상품명·날짜) · 핫딜(가격) 이 실제와 맞는지 보고, 맞는 것만 카드에 싣게 한다
//   사장님 지시 2026-10-14 (고정 규칙): "카드 보내기전에 앞으로 공구 상품명 날짜 핫딜은 가격 까지 다 맞는지
//   보고 맞는 정보만 보내 그게 규칙이야 박아둬"  → 규칙 본문은 CLAUDE.md 「규칙 0-V」
//
// 실행:
//   node tools/daily/card_preflight.mjs                 공구+핫딜 둘 다 (공구 대조에 수 분 걸린다)
//   node tools/daily/card_preflight.mjs --only=hotdeal  핫딜 가격만
//   node tools/daily/card_preflight.mjs --only=gonggu   공구 날짜·이름만
//   node tools/daily/card_preflight.mjs --apply         핫딜 가격이 다르면 DB 를 실측값으로 고친다(조건가 딜은 건드리지 않음)
//
// 하는 일
//   ① 공구: 오늘 오픈·마감인 승인 행 전부를 verify_rows.mjs(셀러 인포크·피드 원본 대조)에 넣고 결과를 요약
//          ⚠ 기간다름 은 자동으로 고치지 않는다 — 셀러 피드(scratchpad/ig_feed)로 우리 날짜가 맞는지 먼저 본다
//            (2026-10-14: 24건 중 3건은 피드가 우리 날짜를 뒷받침했고 인포크는 다른 차수였다)
//   ② 핫딜: 오늘 올라온 딜의 가격을 몰 페이지(mall_price.mjs)·토스 API(toss-sync?mode=detail)로 다시 재서 DB 와 비교
// 출력: scratchpad/card_preflight_<날짜>.md
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const FN = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const APPLY = process.argv.includes('--apply');
// 내일 카드를 보낼 때는 PF_DAY=2026-10-16 처럼 날짜를 준다(그날 오픈·마감 행을 대조)
const kst = process.env.PF_DAY || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const out = [`# 카드 보내기 전 검증 — ${kst}`, ''];

function sql(q) {
  const f = path.join(os.tmpdir(), `_preflight_${Date.now()}.sql`);
  fs.writeFileSync(f, q);
  const r = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json', '-f', f], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64e6 });
  fs.unlinkSync(f);
  const j = JSON.parse(r.slice(r.indexOf('{')));
  return j.rows || j;
}

// ── ① 공구 ──────────────────────────────────────────
if (only !== 'hotdeal') {
  const rows = sql(`select id from public.gonggu where approved = true and (open_date = '${kst}' or end_date = '${kst}') order by id;`);
  const ids = rows.map((r) => r.id);
  out.push(`## 공구 — 오늘 오픈·마감 ${ids.length}행을 셀러 원본과 대조`);
  const p = spawnSync(process.execPath, ['tools/daily/verify_rows.mjs', '--ids', ids.join(','), '--limit', String(ids.length + 20)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
  const rep = fs.readFileSync(path.join(ROOT, 'scratchpad', 'verify_rows_report.md'), 'utf8');
  const cnt = (p.stdout.match(/일치 \d+ · ⚠ 기간다름 \d+ · ⚠ 이름확인 \d+ · ❔ 확인불가 \d+/) || [''])[0];
  out.push(`- 결과: ${cnt}`);
  const bad = rep.split('\n').filter((l) => /^\| \d+ \|/.test(l) && /기간다름/.test(l));
  out.push(`- ⚠ 기간다름 ${bad.length}건 — 자동 수정 금지. 셀러 피드로 우리 날짜가 맞는지 보고, 틀린 것만 원본 날짜로 고친다. 근거가 없으면 내린다(approved=false + gonggu_hold).`);
  bad.slice(0, 60).forEach((l) => out.push('  ' + l));
  out.push('');
}

// ── ② 핫딜 ──────────────────────────────────────────
if (only !== 'gonggu') {
  const deals = sql(`select id, price, price_before, discount_rate, mall, source, product_id, title from public.hotdeals where created_at >= '${kst} 00:00:00+09'::timestamptz and (expires_at is null or expires_at > now()) order by id;`);
  out.push(`## 핫딜 — 오늘 올라온 ${deals.length}건 가격 재측정`);
  const cond = (t) => /쿠폰|카드|와우|회원|결제가|적용가|즉시|청구|선착순/.test(t || '');
  const live = {};
  // 토스
  const toss = deals.filter((d) => d.source === 'toss' && /^toss_\d+$/.test(d.product_id));
  if (toss.length) {
    const secret = fs.readFileSync(path.join(os.homedir(), '.momcal_cron_secret'), 'utf8').trim();
    const ids = toss.map((d) => d.product_id.replace('toss_', '')).join(',');
    const r = await fetch(`${FN}/toss-sync?mode=detail&ids=${ids}`, { headers: { 'x-cron-secret': secret } }).then((x) => x.json());
    for (const i of r.body?.success?.items || []) live['toss_' + i.tacaId] = { price: i.displayPrice, before: i.originalPrice, dc: i.discountRate, sold: i.isSoldOut };
  }
  // 쿠팡·11번가·롯데온·지마켓
  const url = (d) => {
    const pid = String(d.product_id || '');
    if (d.source === 'coupang' && /^\d+_\d+$/.test(pid)) { const [a, b] = pid.split('_'); return `https://www.coupang.com/vp/products/${a}?itemId=${b}`; }
    if (pid.startsWith('lp_11st_')) return `https://www.11st.co.kr/products/${pid.slice(8)}`;
    if (pid.startsWith('lp_lotteon_')) return `https://www.lotteon.com/p/product/${pid.slice(11)}`;
    if (pid.startsWith('gm_')) return `https://item.gmarket.co.kr/Item?goodscode=${pid.slice(3)}`;
    return null;
  };
  const mall = deals.filter((d) => url(d));
  if (mall.length) {
    const args = ['tools/daily/mall_price.mjs', ...mall.flatMap((d) => ['--url', url(d)])];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6, timeout: 900000 });
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    for (const d of mall) {
      const hit = lines.find((x) => x.url === url(d));
      if (hit) live[d.product_id] = { price: hit.price, before: hit.before, sold: hit.soldout, note: hit.note };
    }
  }
  const fix = [];
  out.push('| id | 몰 | 카드·DB | 실측 | 판정 | 제목 |', '|---|---|---|---|---|---|');
  for (const d of deals) {
    const L = live[d.product_id];
    let v = '측정 못함';
    if (L && L.sold) v = '🔴 품절 — 카드에서 뺀다';
    else if (L && L.price != null) {
      if (L.price === d.price) v = '✅ 일치';
      else if (cond(d.title)) v = `🟡 조건가(제목: ${(d.title.match(/쿠폰|카드|와우|회원|결제가|적용가|즉시|청구|선착순/) || [''])[0]}) — 사람이 확인`;
      else { v = `🔴 다름 → ${L.price}`; fix.push({ id: d.id, price: L.price, before: d.price_before, dc: L.dc }); }
    }
    out.push(`| ${d.id} | ${d.mall} | ${d.price} | ${L?.price ?? '-'} | ${v} | ${String(d.title).slice(0, 34)} |`);
  }
  if (fix.length && APPLY) {
    for (const f of fix) {
      const before = f.before || 0;
      const dc = f.dc ?? (before > f.price ? Math.round((1 - f.price / before) * 100) : null);
      sql(`update public.hotdeals set price = ${f.price}${dc != null ? `, discount_rate = ${dc}` : ''} where id = ${f.id} returning id;`);
    }
    out.push('', `🔧 가격 ${fix.length}건을 실측값으로 고쳤다.`);
  } else if (fix.length) out.push('', `🔴 가격이 다른 ${fix.length}건 — --apply 로 고친다.`);
  out.push('');
}

const file = path.join(ROOT, 'scratchpad', `card_preflight_${kst}.md`);
fs.writeFileSync(file, out.join('\n'));
console.log(out.join('\n'));
console.log('\n→', file);

// 🔎 오픈 연기·당김 감지 — 월간 라인업(insta_cal·인포크)으로 등록한 공구가, 이후 셀러가 올린 「M/D OPEN」 글과 날짜가 다른지 본다
//   사고 2026-10-15: 소소하우스 드시모네 유산균 — 10/1 라인업은 10/12 였고 10/12 오픈글에서 10/15 로 연기됐는데
//   DB 는 10/12~10/15 그대로 → 오픈 당일 아침 「오늘 마감」 으로 떴다. card_preflight 의 verify_rows 는 인포크만 보고
//   피드 오픈글은 안 봤다(인포크에 그 상품 블록이 없으면 확인불가로 지나간다).
//
// 실행: node tools/daily/postpone_check.mjs [--days=10] [--apply]
//   (자동 수정 없음 — 2026-10-15 실측: 후보 38건 중 실제 연기·당김은 5건. 나머지는 「10/12~10/15 오픈」 범위 끝·다른 상품·옛 글)
// 입력: Supabase gonggu(승인·진행/예정) + scratchpad/ig_feed/*.jsonl(최근 N일 셀러 피드 캡션)
// 출력: scratchpad/postpone_check_<날짜>.md  ·  카드 보내기 전 규칙 0-V 의 한 단계로 돌린다
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '--days=10').split('=')[1]);
const kstNow = new Date(Date.now() + 9 * 3600e3);
const today = kstNow.toISOString().slice(0, 10);
const Y = Number(today.slice(0, 4));
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400e3);

function sql(q) {
  const f = path.join(os.tmpdir(), `_pp_${Date.now()}.sql`);
  fs.writeFileSync(f, q);
  const r = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json', '-f', f], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64e6 });
  fs.unlinkSync(f);
  const j = JSON.parse(r.slice(r.indexOf('{')));
  return j.rows || j;
}

const rows = sql(`select id, name, insta, open_date, end_date, source from public.gonggu
  where approved = true and insta is not null and insta <> '' and end_date >= '${addDays(today, -1)}' and open_date <= '${addDays(today, 14)}' order by id;`);

// 피드 — 핸들별 최근 글
const posts = new Map();
const feedDir = path.join(ROOT, 'scratchpad', 'ig_feed');
const files = fs.readdirSync(feedDir).filter((f) => f.endsWith('.jsonl')).sort().slice(-(DAYS + 2));
for (const f of files) {
  for (const l of fs.readFileSync(path.join(feedDir, f), 'utf8').split('\n')) {
    if (!l) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (!o.u || !o.cap || o.cap.length < 20) continue;
    if (!posts.has(o.u)) posts.set(o.u, new Map());
    posts.get(o.u).set(o.code + ':' + o.cap.length, o);
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
// 「10/15일(목) 오전 10시 OPEN」 · 「10/15 10시 오픈」 · 「10월 15일 오픈」 — 한 글에서 OPEN 줄에 붙은 날짜만
const OPEN_RE = /(\d{1,2})\s*[\/월.]\s*(\d{1,2})\s*일?\s*\(?[월화수목금토일]?\)?\s*(?:오전|오후|저녁|밤)?\s*\d{0,2}\s*시?\s*(?:정각)?\s*(?:OPEN|오픈|open)/g;

const out = [`# 오픈 연기·당김 감지 — ${today}`, '', '| id | 셀러 | 상품 | DB | 셀러 글(작성일·코드) | 판정 | 글 첫줄 / OPEN 줄 |', '|---|---|---|---|---|---|---|'];
const fixes = [];
for (const r of rows) {
  const ps = posts.get(r.insta);
  if (!ps) continue;
  const key = norm(r.name);
  if (key.length < 3) continue;
  const hits = [];
  for (const o of ps.values()) {
    const capN = norm(o.cap);
    // 상품명 전체 또는 앞 4글자(브랜드)가 글에 있어야 한다
    if (!(capN.includes(key) || capN.includes(key.slice(0, 4)))) continue;
    const lines = o.cap.split('\n').filter((x) => /OPEN|오픈|open/.test(x));
    const dates = new Set();
    for (const ln of lines) {
      for (const m of ln.matchAll(OPEN_RE)) {
        const mm = String(m[1]).padStart(2, '0'), dd = String(m[2]).padStart(2, '0');
        if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) dates.add(`${Y}-${mm}-${dd}`);
      }
    }
    if (dates.size) hits.push({ t: o.t, code: o.code, dates: [...dates], snip: lines.slice(0, 2).join(' / ').replace(/\s+/g, ' ').slice(0, 110), head: o.cap.split('\n')[0].slice(0, 50) });
  }
  if (!hits.length) continue;
  hits.sort((a, b) => b.t.localeCompare(a.t));
  const last = hits[0];
  if (last.dates.includes(r.open_date)) continue; // 일치
  // 글 날짜가 DB 오픈일에서 너무 멀면 다른 차수일 수 있다 — 21일 넘게 차이는 보고만
  const d = last.dates.length === 1 ? last.dates[0] : null;
  const far = d ? Math.abs(diffDays(d, r.open_date)) > 14 : true;
  let v = d ? (far ? '⚠ 14일↑ 차이 — 다른 차수일 수 있어 사람이 본다' : `🔴 ${d} 로 옮김`) : `⚠ 날짜 여럿(${last.dates.join(',')}) — 사람이 본다`;
  out.push(`| ${r.id} | ${r.insta} | ${String(r.name).slice(0, 22)} | ${r.open_date}~${r.end_date} (${r.source}) | ${last.t} ${last.code} → ${last.dates.join(',')} | ${v} | ${last.head} / ${last.snip} |`);
  if (d && !far) fixes.push({ id: r.id, old_open: r.open_date, old_end: r.end_date, new_open: d, new_end: addDays(d, diffDays(r.end_date, r.open_date)) });
}
out.push('', `대상 ${rows.length}행 · 피드 보유 셀러 ${posts.size} · 옮길 것 ${fixes.length}건`);
if (fixes.length) out.push('→ 자동으로 고치지 않는다. 글 원문을 열어 상품·날짜를 확인한 뒤 손으로 고친다(범위 끝 날짜·다른 상품·옛 글 오탐이 많다).');
const file = path.join(ROOT, 'scratchpad', `postpone_check_${today}.md`);
fs.writeFileSync(file, out.join('\n'));
console.log(out.join('\n'));
console.log('\n→', file);

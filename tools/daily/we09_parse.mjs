// 공구연구소(we09.lab) 데일리 목록 → "상품명 | 핸들" 파싱 (2026-09-16 신설, 공구줍줍 파서와 같은 자리)
//
// we09.lab 은 매일 아침 "9/16(수) 오늘 오픈하는 공구 66건 📋 카테고리별로 정리했어요 (1/5페이지, 14건)" 형식으로
// 게시물 여러 장에 "- 상품명 | 핸들" 줄을 나열한다. 공구줍줍과 달리 **인스타 핸들이 그대로** 적혀 있어 한글명→핸들 조회가 필요 없다.
// 이 캡션은 상품 하나짜리 글이 아니라서 ig_feed_to_table 이 "상품명 불확실" 로 버린다 → 전용 파서.
//
// 흐름
//   1. ig_feed_sweep 이 쌓은 jsonl 에서 u=we09.lab 이고 "N/N(요일) 오늘 오픈하는 공구" 인 글을 찾는다
//   2. "- 상품명 | @핸들" 줄을 뽑는다. 오픈일 = 제목의 날짜, 마감 = +3 (셀러 원본에 마감이 있으면 게이트 뒤 사람이 고친다)
//   3. 핸들이 DB(gonggu.insta) 에 이미 있는 셀러만 승인표로 낸다 — 규칙 8(집계 사이트는 단서): 처음 보는 핸들은 보류 파일로 빼서
//      세션이 인스타·인포크 원본을 확인한 뒤 넣는다
//   4. DB 에 없는 것만 승인표(md)로 낸다 — 등록은 we09_round.sh 가 공구줍줍과 같은 게이트를 태운다
//
// 실행: node tools/daily/we09_parse.mjs <출력.md>   (예약작업 momcal-we09, 매일 08:10·13:10)
// 상태: scratchpad/we09_seen.txt (처리한 게시물 코드) · 보류: scratchpad/we09/보류_<날짜>.md
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DIR = process.env.WE09_DIR || path.join(ROOT, 'scratchpad', 'ig_feed');
const SEEN = path.join(ROOT, 'scratchpad', 'we09_seen.txt');
const TMP = path.join(ROOT, 'scratchpad', '_we09.sql');
const HOLD_DIR = path.join(ROOT, 'scratchpad', 'we09');
const outF = process.argv[2] || path.join(ROOT, 'scratchpad', `승인대기_we09_${Date.now()}.md`);
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);

// ── 1. 목록 게시물 찾기 ──
const TITLE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\(\s*[월화수목금토일]\s*\)\s*오늘\s*오픈하는\s*공구/;
const posts = [];
for (const f of readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-3))
  for (const line of readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j.u === 'we09.lab' && !seen.has(j.code) && TITLE.test(j.cap || '')) posts.push(j); } catch {}
  }
if (!posts.length) { console.log('처리할 공구연구소 목록글 없음'); process.exit(0); }

// ── 2. "- 상품 | 핸들" 조각 ──
const items = [];
for (const p of posts) {
  const dm = p.cap.match(TITLE);
  const open = `${today.slice(0, 4)}-${String(+dm[1]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`;
  appendFileSync(SEEN, p.code + '\n');
  if (open < addDays(today, -3) || open > addDays(today, 30)) continue;
  for (const m of p.cap.matchAll(/-\s*([^|\n]{2,60}?)\s*\|\s*@?([A-Za-z0-9_.]{3,30})/g)) {
    const name = m[1].replace(/[^\p{L}\p{N}\s&+·.,\/'\-()]/gu, ' ').replace(/\s+/g, ' ').trim();
    const handle = m[2].replace(/\.$/, '');
    if (name.length < 2 || !/[가-힣A-Za-z]{2,}/.test(name)) continue;
    items.push({ name, handle, open, end: addDays(open, 3) });
  }
}
// 같은 목록이 두 게시물(캐러셀·재업)에 반복되므로 (핸들, 상품명, 오픈일) 로 한 번만
const uniq = new Map();
for (const i of items) uniq.set(`${i.handle}|${i.name}|${i.open}`, i);
const list = [...uniq.values()];
if (!list.length) { console.log('조각 0건'); process.exit(0); }

// ── 3. 아는 셀러(DB 에 핸들이 있는 셀러)만 통과, 처음 보는 핸들은 보류 ──
const handles = [...new Set(list.map(i => i.handle))];
writeFileSync(TMP, `with h(v) as (values ${handles.map(h => `($q$${h}$q$)`).join(',')})
select h.v as h, (select g.influencer from gonggu g where g.insta = h.v and coalesce(g.influencer,'')<>'' group by g.influencer order by count(*) desc limit 1) as nm,
       exists(select 1 from gonggu g where g.insta = h.v) as known from h;`, 'utf8');
const known = {}; const nameOf = {};
try {
  const out = execFileSync(SB, sbArgs(TMP), { encoding: 'utf8', timeout: 180000, cwd: ROOT });
  const pr = parseRows(out);   // 터미널은 {rows:[…]}, 예약작업은 최상위 배열 — 공용 파서가 둘 다 읽는다
  if (!pr.ok) throw new Error('CLI 출력을 못 읽었다: ' + pr.why);
  for (const r of pr.rows) { known[r.h] = !!r.known; if (r.nm) nameOf[r.h] = r.nm; }
} catch (e) { console.error('🔴 핸들 조회 실패 —', String(e.message).slice(0, 90)); process.exit(1); }

const ok = list.filter(i => known[i.handle]);
const hold = list.filter(i => !known[i.handle]);
mkdirSync(HOLD_DIR, { recursive: true });
if (hold.length) {
  const hf = path.join(HOLD_DIR, `보류_${today}.md`);
  if (!existsSync(hf)) writeFileSync(hf, '## 공구연구소 — 처음 보는 핸들 (세션이 인스타·인포크 원본 확인 후 등록)\n| # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 |\n|---|---|---|---|---|---|---|---|\n');
  let k = 0; appendFileSync(hf, hold.map(i => `| ${++k} |  | ${i.name} | ${i.open} | ${i.end} |  |  | ${i.handle} |`).join('\n') + '\n');
}
if (!ok.length) { console.log(`아는 셀러 항목 0 (처음 보는 핸들 ${hold.length}: ${[...new Set(hold.map(i => i.handle))].join(' ')})`); process.exit(0); }

// ── 4. 승인표 ──
let n = 0;
const lines = ['## 공구연구소(we09.lab) 데일리 (자동 파싱 — 분류는 게이트가 채운다)',
  '| # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 |', '|---|---|---|---|---|---|---|---|'];
for (const i of ok) lines.push(`| ${++n} | ${nameOf[i.handle] || ''} | ${i.name} | ${i.open} | ${i.end} |  |  | ${i.handle} |`);
writeFileSync(outF, lines.join('\n') + '\n');
console.log(`✅ 공구연구소 ${posts.length}글 → 항목 ${list.length} · 아는 셀러 ${ok.length} · 처음 보는 핸들 ${hold.length} → ${path.relative(ROOT, outF)}`);
if (hold.length) console.log('   처음 보는 핸들: ' + [...new Set(hold.map(i => i.handle))].join(' '));

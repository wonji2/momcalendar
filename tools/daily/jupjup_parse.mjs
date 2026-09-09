// 공구줍줍(gonggu_jupjup) 데일리 일정 게시물 → "셀러 한글명 + 상품명" 목록 파싱
// (사장님 2026-09-09 "매일 알아서 파싱하고 돌아야지 24시간 내내")
//
// 공구줍줍은 매일 저녁 다음날 오픈을 **셀러 한글명과 함께** 한 게시물에 나열한다.
//   "…책육아도서 음률  사랑이맘 튤립 사운드북 14일 마감  현명맘 별똥별 나의 자연수첩  미니똘 훈민2배로스티커북 11일 마감 …"
// 이 캡션은 상품 하나짜리 글이 아니라서 ig_feed_to_table 이 못 다룬다 → 전용 파서.
//
// 흐름
//   1. ig_feed_sweep 이 쌓은 jsonl 에서 u=gonggu_jupjup 이고 "N월 N일 공구 오픈 일정" 인 글을 찾는다
//   2. 카테고리 머리말(책육아도서·아기의류…)을 구분자로 잘라 "셀러명 상품명 [N일 마감]" 조각을 만든다
//   3. 셀러 한글명 → DB 최빈 insta 로 핸들을 찾는다. **핸들을 못 찾으면 버린다**(규칙 8: 확인 안 된 값은 안 넣는다)
//   4. DB 에 없는 것만 승인표(md)로 낸다 — 등록은 ig_feed_pipeline 과 같은 게이트를 태운다
//
// 실행: node tools/daily/jupjup_parse.mjs <출력.md>   (예약작업 momcal-jupjup, 매일 21:40·07:40)
// 상태: scratchpad/jupjup_seen.txt (처리한 게시물 코드)
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DIR = process.env.JUP_DIR || path.join(ROOT, "scratchpad", "ig_feed");
const SEEN = path.join(ROOT, 'scratchpad', 'jupjup_seen.txt');
const TMP = path.join(ROOT, 'scratchpad', '_jupjup.sql');
const outF = process.argv[2] || path.join(ROOT, 'scratchpad', `승인대기_jupjup_${Date.now()}.md`);
const KST = () => new Date(Date.now() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);

// ── 1. 일정 게시물 찾기 ──
const posts = [];
for (const f of readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-3))
  for (const line of readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const j = JSON.parse(line); if (j.u === 'gonggu_jupjup' && !seen.has(j.code) && /\d{1,2}월\s*\d{1,2}일\s*공구\s*오픈\s*일정/.test(j.cap || '')) posts.push(j); } catch { }
  }
if (!posts.length) { console.log('처리할 공구줍줍 일정글 없음'); process.exit(0); }

// ── 2. 조각 내기 ──
// 캡션은 **한 줄에 한 건**이다: "🔸 사랑이맘 · 튤립 사운드북 (14일 마감)"
// 카테고리 줄("📚 책육아도서 · 음률")은 낱말이 짧고 …템/도서/의류/먹거리/양말/음률 로 끝난다 → 건너뛴다
const CAT_LINE = /^(책육아|도서|음률|아기의류|의류|양말|먹거리|교구|육아노하우|뷰티|가구|대근육|놀이|스스로|여행|외출|생활|안전|수면|영양제|간식|주방|살림|청소|위생|기저귀|목욕|이유식|유아식|기타)/;
const items = [];
for (const p of posts) {
  const dm = p.cap.match(/(\d{1,2})월\s*(\d{1,2})일\s*공구\s*오픈\s*일정/);
  if (!dm) continue;
  const open = `${today.slice(0, 4)}-${String(+dm[1]).padStart(2, '0')}-${String(+dm[2]).padStart(2, '0')}`;
  appendFileSync(SEEN, p.code + '\n');
  if (open < addDays(today, -3) || open > addDays(today, 30)) continue;
  const body = p.cap.split(/찾으시는 공구가 있다면|찾는 공구 요청은|현재 확인된 공구 기준/)[0]
    .replace(/^[\s\S]*?공구\s*오픈\s*일정/, '').replace(/[#@]\S+/g, ' ');
  for (let line of body.split('\n')) {
    line = line.replace(/[^\p{L}\p{N}\s&+·.,\/'\-()]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 4) continue;
    // 마감일: "(14일 마감)"
    let end = null;
    const em = line.match(/\(?\s*(\d{1,2})\s*일\s*마감\s*\)?/);
    if (em) { end = `${today.slice(0, 4)}-${open.slice(5, 7)}-${String(+em[1]).padStart(2, '0')}`; line = line.replace(em[0], '').trim(); }
    const parts = line.split(/[\s·]+/).filter(Boolean);
    if (parts.length < 2) continue;                       // 셀러만 있고 상품이 없다
    const seller = parts[0].replace(/[.,·]/g, '');
    if (!/^[가-힣0-9]{2,8}$/.test(seller)) continue;      // 셀러 한글명 자리가 아니다
    if (CAT_LINE.test(seller)) continue;                  // 카테고리 줄
    const name = parts.slice(1).join(' ').replace(/^[·.,\s]+|[·.,\s]+$/g, '');
    if (name.length < 2 || name.length > 30 || !/[가-힣A-Za-z]{2,}/.test(name)) continue;
    if (CAT_LINE.test(name) && parts.length === 2) continue;
    // 마감이 오픈보다 앞서면(달 넘김) 다음 달로
    let e = end;
    if (e && e < open) { const d = new Date(open + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); e = d.toISOString().slice(0, 8) + end.slice(8); }
    items.push({ seller, name, open, end: e });
  }
}
if (!items.length) { console.log('조각 0건'); process.exit(0); }

// ── 3. 셀러 한글명 → 핸들 ──
const names = [...new Set(items.map(i => i.seller))];
writeFileSync(TMP, `with n(nm) as (values ${names.map(n => `($q$${n}$q$)`).join(',')})
select n.nm, (select g.insta from gonggu g where g.influencer = n.nm group by g.insta order by count(*) desc limit 1) as h from n;`, 'utf8');
let map = {};
try {
  const out = execFileSync(SB, sbArgs(TMP), { encoding: 'utf8', timeout: 180000, cwd: ROOT });
  // 터미널은 {rows:[…]}, 예약작업은 최상위 배열로 준다 — 공용 파서가 둘 다 읽는다 (2026-09-09 사고)
  const pr = parseRows(out);
  if (!pr.ok) throw new Error('CLI 출력을 못 읽었다: ' + pr.why);
  for (const r of pr.rows) if (r.h) map[r.nm] = r.h;
} catch (e) { console.error('🔴 핸들 조회 실패 —', String(e.message).slice(0, 90)); process.exit(1); }

const withH = items.filter(i => map[i.seller]);
const noH = items.filter(i => !map[i.seller]);
if (!withH.length) { console.log(`핸들 있는 항목 0 (미상 ${noH.length}: ${[...new Set(noH.map(n => n.seller))].join(' ')})`); process.exit(0); }

// ── 4. 승인표 ──
let n = 0;
const lines = ['## 공구줍줍 데일리 (자동 파싱 — 분류는 사람/게이트가 채운다)',
  '| # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 |', '|---|---|---|---|---|---|---|---|'];
for (const i of withH) lines.push(`| ${++n} | ${i.seller} | ${i.name} | ${i.open} | ${i.end || addDays(i.open, 3)} |  |  | ${map[i.seller]} |`);
writeFileSync(outF, lines.join('\n') + '\n');
console.log(`✅ 공구줍줍 ${posts.length}글 → 항목 ${items.length} · 핸들확인 ${withH.length} · 셀러미상 ${noH.length} → ${path.relative(ROOT, outF)}`);
if (noH.length) console.log('   셀러 미상: ' + [...new Set(noH.map(x => x.seller))].join(' '));

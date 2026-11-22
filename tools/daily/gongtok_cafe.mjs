// 공구톡톡 카페(clubid 31368521) 목록 API → 제목에서 상품·오픈일 → DB 에 없는 것만 후보로
// (사장님 2026-09-09 "시켜야만 하지 말고 매일 알아서 파싱하고 돌아야지 24시간 내내")
//
// 흐름
//   1. 목록 API 를 페이지 N까지 읽는다 (로그인 불필요, 검색 API 의 10배 — 메모리 cafe-list-api-direct)
//   2. 제목 형식 "상품명 (9월8일 open)" 에서 상품명·오픈일을 뽑는다. 질문·후기·인사 글은 버린다
//   3. DB 와 대조해 **없는 것만** 남긴다 (첫 낱말 = 브랜드 기준 ±3일)
//   4. 카페 글에는 **셀러가 없다** → 등록하지 않고 후보 파일에만 쌓는다.
//      셀러를 아는 경로(인스타 스윕·공구줍줍)가 같은 상품을 물어오면 그쪽이 등록한다.
//      규칙 8: 단서는 단서일 뿐, 등록은 셀러 원본을 확인한 것만.
//
// 실행: node tools/daily/gongtok_cafe.mjs [페이지수]   (예약작업 momcal-gongtok, 2시간마다)
// 출력: scratchpad/gongtok/<날짜>.md (누적, 처음 본 글만) · 상태 scratchpad/gongtok_state.json · seen scratchpad/gongtok_seen.txt
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const OUT_DIR = path.join(ROOT, 'scratchpad', 'gongtok');
const STATE = path.join(ROOT, 'scratchpad', 'gongtok_state.json');
const SEEN = path.join(ROOT, 'scratchpad', 'gongtok_seen.txt');
const TMP = path.join(ROOT, 'scratchpad', '_gongtok.sql');
const CLUB = '31368521';
const PAGES = Number(process.argv[2] || 3);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131';
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const today = () => KST().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

mkdirSync(OUT_DIR, { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { runs: 0 };
const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).filter(Boolean) : []);
const save = (p) => { Object.assign(state, p, { lastRun: KST() }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };

// ── 1. 목록 API ──
let raw = '';
for (let p = 1; p <= PAGES; p++) {
  const url = `https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json?search.clubid=${CLUB}&search.boardtype=L&search.page=${p}&search.perPage=50`;
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://cafe.naver.com/gongz' } });
    raw += await r.text();
  } catch (e) { save({ lastErr: String(e).slice(0, 120) }); }
  await new Promise(r => setTimeout(r, 1200));
}
if (!raw) { save({ lastErr: '목록 API 응답 없음' }); console.error('🔴 목록 API 응답 없음'); process.exit(1); }

// ── 2. 제목 파싱 ──
const QUESTION = /있나요|있을까요|찾아요|어디|문의|후기|안녕하세요|날씨와 운세|가입|등업|인사|추천해|알려주|공구예정|해주세요/;
const arts = []; const got = new Set();
for (const m of raw.matchAll(/"articleId":(\d+)/g)) {
  const id = +m[1]; if (got.has(id)) continue;
  const s = raw.slice(m.index, m.index + 900).match(/"subject":"((?:[^"\\]|\\.)*)"/);
  if (!s) continue;
  let subj; try { subj = JSON.parse('"' + s[1] + '"'); } catch { continue; }
  got.add(id); arts.push({ id, subj });
}
const rows = [];
for (const a of arts) {
  if (seen.has(String(a.id)) || QUESTION.test(a.subj)) continue;
  const d = a.subj.match(/\(\s*(\d{1,2})월\s*(\d{1,2})일[^)]*?(open|오픈)/i);
  if (!d) continue;
  const open = `${today().slice(0, 4)}-${String(+d[1]).padStart(2, '0')}-${String(+d[2]).padStart(2, '0')}`;
  if (open < addDays(today(), -3) || open > addDays(today(), 90)) continue;
  let name = a.subj.replace(/\([^)]*\)\s*$/, '').replace(/^\[[^\]]*\]\s*/, '').trim()
    .replace(/\s*(공구\s*오픈|공구오픈|공구|오픈|OPEN)\s*$/i, '')
    .replace(/[^\p{L}\p{N}\s&+·.,\/'\-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 40) continue;
  rows.push({ id: a.id, name, open });
}

// ── 3. DB 대조 (첫 낱말 = 브랜드, ±3일) ──
let fresh = rows;
if (rows.length) {
  const vals = rows.map(r => `(${r.id},$q$${r.name.replace(/\$/g, '')}$q$,$q$${r.open}$q$)`).join(',');
  writeFileSync(TMP, `with c(cid,nm,od) as (values ${vals})
select c.cid from c where not exists (
  select 1 from gonggu g
  where abs(to_date(g.open_date,'YYYY-MM-DD') - to_date(c.od,'YYYY-MM-DD')) <= 3
    and ( lower(regexp_replace(g.name,'[^0-9A-Za-z가-힣]','','g')) like '%'||lower(regexp_replace(split_part(c.nm,' ',1),'[^0-9A-Za-z가-힣]','','g'))||'%'
       or lower(regexp_replace(c.nm,'[^0-9A-Za-z가-힣]','','g')) like '%'||lower(regexp_replace(split_part(g.name,' ',1),'[^0-9A-Za-z가-힣]','','g'))||'%' ));`, 'utf8');
  try {
    const out = execFileSync(SB, sbArgs(TMP), { encoding: 'utf8', timeout: 180000, cwd: ROOT });
    // 터미널은 {rows:[…]}, 예약작업은 최상위 배열로 준다 — 공용 파서가 둘 다 읽는다 (2026-09-09 사고)
    const pr = parseRows(out);
    if (!pr.ok) throw new Error('CLI 출력을 못 읽었다: ' + pr.why);
    const keep = new Set(pr.rows.map(r => Number(r.cid)).filter(Number.isFinite));
    fresh = rows.filter(r => keep.has(r.id));
  } catch (e) { save({ lastErr: 'DB 대조 실패: ' + String(e.message).slice(0, 100) }); console.error('🔴 DB 대조 실패 — 후보를 남기지 않는다'); process.exit(1); }
}

// ── 4. 후보 파일 ──
const day = today();
const out = path.join(OUT_DIR, `${day}.md`);
if (fresh.length && !existsSync(out)) writeFileSync(out, `## 공구톡톡 카페 단서 ${day} (자동 · DB 에 없는 것만 · 셀러 미상이라 등록 전 셀러 확인 필요)\n| 시각 | 상품(카페 제목) | 오픈 | 카페글 |\n|---|---|---|---|\n`);
for (const r of fresh) appendFileSync(out, `| ${KST().slice(11, 16)} | ${r.name.replace(/\|/g, '｜')} | ${r.open} | cafe.naver.com/gongz/${r.id} |\n`);
appendFileSync(SEEN, rows.map(r => r.id).join('\n') + (rows.length ? '\n' : ''));
save({ runs: (state.runs || 0) + 1, lastArts: arts.length, lastDated: rows.length, lastFresh: fresh.length, lastErr: null });
console.log(`✅ 카페글 ${arts.length} · 날짜있는 공구글 ${rows.length} · DB 에 없는 단서 ${fresh.length}`);

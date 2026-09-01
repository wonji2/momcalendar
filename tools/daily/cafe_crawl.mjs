// 맘캘린더 카페 자동 크롤링 (사장님 지시 2026-08-21)
//   "여기 게시글 번호 읽어서 여기로 가게 지금 하는거 자동화해줘 크롤링도 내가 매일 해야해서 귀찮아"
//
// 하는 일 (admin.html 🕷️크롤링>네이버카페 수동 흐름의 무인판):
//   1. cafe-lookup 엣지함수로 카페(31499187) 최근 글 목록을 받는다 (제목+글번호)
//   2. 제목이 공구 일정 형식("8/21~8/23 상품명 공구" · "(8/21오픈) 상품명")인 것만 고른다
//   3. 새 글(마지막 처리 번호 이후)을 파싱해 gonggu 에 등록 — pay_link = 카페 글 (카드 클릭 시 카페로)
//   4. 이미 DB에 있는 공구면: pay_link 가 비어 있을 때만 카페 글 번호를 붙인다 (있는 링크는 안 건드림)
//   5. 분류를 못 찍은 건 등록하지 않고 로그에 남긴다 (CLAUDE.md 1-c: 모호하면 드롭)
//
// 실행: node tools/daily/cafe_crawl.mjs          (예약작업 momcal-cafe-crawl 이 2시간마다 부른다)
// 상태: scratchpad/cafe_last_id.txt (마지막 처리 글번호) · 로그: scratchpad/cafe_crawl_log.txt
// ⚠ supabase CLI 인증(--linked)에 의존한다. Claude 앱과 무관하게 돈다.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const STATE = join(ROOT, 'scratchpad', 'cafe_last_id.txt');
const LOG = join(ROOT, 'scratchpad', 'cafe_crawl_log.txt');
const VOCAB = join(ROOT, 'scratchpad', 'catvocab.json');
const log = (s) => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(LOG, `[${t}] ${s}\n`); console.log(s); };

// ── 날짜 (KST 기준 — 2026-08-20 교훈: 날짜를 손으로 박지 않는다) ──
const _now = new Date(Date.now() + 9 * 3600e3);
const Y = _now.getUTCFullYear();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = `${Y}-${pad(_now.getUTCMonth() + 1)}-${pad(_now.getUTCDate())}`;
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n)); return t.toISOString().slice(0, 10); };

// ── 제목 → {name, open, end} (admin parseNaverCafe 와 같은 사상 + 실제 카페 형식) ──
function parseTitle(subj) {
  let s = subj.replace(/\s+/g, ' ').trim(), m;
  const tail = (x) => x.replace(/\s*공구\s*(오픈)?\s*$/,'').replace(/\s*최저가\s*$/,'').trim();
  // "8/21~8/23 상품명 공구" · "(8/21~8/23) 상품명"
  if ((m = s.match(/^\(?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[~\-]\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\)?\s+(.+)$/))) {
    const open = `${Y}-${pad(+m[1])}-${pad(+m[2])}`;
    const ey = (+m[3] < +m[1]) ? Y + 1 : Y;
    return { open, end: `${ey}-${pad(+m[3])}-${pad(+m[4])}`, name: tail(m[5]) };
  }
  // "(8/21오픈) 상품명 공구" / "(8/21 오픈) ..."
  if ((m = s.match(/^\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*일?\s*오픈\s*\)\s*(.+)$/))) {
    const open = `${Y}-${pad(+m[1])}-${pad(+m[2])}`;
    return { open, end: addDays(open, 3), name: tail(m[3]) };
  }
  // "(8/21마감) 상품명" — 오픈은 오늘
  if ((m = s.match(/^\(\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*일?\s*마감\s*\)\s*(.+)$/))) {
    return { open: todayStr, end: `${Y}-${pad(+m[1])}-${pad(+m[2])}`, name: tail(m[3]) };
  }
  return null;  // 날짜 형식이 없으면 공구 일정 글이 아니다 (가입인사·질문·정보글)
}

// ── 분류: DB 낱말사전(catvocab.json) — harvest_to_table 과 같은 사상. 못 찍으면 등록 안 함 ──
// 파일은 supabase CLI 응답 그대로라 rows 배열([{tok,major,minor,tot}...])을 꺼내 쓴다.
const vocabRows = JSON.parse(readFileSync(VOCAB, 'utf8').match(/\[[\s\S]*\]/)[0]);
const vocab = {};
for (const v of vocabRows) if (!vocab[v.tok] || v.tot > vocab[v.tok].tot) vocab[v.tok] = v;
function guessCat(name) {
  const words = name.toLowerCase().split(/[^가-힣a-z0-9]+/).filter(w => w.length >= 2);
  let best = null;
  for (const w of words) {
    const v = vocab[w];
    if (v && (!best || v.tot > best.tot)) best = v;
  }
  return best ? { major: best.major, minor: best.minor } : null;
}

// ── 메인 ──
const r = await fetch('https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/cafe-lookup?pages=2', { headers: { connection: 'close' } });
const j = await r.json();
if (!j.ok) { log(`🔴 cafe-lookup 실패: ${JSON.stringify(j).slice(0, 120)}`); process.exit(1); }
const lastId = existsSync(STATE) ? Number(readFileSync(STATE, 'utf8').trim()) : 0;
const items = j.items.filter(x => x.id > lastId).sort((a, b) => a.id - b.id);
if (!items.length) { console.log('새 글 없음'); setTimeout(() => process.exit(0), 300); await new Promise(() => {}); }

const rows = [], skipped = [], noCat = [];
for (const it of items) {
  const p = parseTitle(it.subj);
  if (!p) { skipped.push(`${it.id} ${it.subj.slice(0, 40)}`); continue; }
  if (!p.name || p.name.length < 2) { skipped.push(`${it.id} 상품명없음`); continue; }
  if (p.end < todayStr) { skipped.push(`${it.id} 마감지남 ${p.name}`); continue; }
  const cat = guessCat(p.name);   // 분류는 '신규 등록'에만 필요. 기존 행 카페연결은 분류 없이 한다.
  if (!cat) noCat.push(`${it.id} ${p.name} (${p.open}~${p.end})`);
  rows.push({ id: it.id, ...p, major: cat ? cat.major : null, minor: cat ? cat.minor : null });
}

// --dry: DB 를 건드리지 않고 파싱·분류 결과만 보여준다
if (process.argv.includes('--dry')) {
  console.log('=== DRY RUN ===');
  for (const x of rows) console.log(`${x.major ? '등록후보' : '연결만(분류불가)'} ${x.id} | ${x.name} | ${x.open}~${x.end}${x.major ? ' | ' + x.major + '/' + x.minor : ''}`);
  for (const s of skipped) console.log('스킵 ' + s);
  process.exit(0);
}

let inserted = 0, linked = 0;
if (rows.length) {
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const qn = (s) => s == null ? 'null' : q(s);   // ⚠ q(null) 은 문자열 'null' 이 된다 — 분류 없는 행은 SQL null 로
  // 중복 판정은 등록 게이트와 같은 정규화(꾸밈말 제거) — 이름 일치/포함 + 오픈일 ±3일
  const NORM = (col) => `lower(regexp_replace(regexp_replace(${col},'([0-9]+차|초특가|특가|모음전|기획전|국산|신상|NEW|한정|공구)','','g'),'[[:space:]·._&/,!+()\\[\\]''"-]','','g'))`;
  const vals = rows.map(x => `(${q(x.name)},${q(x.open)},${q(x.end)},${qn(x.major)},${qn(x.minor)},${q('https://cafe.naver.com/momcal/' + x.id)})`).join(',\n');
  const sql = `
with v(name, open_date, end_date, major, minor, cafe_url) as (values\n${vals}\n),
d as (  -- 이미 DB에 있는 같은 공구 (이름 정규화 일치/포함 + 오픈일 ±3일)
  select v.*, g.id gid, g.pay_link gpay
  from v join gonggu g
    on g.open_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
   -- 오픈일만 보면 샌다(2026-09-01 사고): 카페 글은 기간을 길게 적고(8/26~9/2)
   -- 셀러는 짧게 올린다(8/30~9/2). 오픈일은 4일 차라 창 밖인데 마감일이 같은 한 공구다.
   -- 그래서 오픈일 또는 마감일 중 하나라도 3일 이내면 같은 공구로 본다.
   and (abs(g.open_date::date - v.open_date::date) <= 3
     or (g.end_date ~ '^\\d{4}-\\d{2}-\\d{2}$' and abs(g.end_date::date - v.end_date::date) <= 3))
   and (${NORM('g.name')} = ${NORM('v.name')}
     or (length(${NORM('v.name')}) >= 4 and ${NORM('g.name')} like '%'||${NORM('v.name')}||'%')
     or (length(${NORM('g.name')}) >= 4 and ${NORM('v.name')} like '%'||${NORM('g.name')}||'%'))
),
upd as (  -- 기존 행: pay_link 가 비어 있을 때만 카페 글을 붙인다
  update gonggu g set pay_link = d.cafe_url from d
  where g.id = d.gid and coalesce(g.pay_link,'') = ''
  returning g.id
),
ins as (
  insert into gonggu (name, open_date, end_date, major, minor, pay_link, influencer, insta, approved, cat_manual)
  select v.name, v.open_date, v.end_date, v.major, v.minor, v.cafe_url, '', '', true, true
  from v where v.major is not null
    and not exists (select 1 from d where d.name = v.name and d.open_date = v.open_date)
  returning id
)
select (select count(*) from ins) as inserted, (select count(*) from upd) as linked;`;
  const f = join(ROOT, 'scratchpad', '_cafe_ins.sql');
  writeFileSync(f, sql);
  try {
    const out = execFileSync(SB, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', timeout: 120000 });
    const mi = out.match(/"inserted":\s*(\d+)/), ml = out.match(/"linked":\s*(\d+)/);
    inserted = mi ? +mi[1] : 0; linked = ml ? +ml[1] : 0;
  } catch (e) { log(`🔴 SQL 실패: ${String(e).slice(0, 200)}`); process.exit(1); }
}

writeFileSync(STATE, String(Math.max(...j.items.map(x => x.id))));
log(`새글 ${items.length} · 일정글 ${rows.length} → 등록 ${inserted} · 카페연결 ${linked}` +
    (noCat.length ? ` · 분류불가 ${noCat.length}건(세션에서 처리): ${noCat.join(' | ')}` : '') +
    (skipped.length ? ` · 스킵 ${skipped.length}` : ''));
// node 24 윈도우 teardown 버그(libuv async.c assert)로 정상 완료 후에도 abort 되는 것 방어 (2026-08-30)
setTimeout(() => process.exit(0), 300);

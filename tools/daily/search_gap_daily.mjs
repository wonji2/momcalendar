/**
 * 검색 실패 누적 리포트 — 매일 (사장님 지시 2026-09-01
 *   "이건 우리 웹사이트 검색에도 필수 조건이라 누적해서 학습해서 디벨롭 시켜가야해")
 *
 * 왜: 손님이 찾다가 못 찾고 나간 말이 곧 우리가 채워야 할 구멍이다.
 *     그런데 그 로그를 사람이 매번 들여다볼 수는 없다 → 매일 자동으로 훑어
 *     **원인별로 분류**해 리포트에 쌓는다. 세션은 이 파일만 보면 된다.
 *
 * 원인은 셋뿐이고, 처방이 다르다
 *   ① 데이터가 아예 없다        → 파싱 우선순위로 (그 브랜드를 찾아 넣는다)
 *   ② 있는데 다 마감됐다        → 검색이 지난 공구를 보여주므로 이제 0건이 아니다.
 *                                자주 찾으면 그 브랜드를 다시 물어올 가치가 있다
 *   ③ 있고 진행중인데 0건이었다  → 🔴 검색 로직 결함. 별칭·표기 문제일 수 있다
 *
 * 실행: node tools/daily/search_gap_daily.mjs        (예약작업 momcal-search-gap 이 매일 부른다)
 * 리포트: scratchpad/search_gap_report.md  (최신이 맨 위, 30일치 보관)
 */
import { execFileSync } from 'node:child_process';
import { sbArgs, parseRows } from './sb_query.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const REPORT = path.join(ROOT, 'scratchpad', 'search_gap_report.md');
const TMP = path.join(ROOT, 'scratchpad', '_gap_q.sql');

const runSql = (sql) => {
  writeFileSync(TMP, sql, 'utf8');
  const out = execFileSync(SB, sbArgs(TMP),
    { encoding: 'utf8', timeout: 90000, cwd: ROOT });
  // 🔴 못 읽은 것과 0건을 구분한다 — 예전엔 배열 형식에서 [] 를 조용히 돌려줬다.
  const parsed = parseRows(out);
  if (!parsed.ok) throw new Error('CLI 출력을 못 읽었다 — ' + parsed.why);
  return parsed.rows;
};

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 최근 7일간 결과 0건이었던 검색어 + 그 말이 DB 에 실제로 있는지
// 🔴 사이트가 이미 아는 별칭은 "DB 에 없음" 으로 세면 안 된다 (2026-09-01 오판).
//    '빼빼구마' 는 상품명엔 0건이지만 사이트가 룰루맘으로 바꿔 찾아준다(SEARCH_LINK).
//    그걸 모르고 "파싱해야 할 것" 으로 올려 사장님께 잘못 보고했다.
//    → index.html 의 BRAND_ALIAS·SEARCH_LINK 를 읽어 실제로 찾는 말로 바꿔 센다.
function loadAliases() {
  const map = {};
  try {
    const h = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const block of ['BRAND_ALIAS', 'SEARCH_LINK']) {
      const i = h.indexOf('const ' + block + '=');
      if (i < 0) continue;
      const seg = h.slice(i, h.indexOf('];', i));
      for (const m of seg.matchAll(/\['([^']+)','([^']+)'\]/g)) {
        map[m[1].toLowerCase()] = m[2];      // 손님이 쓰는 말 → 우리 표기
        map[m[2].toLowerCase()] = m[1];
      }
    }
  } catch (_) {}
  return map;
}
const ALIAS = loadAliases();
const asDb = (w) => ALIAS[String(w).toLowerCase()] || w;   // 별칭이 있으면 우리 표기로 바꿔 센다

const rows = runSql(`
with q as (
  select (event_data::jsonb->>'q') w, count(*) c
    from events
   where event_type='search' and visited_at > now() - interval '7 days'
     and coalesce(event_data,'') <> '' and event_data like '{%'
     and coalesce((event_data::jsonb->>'n')::int, 0) = 0
   group by 1 having count(*) >= 3
)
select q.w, q.c,
  (select count(*) from gonggu g where g.name ilike '%'||q.w||'%') total,
  (select count(*) from gonggu g where g.name ilike '%'||q.w||'%'
     and g.end_date >= to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')) live,
  (select max(g.end_date) from gonggu g where g.name ilike '%'||q.w||'%') last_end
from q where length(q.w) between 2 and 20
order by q.c desc limit 40;`);

if (!rows.length) {
  console.log('최근 7일 0건 검색어 없음 (3회 이상 기준)');
  process.exit(0);
}

// 별칭이 있는 말은 우리 표기로 다시 세어 실제 보유량을 채운다
for (const r of rows) {
  const alt = asDb(r.w);
  if (alt === r.w) continue;
  const got = runSql(`select
      (select count(*) from gonggu g where g.name ilike '%${alt.replace(/'/g, "''")}%'
         or g.influencer ilike '%${alt.replace(/'/g, "''")}%') total,
      (select count(*) from gonggu g where (g.name ilike '%${alt.replace(/'/g, "''")}%'
         or g.influencer ilike '%${alt.replace(/'/g, "''")}%')
         and g.end_date >= to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')) live;`);
  if (got[0]) { r.total = got[0].total; r.live = got[0].live; r.alias = alt; }
}

const none = rows.filter(r => Number(r.total) === 0);
const ended = rows.filter(r => Number(r.total) > 0 && Number(r.live) === 0);
const bug = rows.filter(r => Number(r.live) > 0);

const line = (r) => `- **${r.w}**${r.alias ? ' (→ ' + r.alias + ' 로 찾아줌)' : ''} · ${r.c}회 찾음` +
  (Number(r.total) ? ` · DB ${r.total}건(진행중 ${r.live}) · 마지막 마감 ${r.last_end}` : ' · DB 에 없음');

const body = [
  `## ${today}`,
  '',
  bug.length ? `### 🕐 검색한 뒤에 등록된 것 ${bug.length}건\n` +
    `손님이 찾을 땐 진행중이 없었고, 그 뒤에 우리가 넣었다. **검색 결함이 아니다**\n` +
    `(2026-09-01 에 11건 전수 확인 — 전부 지금은 정상으로 나온다).\n` +
    `같은 말이 계속 쌓이면 그 브랜드를 **더 빨리** 넣어야 한다는 뜻이다.\n` +
    bug.map(line).join('\n') + '\n' : '',
  none.length ? `### 📥 파싱해야 할 것 ${none.length}건 — DB 에 아예 없다\n` +
    none.map(line).join('\n') + '\n' : '',
  ended.length ? `### ⏳ 다시 물어올 것 ${ended.length}건 — 있는데 다 마감됐다\n` +
    `검색에서 '지난 공구' 로는 보인다. 자주 찾는 브랜드는 다음 회차를 찾아 넣을 가치가 있다.\n` +
    ended.map(line).join('\n') + '\n' : '',
  '---',
  ''
].filter(Boolean).join('\n');

// 최신이 맨 위 · 30일치만
let prev = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : '';
prev = prev.replace(/^# [^\n]*\n+/, '');
const blocks = prev.split(/\n(?=## \d{4}-\d{2}-\d{2})/).filter(b => b.trim());
const cut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const kept = blocks.filter(b => { const m = b.match(/^## (\d{4}-\d{2}-\d{2})/); return m && m[1] >= cut && m[1] !== today; });

writeFileSync(REPORT,
  '# 검색 실패 누적 (매일 자동)\n\n' +
  '손님이 찾다가 못 찾은 말. 세션은 이 파일을 보고 파싱 우선순위·별칭을 정한다.\n\n' +
  body + kept.join('\n'), 'utf8');

console.log(`0건 검색어 ${rows.length}건 → 뒤늦게등록 ${bug.length} · 미보유 ${none.length} · 마감됨 ${ended.length}`);
if (none.length) console.log('📥 파싱 우선순위: ' + none.map(r => r.w).join(', '));

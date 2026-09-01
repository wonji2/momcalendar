/**
 * 소분류 필터 이탈 감시 — 매일 (검증자 지적 2026-09-01)
 *
 * 왜: 노출 중인데 소분류가 `index.html` 의 CATS 에 없는 값이면 **어떤 칩으로도 도달할 수 없다**
 *     (칩은 CATS[major] 안에서만 그려진다). 대분류로는 보이니 아무도 못 알아챈다.
 *     2026-09-01 에 397건을 전량 정리했는데, **같은 날 다른 세션이 옛 표기로 8건을 다시 넣었다.**
 *     여러 세션이 동시에 등록하므로 사람이 기억으로 막을 수 없다 → 매일 기계가 본다.
 *
 * 🔑 CATS 를 SQL 이나 이 파일에 하드코딩하지 않는다. **index.html 에서 읽는다.**
 *    (하드코딩했다가 '방꾸미기' 를 "필터에 없음" 으로 오판한 적이 있다 — 도구가 먼저 틀렸다)
 *    그래서 pg_cron 이 아니라 윈도우 예약작업이다. DB 는 index.html 을 볼 수 없다.
 *
 * 실행: node tools/daily/cat_guard.mjs        (예약작업 momcal-cat-guard 가 매일 07:20 부른다)
 *       node tools/daily/cat_guard.mjs --dry  경보를 남기지 않고 출력만
 * 경보: health_alerts(kind='소분류필터이탈')  → 세션이 시작할 때 보는 곳
 * 로그: scratchpad/cat_guard_log.txt (최신이 맨 위)
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const TMP = path.join(ROOT, 'scratchpad', '_catguard.sql');
const LOG = path.join(ROOT, 'scratchpad', 'cat_guard_log.txt');
const DRY = process.argv.includes('--dry');

const runSql = (sql) => {
  writeFileSync(TMP, sql, 'utf8');
  // ⚠ 예약작업 cwd 는 System32 다 → --linked 가 프로젝트를 찾도록 cwd 를 레포 루트로 준다
  const out = execFileSync(SB, ['db', 'query', '--linked', '-f', TMP], { encoding: 'utf8', timeout: 120000, cwd: ROOT });
  const i = out.indexOf('"rows"');
  if (i < 0) return [];
  const j = out.lastIndexOf('{', i);
  try { return JSON.parse(out.slice(j)).rows || []; } catch (_) { return []; }
};

// ── ① 사이트가 실제로 쓰는 CATS 를 index.html 에서 읽는다 ──
function readCats() {
  const h = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = h.indexOf('const CATS=');
  if (i < 0) throw new Error('index.html 에서 CATS 를 못 찾았다');
  const seg = h.slice(i, h.indexOf('};', i) + 2);
  const CATS = {};
  for (const m of seg.match(/'([^']+)':\[([^\]]*)\]/g) || []) {
    const k = m.match(/'([^']+)':/)[1];
    CATS[k] = (m.slice(m.indexOf('[')).match(/'([^']+)'/g) || []).map(y => y.slice(1, -1));
  }
  if (Object.keys(CATS).length < 5) throw new Error('CATS 파싱 결과가 너무 적다: ' + Object.keys(CATS).length);
  return CATS;
}

const CATS = readCats();
const rows = runSql(`select id, major, minor, name, influencer from gonggu
 where approved = true
   and end_date >= to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')
 order by id desc;`);
if (!rows.length) { console.log('조회 0건 — DB 접근 실패 의심'); process.exit(1); }

const bad = rows.filter(r => !CATS[r.major] || !CATS[r.major].includes(r.minor));
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const head = `[${stamp}] 노출 ${rows.length}건 검사 → 필터 밖 ${bad.length}건`;
console.log(head);
bad.forEach(r => console.log('  id' + r.id + '  ' + r.major + '/' + r.minor + '  ' + String(r.name).slice(0, 32) + '  ' + (r.influencer || '')));

const body = head + (bad.length ? '\n' + bad.map(r => `  id${r.id} ${r.major}/${r.minor} ${r.name}`).join('\n') : '') + '\n';
try { appendFileSync(LOG, body); } catch (_) {}
// 최신이 맨 위로 (파일이 커지면 300줄만 남긴다)
try {
  const all = readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  writeFileSync(LOG, all.slice(-300).reverse().join('\n') + '\n', 'utf8');
} catch (_) {}

if (bad.length && !DRY) {
  const detail = `노출 중인데 소분류가 사이트 필터(CATS)에 없어 어떤 칩으로도 안 잡히는 공구 ${bad.length}건: ` +
    bad.slice(0, 8).map(r => `id${r.id} ${r.major}/${r.minor}`).join(', ') + (bad.length > 8 ? ' 외' : '');
  runSql(`insert into public.health_alerts(kind, detail) values ('소분류필터이탈', '${detail.split("'").join("''")}');`);
  console.log('🔴 health_alerts 에 경보 적재');
} else if (!bad.length) {
  console.log('✅ 필터 밖 0건');
}

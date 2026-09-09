// 카페 링크를 **진짜 판매 링크**로 바꾼다 (사장님 지시 2026-09-09 "1번 먼저하고 3번을 작업해")
//
// 왜:
//   `cafe_crawl.mjs` 는 카페 글에서 일정을 읽어 등록하면서 `pay_link` 에 **카페 글 주소**를 넣는다.
//   손님이 그 카드를 누르면 네이버 카페가 열리고, 웹뷰에는 네이버 세션이 없어 **로그인 + 2차 인증**을 요구한다.
//   (사장님 2026-08-10 · 2026-09-09 재발). 1안(네이버 앱으로 넘기기)은 증상을 덮을 뿐이고,
//   이 도구는 **카페를 아예 안 거치게** 만든다.
//
// 어디서 진짜 링크를 얻나:
//   🔴 카페 **본문 API 는 이제 로그인을 요구한다** (2026-09-09 실측 — v3·v2.1 전부 `errorCode 0004`).
//      메모리 `supabase-cli-direct-sql` 에 "로그인 없이 읽힌다"고 적혀 있었는데 지금은 사실이 아니다.
//   → 그래서 **인포크**에서 가져온다. `scratchpad/inpock_harvest.mjs` 의 harvest() 가
//      이미 블록마다 판매 URL(`url`)까지 들고 온다. 로그인 불필요.
//
// 흐름:
//   1. pay_link 가 우리 카페인 **살아있는** 공구를 뽑는다 (마감 지난 건 손님이 안 본다)
//   2. 셀러 핸들 → 인포크 슬러그 (sellers.inpock_slug → seller_profile.external_url → _slugmap.tsv → 핸들 변형)
//   3. 셀러별 인포크를 한 번씩 수확
//   4. 상품명 정규화 일치/포함 + (오픈일 또는 마감일 ±3일) 이면 같은 공구로 보고 링크를 바꾼다
//      ⚠ 오픈일만 보면 샌다 — 카페 글은 기간을 길게, 셀러는 짧게 적는다 (2026-09-01 사고와 같은 뿌리)
//   5. 바꾸기 전 **옛 pay_link 를 전부 파일로 백업**한다 → 되돌릴 수 있다
//
// 실행:
//   node tools/daily/cafe_link_fix.mjs            ← 확인만 (DB 안 건드림)
//   node tools/daily/cafe_link_fix.mjs --apply    ← 실제 반영
//   node tools/daily/cafe_link_fix.mjs --limit 20 ← 셀러 수 제한(시험용)
// 백업: scratchpad/카페링크교체_<시각>.json   로그: scratchpad/cafe_link_fix_log.txt
// 주기: 예약작업 momcal-cafe-linkfix (하루 1회, cafe_crawl 뒤)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';
import { harvest } from '../../scratchpad/inpock_harvest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LOG = join(ROOT, 'scratchpad', 'cafe_link_fix_log.txt');
const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0;

const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (s) => { appendFileSync(LOG, '[' + stamp() + '] ' + s + '\n'); console.log(s); };

// DB 한 번 조회 — 못 읽으면 던진다 (0건과 장애를 구분한다)
function sql(text, tag) {
  const f = join(ROOT, 'scratchpad', '_clf_' + tag + '.sql');
  writeFileSync(f, text);
  const out = execFileSync(SB, sbArgs(f), { encoding: 'utf8', timeout: 180000 });
  const p = parseRows(out);
  if (!p.ok) throw new Error('CLI 출력을 못 읽었다(' + tag + ') — ' + p.why);
  return p.rows;
}

// ── 상품명 정규화: cafe_crawl.mjs 의 NORM 과 같은 사상 ──
const DECOR = /([0-9]+차|초특가|특가|모음전|기획전|국산|신상|new|한정|공구)/g;
const PUNCT = /[\s\u00b7._&/,!+()[\]'"-]/g;
const NORM = (s) => String(s || '').toLowerCase().replace(DECOR, '').replace(PUNCT, '');

const days = (a, b) => Math.abs((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// 링크로 쓸 수 있는 주소인가 — 카페로 되돌아가면 고친 게 아니다
function usable(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/cafe\.naver\.com/i.test(s)) return false;      // 이걸 없애려고 하는 일이다
  if (/instagram\.com/i.test(s)) return false;        // 프로필로 보내면 손님이 또 헤맨다
  if (/^https?:\/\/(link\.)?inpock\.co\.kr\/?$/i.test(s)) return false;   // 껍데기
  if (/^https?:\/\/inpk\.link\/?$/i.test(s)) return false;
  return true;
}

// ── 1. 대상 ──
const rows = sql([
  'select g.id, g.name, g.open_date, g.end_date, g.insta, g.influencer, g.pay_link,',
  "       coalesce(s.inpock_slug,'') as slug, coalesce(p.external_url,'') as ext",
  'from gonggu g',
  'left join sellers s on s.insta = g.insta',
  'left join seller_profile p on p.insta = g.insta',
  "where g.pay_link like '%cafe.naver.com/momcal%'",
  "  and coalesce(g.insta,'') <> ''",
  "  and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')",
  'order by g.open_date desc',
].join('\n'), 'targets');

if (!rows.length) { log('바꿀 카페 링크 없음'); setTimeout(() => process.exit(0), 300); }

// ── 2. 핸들 → 슬러그 ──
const slugMap = new Map();
for (const f of ['_slugmap.tsv', '_slug_all.tsv']) {
  const p = join(ROOT, 'scratchpad', f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const parts = line.split('\t');
    const h = (parts[0] || '').trim(), s = (parts[1] || '').trim();
    if (h && s && !slugMap.has(h)) slugMap.set(h, s);
  }
}
// external_url 이 인포크면 거기서 슬러그를 뽑는다 — link.inpock.co.kr/<슬러그> · inpk.link/<슬러그>
const slugFromUrl = (u) => {
  const m = String(u || '').match(/(?:link\.inpock\.co\.kr|inpk\.link)\/([A-Za-z0-9._-]+)/);
  return m ? m[1] : '';
};

const byHandle = new Map();
for (const r of rows) {
  if (!byHandle.has(r.insta)) {
    byHandle.set(r.insta, { slug: r.slug || slugFromUrl(r.ext) || slugMap.get(r.insta) || '', items: [] });
  }
  byHandle.get(r.insta).items.push(r);
}

const handles = [...byHandle.keys()];
const todo = LIMIT ? handles.slice(0, LIMIT) : handles;
log('대상 ' + rows.length + '건 · 셀러 ' + handles.length + '명'
  + (LIMIT ? ' (이번엔 ' + todo.length + '명)' : '') + (APPLY ? ' · 반영' : ' · 확인만'));

// ── 3~4. 수확 → 대조 ──
const hits = [], misses = [];
let noInpock = 0;
for (const h of todo) {
  const g = byHandle.get(h);
  let hv = null;
  try { hv = await harvest(h, g.slug); } catch (e) { hv = null; }
  if (!hv || !hv.rows.length) {
    noInpock++;
    for (const it of g.items) misses.push(Object.assign({}, it, { why: '인포크 없음/빈 페이지' }));
    continue;
  }
  for (const it of g.items) {
    const gn = NORM(it.name);
    let best = null;
    for (const c of hv.rows) {
      if (!usable(c.url)) continue;
      const cn = NORM(c.name);
      if (!cn || !gn) continue;
      const nameOk = cn === gn
        || (gn.length >= 4 && cn.indexOf(gn) >= 0)
        || (cn.length >= 4 && gn.indexOf(cn) >= 0);
      if (!nameOk) continue;
      const dOpen = isDate(c.open) && isDate(it.open_date) ? days(c.open, it.open_date) : 99;
      const dEnd = isDate(c.end) && isDate(it.end_date) ? days(c.end, it.end_date) : 99;
      const d = Math.min(dOpen, dEnd);
      if (d > 3) continue;
      const score = (cn === gn ? 0 : 10) + d;
      if (!best || score < best.score) best = { score: score, c: c, exact: cn === gn, d: d };
    }
    if (best) hits.push(Object.assign({}, it, { slug: hv.slug, newUrl: best.c.url, matched: best.c.name, exact: best.exact, d: best.d }));
    else misses.push(Object.assign({}, it, { why: '인포크 ' + hv.rows.length + '건 중 일치 없음' }));
  }
}

log('인포크 못 찾은 셀러 ' + noInpock + '명 · 링크 찾음 ' + hits.length + '건'
  + ' (이름완전일치 ' + hits.filter((x) => x.exact).length + ') · 못 찾음 ' + misses.length + '건');
for (const x of hits.slice(0, 60)) {
  console.log('  ' + (x.exact ? '완전일치' : '부분일치') + ' #' + x.id + ' ' + x.name + '  (' + x.insta + ')');
  console.log('      인포크: ' + x.matched + '  · 날짜차 ' + x.d + '일');
  console.log('      ' + x.pay_link + '  ->  ' + x.newUrl);
}

if (!hits.length) { log('바꿀 것 없음'); setTimeout(() => process.exit(0), 300); }
else if (!APPLY) { log('확인만 했다. 실제로 바꾸려면 --apply'); setTimeout(() => process.exit(0), 300); }
else {
  // ── 5. 백업 먼저, 그 다음 UPDATE ──
  const tag = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const bk = join(ROOT, 'scratchpad', '카페링크교체_' + tag + '.json');
  writeFileSync(bk, JSON.stringify(hits.map((x) => ({
    id: x.id, name: x.name, open_date: x.open_date, end_date: x.end_date,
    insta: x.insta, old_pay_link: x.pay_link, new_pay_link: x.newUrl, matched: x.matched, exact: x.exact,
  })), null, 1), 'utf8');
  log('백업 ' + bk);
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  // ⚠ 그 사이 다른 경로가 링크를 바꿨을 수 있다 — 옛 값이 그대로일 때만 바꾼다
  const vals = hits.map((x) => '(' + x.id + ', ' + q(x.pay_link) + ', ' + q(x.newUrl) + ')').join(',\n');
  const upRows = sql([
    'with v(id, oldp, newp) as (values', vals, ')',
    'update gonggu g set pay_link = v.newp from v',
    'where g.id = v.id and g.pay_link = v.oldp',
    'returning g.id',
  ].join('\n'), 'apply');
  log('반영 ' + upRows.length + '건 / 대상 ' + hits.length + '건'
    + (upRows.length !== hits.length ? ' ⚠ 차이는 그 사이 링크가 바뀐 행이다' : ''));
  setTimeout(() => process.exit(0), 300);
}

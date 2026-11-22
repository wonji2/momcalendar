// 카페 링크를 **진짜 판매 링크**로 바꾼다 (사장님 지시 2026-09-09 "1번 먼저하고 3번을 작업해")
//
// 왜:
//   `cafe_crawl.mjs` 는 카페 글에서 일정을 읽어 등록하면서 `pay_link` 에 **카페 글 주소**를 넣는다.
//   손님이 그 카드를 누르면 네이버 카페가 열리고, 웹뷰에는 네이버 세션이 없어 **로그인 + 2차 인증**을 요구한다.
//   (사장님 2026-08-10 · 2026-09-09 재발). 네이버 앱으로 넘기는 우회는 증상을 덮을 뿐이고,
//   이 도구는 **카페를 아예 안 거치게** 만든다.
//
// 어디서 진짜 링크를 얻나:
//   🔴 카페 **본문 API 는 이제 로그인을 요구한다** (2026-09-09 실측 — v3·v2.1 전부 `errorCode 0004`).
//      메모리 `supabase-cli-direct-sql` 에 "로그인 없이 읽힌다"고 적혀 있었는데 지금은 사실이 아니다.
//   → 그래서 **인포크**에서 가져온다. `tools/daily/inpock_links.mjs` 가 날짜 유무와 무관하게
//      (상품명, 판매링크) 를 전부 준다. 로그인 불필요.
//      ⚠ `inpock_harvest.harvest()` 는 **날짜를 읽어낸 블록만** 준다 — 그것만 쓰면 셀러 79명 중
//        23명이 "블록 6~42개 있는데 수확 0" 이 된다(규칙 0-P: 수확 0 ≠ 일정 없음).
//
// 안전장치 (검증자 지적 반영, 2026-09-09)
//   · **기본은 이름 완전일치만 반영**한다. 부분일치는 보고만 하고 `--partial` 을 줘야 반영한다.
//     이유: NORM 이 `N차` 를 지워 "닥터라인 5차" → "닥터라인" 이 되고, "몬테소리 교구"·"액상 마그네슘"
//     같은 **분류명**이 4글자 포함 규칙으로 남의 상품과 붙는다.
//   · 바꿀 링크는 **실제로 열리는지 상태코드까지 본다.** 404·5xx 는 안 쓴다.
//   · 블로그·카페·인스타 주소는 판매 링크가 아니다 → 안 쓴다.
//   · 옛 링크는 전량 백업하고, **되돌리는 길(`--restore`)을 같이 넣었다.** 백업만 있고 복구 절차가
//     없으면 그건 아직 확인 안 된 백업이다.
//   · 인포크를 못 읽은 이유(오류/빈 페이지/일치 없음)를 구분해 로그에 남긴다.
//
// 실행:
//   node tools/daily/cafe_link_fix.mjs                 ← 확인만 (DB 안 건드림)
//   node tools/daily/cafe_link_fix.mjs --apply         ← 완전일치만 반영
//   node tools/daily/cafe_link_fix.mjs --apply --partial  ← 부분일치까지 반영 (사람이 표를 본 뒤에만)
//   node tools/daily/cafe_link_fix.mjs --restore scratchpad/카페링크교체_20260909....json  ← 되돌리기
//   node tools/daily/cafe_link_fix.mjs --limit 6       ← 셀러 수 제한(시험용)
// 백업: scratchpad/카페링크교체_<시각>.json   후보: scratchpad/카페링크교체_후보.json
// 로그: scratchpad/cafe_link_fix_log.txt
// 주기: ⚠ 아직 예약작업 없음. 사람이 돌린다. (예약으로 돌리려면 --apply 를 붙여 등록하고 tasks_backup.ps1 로 XML 백업)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';
import { inpockLinks } from './inpock_links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const LOG = join(ROOT, 'scratchpad', 'cafe_link_fix_log.txt');
const APPLY = process.argv.includes('--apply');
const PARTIAL = process.argv.includes('--partial');
// ⚠ indexOf 가 없을 때 -1 을 준다 — +1 하면 argv[0](node.exe 경로)를 집는다.
//   실제로 --restore 없이 돌렸더니 node.exe 를 JSON 으로 읽으려 했다. 플래그가 있을 때만 뒤를 본다.
const argAfter = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const RESTORE = argAfter('--restore');
const LIMIT = Number(argAfter('--limit')) || 0;
const RUNTAG = String(process.pid) + '_' + Date.now().toString(36);   // 동시 실행해도 임시파일이 안 겹치게

const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const log = (s) => { appendFileSync(LOG, '[' + stamp() + '] ' + s + '\n'); console.log(s); };
// 🔴 setTimeout 으로 exit 만 걸면 **뒤 코드가 계속 돈다** — 되돌리기(--restore)를 시켰는데
//    그대로 대상 조회까지 흘러가 버렸다(2026-09-09 실측). 반드시 여기서 멈춰야 한다.
//    node 24 윈도우 teardown 버그 때문에 즉시 exit 하지 않고 300ms 뒤에 나간다(cafe_crawl 과 같은 방식).
const bye = async (code) => { setTimeout(() => process.exit(code || 0), 300); await new Promise(() => {}); };

// DB 한 번 조회 — 못 읽으면 던진다 (0건과 장애를 구분한다)
//   ⚠ 2026-09-09 실측: 같은 명령이 이유 없이 `Failed to connect` 를 뱉었다가 바로 다음에 성공한다.
//     한 번 실패했다고 멈추면 예약작업이 조용히 죽는다 → 세 번까지 다시 걸어본다.
function sql(text, tag) {
  const f = join(ROOT, 'scratchpad', '_clf_' + tag + '_' + RUNTAG + '.sql');
  writeFileSync(f, text);
  let last = null;
  for (let i = 1; i <= 3; i++) {
    try {
      const out = execFileSync(SB, sbArgs(f), { encoding: 'utf8', timeout: 180000 });
      const p = parseRows(out);
      if (!p.ok) throw new Error('CLI 출력을 못 읽었다 — ' + p.why);
      return p.rows;
    } catch (e) {
      last = e;
      log('⚠ DB 조회 실패(' + tag + ') ' + i + '/3 — ' + String(e.message || e).slice(0, 120));
      if (i < 3) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},4000)'], { timeout: 20000 });
    }
  }
  throw new Error('DB 조회 3번 다 실패(' + tag + ') — ' + String((last && last.message) || last).slice(0, 160));
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ── 되돌리기 — 백업 파일의 old_pay_link 로 되돌린다 ──
//    지금 값이 우리가 넣은 new_pay_link 일 때만 되돌린다(그 사이 사람이 고쳤으면 안 건드린다).
if (RESTORE) {
  if (!existsSync(RESTORE)) { log('🔴 백업 파일이 없다: ' + RESTORE); await bye(1); }
  else {
    const bk = JSON.parse(readFileSync(RESTORE, 'utf8'));
    if (!Array.isArray(bk) || !bk.length) { log('🔴 백업이 비었다: ' + RESTORE); await bye(1); }
    else {
      const vals = bk.map((x) => '(' + Number(x.id) + ', ' + q(x.new_pay_link) + ', ' + q(x.old_pay_link) + ')').join(',\n');
      const back = sql([
        'with v(id, curp, oldp) as (values', vals, ')',
        'update gonggu g set pay_link = v.oldp from v',
        'where g.id = v.id and g.pay_link = v.curp',
        'returning g.id',
      ].join('\n'), 'restore');
      log('되돌림 ' + back.length + '건 / 백업 ' + bk.length + '건'
        + (back.length !== bk.length ? ' ⚠ 차이는 그 뒤 사람이 따로 고친 행이다(안 건드렸다)' : ''));
      await bye(0);
    }
  }
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
  if (/cafe\.naver\.com|naver\.me\//i.test(s)) return false;   // 이걸 없애려고 하는 일이다
  if (/instagram\.com/i.test(s)) return false;                 // 프로필로 보내면 손님이 또 헤맨다
  if (/blog\.naver\.com|post\.naver\.com|tistory\.com|brunch\.co\.kr/i.test(s)) return false;  // 글이지 판매 페이지가 아니다
  if (/^https?:\/\/(link\.)?inpock\.co\.kr\/?$/i.test(s)) return false;   // 껍데기
  if (/^https?:\/\/inpk\.link\/?$/i.test(s)) return false;
  return true;
}

// 인포크 단축링크(/api/r/…)를 따라가 **진짜 판매처 주소**를 얻고, **열리는지 상태코드까지** 본다.
//   🔴 상태를 안 보면 404·품절·에러 페이지도 그대로 손님에게 붙는다(검증자 지적).
//   429·490 은 네이버가 우리를 봇으로 막은 것이지 죽은 링크가 아니다 → 살아있는 것으로 친다.
async function resolveFinal(u) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    const r = await fetch(u, { redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: c.signal });
    clearTimeout(t);
    const f = usable(String(r.url || '')) ? String(r.url) : u;
    const alive = (r.status >= 200 && r.status < 400) || r.status === 429 || r.status === 490;
    return { url: f, status: r.status, alive: alive };
  } catch (e) {
    return { url: u, status: 0, alive: false, why: String(e.name || e).slice(0, 40) };
  }
}

// ── 1. 대상 ──
//    ⚠ naver.me 단축링크도 카페로 간다(307 → m.cafe.naver.com) — 같이 잡는다.
const rows = sql([
  'select g.id, g.name, g.open_date, g.end_date, g.insta, g.influencer, g.pay_link,',
  "       coalesce(s.inpock_slug,'') as slug, coalesce(p.external_url,'') as ext",
  'from gonggu g',
  'left join sellers s on s.insta = g.insta',
  'left join seller_profile p on p.insta = g.insta',
  "where (g.pay_link like '%cafe.naver.com/momcal%' or g.pay_link like '%naver.me/%')",
  "  and coalesce(g.insta,'') <> ''",
  "  and g.end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')",
  'order by g.open_date desc',
].join('\n'), 'targets');

if (!rows.length) { log('바꿀 카페 링크 없음'); await bye(0); }

// ── 2. 핸들 → 인포크 슬러그 ──
//    ⚠ 슬러그가 틀리면 **남의 셀러 인포크**를 뒤지게 된다. 어디서 온 슬러그인지 같이 남긴다.
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
// external_url 이 인포크면 거기서 슬러그를 뽑는다 — 셀러 본인 프로필에 적힌 것이라 가장 믿을 만하다
const slugFromUrl = (u) => {
  const m = String(u || '').match(/(?:link\.inpock\.co\.kr|inpk\.link)\/([A-Za-z0-9._-]+)/);
  return m ? m[1] : '';
};

const byHandle = new Map();
for (const r of rows) {
  if (!byHandle.has(r.insta)) {
    const fromProfile = slugFromUrl(r.ext);
    const slug = r.slug || fromProfile || slugMap.get(r.insta) || '';
    const src = r.slug ? 'sellers' : (fromProfile ? '프로필링크' : (slugMap.has(r.insta) ? '슬러그표' : '핸들추측'));
    byHandle.set(r.insta, { slug: slug, src: src, items: [] });
  }
  byHandle.get(r.insta).items.push(r);
}

const handles = [...byHandle.keys()];
const todo = LIMIT ? handles.slice(0, LIMIT) : handles;
log('대상 ' + rows.length + '건 · 셀러 ' + handles.length + '명'
  + (LIMIT ? ' (이번엔 ' + todo.length + '명)' : '')
  + (APPLY ? (PARTIAL ? ' · 반영(부분일치 포함)' : ' · 반영(완전일치만)') : ' · 확인만'));

// ── 3~4. 인포크 읽기 → 대조 ──
const hits = [], misses = [];
const trouble = { 오류: 0, 페이지없음: 0, 일치없음: 0 };
for (const h of todo) {
  const g = byHandle.get(h);
  let iv = null, err = '';
  try { iv = await inpockLinks(h, g.slug); } catch (e) { err = String(e.message || e).slice(0, 80); }
  if (err) { trouble.오류++; log('  ⚠ 인포크 읽기 실패 ' + h + ' — ' + err); }
  if (!iv) {
    if (!err) trouble.페이지없음++;
    for (const it of g.items) misses.push(Object.assign({}, it, { why: err ? ('읽기 실패: ' + err) : '인포크 페이지 없음' }));
    continue;
  }
  for (const it of g.items) {
    const gn = NORM(it.name);
    let best = null;
    for (const c of iv.items) {
      if (!usable(c.url)) continue;
      const cn = NORM(c.name);
      if (!cn || !gn) continue;
      const exact = cn === gn;
      const part = !exact && ((gn.length >= 4 && cn.indexOf(gn) >= 0) || (cn.length >= 4 && gn.indexOf(cn) >= 0));
      if (!exact && !part) continue;
      // 날짜는 있으면 본다. 인포크에 날짜가 없는 셀러가 훨씬 많아서 **없다고 버리지는 않는다.**
      const dOpen = isDate(c.open) && isDate(it.open_date) ? days(c.open, it.open_date) : null;
      const dEnd = isDate(c.end) && isDate(it.end_date) ? days(c.end, it.end_date) : null;
      const d = (dOpen === null && dEnd === null) ? null : Math.min(dOpen === null ? 99 : dOpen, dEnd === null ? 99 : dEnd);
      if (d !== null && d > 3) continue;          // 날짜를 아는데 멀면 다른 회차다
      const score = (exact ? 0 : 10) + (d === null ? 2 : d);
      if (!best || score < best.score) best = { score: score, c: c, url: c.url, exact: exact, d: d };
    }
    if (!best) { misses.push(Object.assign({}, it, { why: '인포크 ' + iv.items.length + '개 중 일치 없음' })); trouble.일치없음++; continue; }
    const fin = await resolveFinal(best.url);
    if (!fin.alive || !usable(fin.url)) {
      misses.push(Object.assign({}, it, { why: '링크가 안 열린다(' + fin.status + (fin.why ? ' ' + fin.why : '') + ')' }));
      continue;
    }
    hits.push(Object.assign({}, it, {
      slug: iv.slug, slugSrc: g.src, newUrl: fin.url, status: fin.status,
      matched: best.c.name, exact: best.exact, d: best.d,
    }));
  }
}

const exacts = hits.filter((x) => x.exact);
const parts = hits.filter((x) => !x.exact);
log('셀러 — 인포크 없음 ' + trouble.페이지없음 + '명 · 읽기 실패 ' + trouble.오류 + '명'
  + ' / 링크 찾음 ' + hits.length + '건 (완전일치 ' + exacts.length + ' · 부분일치 ' + parts.length + ')'
  + ' · 못 찾음 ' + misses.length + '건');

for (const x of hits) {
  console.log('  ' + (x.exact ? '완전일치' : '부분일치') + ' #' + x.id + ' ' + x.name + '  (' + x.insta
    + ' · 슬러그 ' + x.slug + '/' + x.slugSrc + ')');
  console.log('      인포크: ' + x.matched + (x.d === null ? '  · 날짜없음' : '  · 날짜차 ' + x.d + '일') + '  · HTTP ' + x.status);
  console.log('      ' + x.pay_link + '  ->  ' + x.newUrl);
}

const shape = (x) => ({
  id: x.id, name: x.name, open_date: x.open_date, end_date: x.end_date, insta: x.insta,
  old_pay_link: x.pay_link, new_pay_link: x.newUrl, matched: x.matched, exact: x.exact,
  slug: x.slug, slug_src: x.slugSrc, http: x.status,
});

const target = PARTIAL ? hits : exacts;

if (!hits.length) { log('바꿀 것 없음'); await bye(0); }
else if (!APPLY) {
  // 확인만 해도 후보를 파일로 남긴다 — 채팅이 날아가도 다음 사람이 이어받을 수 있게 (규칙 0-Z)
  const cand = join(ROOT, 'scratchpad', '카페링크교체_후보.json');
  writeFileSync(cand, JSON.stringify(hits.map(shape), null, 1), 'utf8');
  log('후보 ' + cand + ' 에 남겼다. 반영은 --apply (부분일치까지 넣으려면 --partial 을 함께)');
  await bye(0);
} else if (!target.length) { log('반영할 완전일치가 없다. 부분일치만 있으면 --partial 을 함께 줘라'); await bye(0); }
else {
  // ── 5. 백업 먼저, 그 다음 UPDATE ──
  const tag = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace(/[:T-]/g, '');
  const bk = join(ROOT, 'scratchpad', '카페링크교체_' + tag + '.json');
  if (existsSync(bk)) { log('🔴 백업 이름이 이미 있다 — 멈춘다 ' + bk); await bye(1); }
  else {
    writeFileSync(bk, JSON.stringify(target.map(shape), null, 1), 'utf8');
    log('백업 ' + bk + ' (' + target.length + '건)');
    // ⚠ 그 사이 다른 경로가 링크를 바꿨을 수 있다 — 옛 값이 그대로일 때만 바꾼다
    const vals = target.map((x) => '(' + x.id + ', ' + q(x.pay_link) + ', ' + q(x.newUrl) + ')').join(',\n');
    const upRows = sql([
      'with v(id, oldp, newp) as (values', vals, ')',
      'update gonggu g set pay_link = v.newp from v',
      'where g.id = v.id and g.pay_link = v.oldp',
      'returning g.id',
    ].join('\n'), 'apply');
    log('반영 ' + upRows.length + '건 / 대상 ' + target.length + '건'
      + (upRows.length !== target.length ? ' ⚠ 차이는 그 사이 링크가 바뀐 행이다' : ''));
    log('되돌리려면: node tools/daily/cafe_link_fix.mjs --restore "' + bk + '"');
    await bye(0);
  }
}

/**
 * 🔎 공구팡팡(09pangpang.com)에서 **셀러 핸들만** 단서로 뽑는다 — 우리가 모르는 셀러를 찾는 용도
 *
 * 사장님 지시 2026-10-01:
 *   "공구팡팡 사이트 들어가봐 오늘 하루 진행건만 300건은 넘는데 참고해서 가져올거 가져오고 우리도 그런식으로 긁어"
 *
 * 🔴 **남의 상품명·날짜를 그대로 옮기지 않는다** (작업 원칙 8 · 메모리 no-jupjup-dependence):
 *   *"집계 사이트·카톡·검색은 「누가 뭘 한다」는 단서일 뿐이고, 실제 등록은 셀러 인스타·인포크에서
 *     직접 확인한 것만 한다. 남의 사이트 DB 를 통째로 긁어 그대로 옮기는 것은 안 한다 —
 *     우리가 당하기 싫은 일이고, 확인 안 된 값은 틀린 값이다."*
 *   → 여기서 뽑는 것은 **인스타 핸들뿐**이다. 그 핸들을 우리 수확기(피드·인포크·바이오)에 넣어
 *     **우리가 직접 셀러 계정에서** 상품·날짜를 읽는다.
 *
 * 흐름: 09pangpang 목록·달력 페이지 → 인스타 핸들 추출 → DB 활동셀러·기존 후보와 대조
 *       → 새 핸들만 `scratchpad/_new_sellers.txt` 에 붙인다
 *         (`parsing_nightly.mjs` 와 `ig_feed_sweep.mjs` 가 이미 이 파일을 읽는다)
 *
 *   node tools/daily/pangpang_leads.mjs [--pages 6]
 * 로그: scratchpad/pangpang_leads_log.txt
 * 주기: 윈도우 예약작업 momcal-pangpang — 하루 2회 (08:50 · 20:50)
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const OUT = path.join(ROOT, 'scratchpad', '_new_sellers.txt');
const LOG_F = path.join(ROOT, 'scratchpad', 'pangpang_leads_log.txt');
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const KST = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => { const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); try { fs.appendFileSync(LOG_F, l + '\n'); } catch { } };
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { log(`🔴 ${ev} — ${String(e && e.message || e)}`); process.exit(1); });

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const PAGES = +arg('--pages', 6);

// 핸들로 보이지 않는 것·우리 계정·집계계정은 버린다
const BAD = /^(www|api|cdn|img|static|assets|post|calendar|account|about|search|login|p|reel|explore|stories|tag|privacy|terms|sitemap|robots|favicon|index|home|main|null|undefined)$/i;
const AGG = /^(gonggu_|gongu_|gonggoo|ggonggu|momcal|09pangpang|pangpang)/;

const grab = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) { log(`  ⚠ ${url} → HTTP ${r.status}`); return ''; }
  return r.text();
};

const found = new Set();
const urls = ['https://09pangpang.com/', 'https://09pangpang.com/calendar'];
for (let p = 2; p <= PAGES; p++) urls.push(`https://09pangpang.com/?page=${p}`);

for (const u of urls) {
  const t = await grab(u);
  if (!t) continue;
  let n = 0;
  // 🔴 2026-10-01 실측: 처음엔 「점·밑줄이 든 토큰」을 핸들로 봤는데 **SVG 경로 좌표를 긁었다**
  //    (`1.8h13.4c5.7` · `1.27.53.207` 류 111개를 _new_sellers.txt 에 붙였다 → 되돌렸다).
  //    이 사이트는 `instagram.com` 링크를 아예 안 쓴다(0회). 핸들은 **카드의 title 속성**에 있다:
  //      title="다용도 정리함 @d.nine.84"
  //    → 그 패턴만 쓴다. 다른 추측 패턴을 섞지 말 것.
  for (const m of t.matchAll(/title="[^"]*@([A-Za-z0-9._]{2,30})"/g)) {
    const h = m[1].toLowerCase();
    if (BAD.test(h) || AGG.test(h)) continue;
    if (!/[a-z]{2}/.test(h)) continue;                       // 글자가 둘은 있어야 핸들이다
    if (!/^[a-z0-9][a-z0-9._]{0,28}[a-z0-9]$/.test(h)) continue;
    if (!found.has(h)) n++; found.add(h);
  }
  // 인스타 링크를 쓰기 시작하면 그것도 받는다 (지금은 0회)
  for (const m of t.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/g)) {
    const h = m[1].toLowerCase();
    if (BAD.test(h) || AGG.test(h) || !/[a-z]{2}/.test(h)) continue;
    if (!found.has(h)) n++; found.add(h);
  }
  log(`  ${u} → 핸들 +${n} (누적 ${found.size})`);
  await new Promise((s) => setTimeout(s, 1200));
}
if (!found.size) { log('🔴 핸들 0개 — 사이트 구조가 바뀌었나? (수확 0건은 내 도구를 의심한다 — 규칙 0-P)'); process.exit(1); }

// ── 우리가 이미 아는 셀러와 대조
const known = new Set();
for (let off = 0; off < 8000; off += 1000) {
  const r = await fetch(`${SB}/gonggu?select=insta&insta=neq.&order=id.desc&limit=1000&offset=${off}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) break;
  const rows = await r.json();
  if (!rows.length) break;
  for (const x of rows) if (x.insta) known.add(x.insta.replace(/^@+/, '').toLowerCase());
}
const fromDb = known.size;
for (const f of ['_new_sellers.txt', '_blog_sellers.txt', '_blog_slugs.txt', '_cands_review.txt', 'parsing_excluded.txt', 'calendar_not_sellers.txt']) {
  const p = path.join(ROOT, 'scratchpad', f);
  if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (l.trim().startsWith('#')) continue;
    const h = l.trim().split(/[\s\t,|#(]/)[0].replace(/^@+/, '').toLowerCase();
    if (h) known.add(h);
  }
}
const fresh = [...found].filter((h) => !known.has(h)).sort();
log(`공구팡팡에서 핸들 ${found.size}개 · 우리가 아는 셀러 ${fromDb}명(+후보파일) → **새 셀러 ${fresh.length}명**`);
if (!fresh.length) { log('새 셀러 0명 — 끝'); process.exit(0); }

fs.appendFileSync(OUT, fresh.join('\n') + '\n');
log(`→ ${path.basename(OUT)} 에 붙였다 (parsing_nightly·ig_feed_sweep 가 다음 회차에 이 셀러들을 직접 돈다)`);
log('  ⚠ 상품·날짜는 **우리가 셀러 계정에서 직접 확인**한다. 남의 상품명·날짜를 옮기지 않는다 (작업 원칙 8)');
fresh.slice(0, 30).forEach((h) => log(`    @${h}`));
if (fresh.length > 30) log(`    … 그 외 ${fresh.length - 30}명`);

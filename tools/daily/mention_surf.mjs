/**
 * 🌊 **파도타기 — 캡션 속 @태그로 새 셀러를 찾는다** (비용 0원)
 *
 * 사장님 지시 2026-10-01:
 *   *"그 외에도 매일매일 공구팡팡처럼 그날 오픈하는건 찾아서 파도타면서 다 등록해야해"*
 *   *"비용은 더 들면 안되는데 여기서 다른 방법 찾아봐"*
 *
 * 왜 공짜인가: 셀러들은 캡션에서 **서로를 @ 로 태그한다**(공동공구·브랜드 계정·협업 셀러).
 *   그 캡션은 `ig_feed_sweep.mjs`(30분마다)가 **이미 받아 쌓아놓은 것**이다.
 *   인스타에 새로 붙지 않고, AI 도 쓰지 않고, 파일만 읽는다 → **추가 비용 0원.**
 *   인스타 「유사계정 체이닝」(규칙 0-N 채널 7)은 로그인이 필요한데, 이건 필요 없다.
 *
 * 흐름: scratchpad/ig_feed/*.jsonl 캡션 → @핸들 추출 → 우리가 아는 셀러·후보·제외명단과 대조
 *       → 새 핸들만 `scratchpad/_new_sellers.txt` 에 붙인다
 *         (parsing_nightly.mjs · ig_feed_sweep.mjs 가 이미 이 파일을 읽어 다음 회차에 그 셀러를 돈다)
 *
 * 🔑 **태그는 셀러가 아닐 수도 있다** — 브랜드 공식계정·협찬사·친구 계정이 섞인다.
 *    그래서 여기서는 **등록을 하지 않는다.** 후보로만 넘기고, 공구가 실제로 있는지는
 *    수확기가 그 계정 피드·인포크를 직접 보고 판단한다(규칙 0-P).
 *    브랜드 계정이라도 값이 있다 — 그 브랜드와 공구하는 셀러를 그 계정이 태그해준다.
 *
 *   node tools/daily/mention_surf.mjs [--days 3] [--min 1] [--dry]
 * 로그: scratchpad/mention_surf_log.txt
 * 주기: 윈도우 예약작업 momcal-surf — 하루 2회 (07:10 · 19:10)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const DIR = SP('ig_feed');
const OUT = SP('_new_sellers.txt');
const LOG_F = SP('mention_surf_log.txt');
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';

const KST = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => { const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); try { fs.appendFileSync(LOG_F, l + '\n'); } catch { } };
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { log(`🔴🔴 ${ev} — ${String((e && e.stack) || e).split('\n').slice(0, 5).join(' | ')}`); process.exit(1); });
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const DAYS = +arg('--days', 3);
const MIN = +arg('--min', 1);
const DRY = process.argv.includes('--dry');

// 핸들로 보이지 않는 것·집계계정·우리 계정
const BAD = /^(www|com|co|kr|net|org|me|p|reel|reels|explore|stories|tag|tags|highlight|s|the|a|an|and|or|in|on|at|of|to|for|it|is|all|new|now|open|dm|디엠|공구|링크|프로필)$/i;
const AGG = /^(gonggu_|gongu_|gonggoo|ggonggu|momcal|09pangpang|pangpang|gongu|joob)/;

// 1) 캡션 모으기 — 최근 DAYS 일치 jsonl
const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-DAYS)
  : [];
if (!files.length) { log('🔴 피드 jsonl 이 없다 — ig_feed_sweep 이 돌고 있나? (수확 0건은 내 도구를 의심한다)'); process.exit(1); }

const cnt = new Map();      // 핸들 → 몇 번 태그됐나
const byWho = new Map();    // 핸들 → 태그한 셀러들
let posts = 0, owners = new Set();
for (const f of files) {
  for (const line of fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const cap = j && j.cap, u = (j && j.u || '').toLowerCase();
    if (!cap) continue;
    posts++; if (u) owners.add(u);
    // @핸들 — 인스타 규칙: 영문·숫자·밑줄·점, 1~30자. 앞이 글자·숫자면 메일주소 등이라 안 본다
    for (const m of String(cap).matchAll(/(^|[^A-Za-z0-9._@])@([A-Za-z0-9._]{3,30})/g)) {
      let h = m[2].toLowerCase().replace(/\.+$/, '');          // 문장 끝 마침표는 핸들이 아니다
      if (h.length < 3 || BAD.test(h) || AGG.test(h)) continue;
      if (!/[a-z]{2}/.test(h)) continue;                        // 글자가 둘은 있어야 핸들이다
      if (!/^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/.test(h)) continue;
      if (h === u) continue;                                    // 자기 자신 태그
      cnt.set(h, (cnt.get(h) || 0) + 1);
      if (!byWho.has(h)) byWho.set(h, new Set());
      if (u) byWho.get(h).add(u);
    }
  }
}
log(`캡션 ${posts}건(셀러 ${owners.size}명 · 파일 ${files.length}개) → @태그 ${cnt.size}종`);
if (!cnt.size) { log('🔴 @태그 0종 — 캡션 형식이 바뀌었나? 원문을 눈으로 볼 것'); process.exit(1); }

// 2) 우리가 아는 셀러·후보·제외명단
const known = new Set(owners);                                  // 이미 훑고 있는 셀러
for (let off = 0; off < 12000; off += 1000) {
  const r = await fetch(`${SB}/gonggu?select=insta&insta=neq.&order=id.desc&limit=1000&offset=${off}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) { log(`⚠ DB 조회 ${r.status} — 아는 셀러를 덜 읽었다. 중복 후보가 생길 수 있다`); break; }
  const rows = await r.json();
  if (!rows.length) break;
  for (const x of rows) if (x.insta) known.add(String(x.insta).replace(/^@+/, '').toLowerCase());
}
const fromDb = known.size;
for (const f of ['_new_sellers.txt', '_blog_sellers.txt', '_cands_review.txt', 'parsing_excluded.txt', 'calendar_not_sellers.txt', 'my_judgment_skip.txt']) {
  try {
    for (const l of fs.readFileSync(SP(f), 'utf8').split(/\r?\n/)) {
      if (l.trim().startsWith('#')) continue;
      const h = l.trim().split(/[\s\t,|#(]/)[0].replace(/^@+/, '').toLowerCase();
      if (h) known.add(h);
    }
  } catch { }
}

// 🔑 **「몇 번 태그됐나」가 아니라 「몇 명이 태그했나」로 줄 세운다** (2026-10-01 실측):
//    한 셀러가 11번 태그한 `bronteshop.co.kr`·7번의 `lavien_official` 은 **그 셀러가 파는 브랜드**다.
//    반면 서로 모르는 셀러 3명이 각각 태그한 `300ddalgi`·`mintgirl_16`·`ddgsg66` 은 **셀러**다.
//    브랜드 공식계정도 버리진 않는다(그 브랜드와 공구하는 셀러를 태그해준다) — 뒤로 보낼 뿐이다.
const whoN = (h) => (byWho.get(h) || new Set()).size;
const fresh = [...cnt.entries()]
  .filter(([h]) => !known.has(h))
  .filter(([h, n]) => whoN(h) >= MIN || n >= MIN + 2)      // 여러 사람이 태그했거나, 아주 많이 태그됐으면
  .sort((a, b) => whoN(b[0]) - whoN(a[0]) || b[1] - a[1]);
const multi = fresh.filter(([h]) => whoN(h) >= 2).length;
log(`아는 셀러 ${fromDb}명(+후보·제외명단) → **새 핸들 ${fresh.length}개** (그 중 서로 다른 셀러 2명 이상이 태그한 것 ${multi}개 — 이쪽이 셀러일 가능성이 높다)`);

if (!fresh.length) { log('새 핸들 0개 — 끝'); process.exit(0); }
for (const [h, n] of fresh.slice(0, 25)) log(`    @${h.padEnd(26)} 태그한 셀러 ${whoN(h)}명 / ${n}회 · ${[...(byWho.get(h) || [])].slice(0, 3).join(',')}`);
if (fresh.length > 25) log(`    … 그 외 ${fresh.length - 25}개`);

if (DRY) { log('--dry — 파일에 쓰지 않았다'); process.exit(0); }
fs.appendFileSync(OUT, fresh.map(([h]) => h).join('\n') + '\n');
log(`→ ${path.basename(OUT)} 에 붙였다 (parsing_nightly·ig_feed_sweep 가 다음 회차에 이 계정들을 직접 본다)`);
log('  ⚠ 태그된 계정이 공구 셀러라는 보장은 없다 — 등록은 하지 않는다. 수확기가 피드·인포크를 보고 판단한다(규칙 0-P)');

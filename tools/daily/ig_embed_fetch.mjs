/**
 * 📸 인스타 게시물을 **로그인 없이** 읽는다 — embed 경로 (2026-09-30 신설)
 *
 * 왜 만들었나: 카톡 공구방(플레이북 채널 11)에는 하루에 게시물·릴스 링크가 수십 개 떨어진다.
 *   그런데 링크에는 **셀러 핸들이 없다**(`instagram.com/p/<코드>`) — 글을 열어야 누가 올린 건지 안다.
 *   지금까지 이건 "인스타 로그인 탭이 있어야 하는 일"로 분류돼 사람 몫으로 밀려 있었다.
 *   2026-09-30 실측: **`/embed/captioned/` 는 로그인 없이 작성자와 캡션 전문을 200 으로 준다.**
 *   덕분에 이 채널이 무인화된다.
 *
 * 흐름
 *   ① 게시물 코드(또는 URL)를 받아 `instagram.com/p/<코드>/embed/captioned/` 를 GET
 *   ② 작성자 핸들(`class="UsernameText"`)과 캡션을 뽑는다
 *   ③ **게시일은 코드에서 계산한다** — embed HTML 에는 날짜가 없다.
 *      인스타 shortcode 는 base64(A-Za-z0-9-_) 로 media_id 를 담고 있고, `(id >> 23) + 1314220021721` 이 ms 타임스탬프다.
 *      2026-09-30 검증: `Dd36mJ_iXe-` → 2026-09-29T13:55. 같은 글이 ig_feed_sweep 로그에 `"t":"2026-09-29"` 로
 *      기록돼 있어 **실측과 일치**했다. (게시일은 "오늘/내일 오픈" 같은 상대 날짜 판정에 쓰이므로 틀리면 하루가 밀린다)
 *   ④ `scratchpad/ig_feed/<게시일>.jsonl` 에 기존 스윕과 **같은 형식**으로 append
 *      → 그 다음은 `ig_feed_to_table.mjs` 가 공구 판정(5단계)·세척·날짜계산을 그대로 해준다. 새 파서를 만들지 않는다.
 *
 * 실행
 *   node tools/daily/ig_embed_fetch.mjs <코드목록파일>     # 한 줄에 `p/<코드>` 또는 `reel/<코드>` 또는 전체 URL. 탭 뒤 메모는 무시
 *   node tools/daily/ig_embed_fetch.mjs --code Ddu6a0ak1Us  # 한 건만
 * 상태  scratchpad/_ig_embed_seen.txt (이미 읽은 코드 — 다시 받지 않는다)
 * 로그  scratchpad/ig_embed_log.txt
 *
 * ⚠ 한계: 비공개 계정·삭제된 글은 캡션이 비어 온다(그 줄은 버린다). 스토리는 embed 가 없다(사람 몫).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const DIR = path.join(ROOT, 'scratchpad', 'ig_feed');
const SEEN = path.join(ROOT, 'scratchpad', '_ig_embed_seen.txt');
const LOG = path.join(ROOT, 'scratchpad', 'ig_embed_log.txt');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (s) => {
  const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  try { appendFileSync(LOG, `[${t}] ${s}\n`); } catch {}
  console.log(s);
};

// shortcode → 게시일 (위 ③ 참조)
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function postedAt(code) {
  let n = 0n;
  for (const c of code) { const i = ALPHA.indexOf(c); if (i < 0) return null; n = n * 64n + BigInt(i); }
  const ms = Number(n >> 23n) + 1314220021721;
  const d = new Date(ms);
  if (isNaN(d) || d.getUTCFullYear() < 2015 || d.getUTCFullYear() > 2100) return null;
  // 🔴 **UTC 날짜**로 낸다 — KST 가 아니다.
  //   2026-09-30 검증: 계산식은 맞다(43,464건 중 98.95% 가 UTC 날짜로 일치).
  //   그런데 첫 판은 KST 로 냈고 `ig_feed_sweep.mjs:125,156` 은 `toISOString()` 즉 UTC 로 넣는다.
  //   같은 `ig_feed/*.jsonl` 안에 두 규약이 섞이면 `ig_feed_to_table` 이 `t` 를 "오늘/내일 오픈" 기준일로
  //   쓸 때 **8.58%(UTC 15~24시 게시물)에서 하루가 어긋난다.** 한국 셀러 기준으로는 KST 가 더 맞지만,
  //   기존 43,467건이 UTC 규약이므로 **여기서는 맞춰 두고**, 규약 통일은 따로 결정할 일로 남긴다.
  return d.toISOString().slice(0, 10);
}

const decode = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

// 한 줄에서 게시물 코드만 뽑는다 (URL·`p/코드`·`reel/코드`·코드 단독 모두 받는다)
function codeOf(line) {
  const s = line.split('\t')[0].trim();
  if (!s || s.startsWith('#')) return null;
  const m = s.match(/(?:^|\/)(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,20})/) || s.match(/^([A-Za-z0-9_-]{5,20})$/);
  return m ? m[1] : null;
}

const args = process.argv.slice(2);
let codes = [];
if (args[0] === '--code') codes = [args[1]].filter(Boolean);
else if (args[0]) {
  codes = readFileSync(args[0], 'utf8').split(/\r?\n/).map(codeOf).filter(Boolean);
} else {
  console.log('사용법: node tools/daily/ig_embed_fetch.mjs <코드목록파일> | --code <코드>');
  process.exit(1);
}
codes = [...new Set(codes)];

const seen = new Set(existsSync(SEEN) ? readFileSync(SEEN, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []);
const todo = codes.filter((c) => !seen.has(c));
log(`대상 ${codes.length}건 (이미 읽은 것 ${codes.length - todo.length} 제외 → ${todo.length})`);
if (!todo.length) { log('= 새 게시물 없음'); process.exit(0); }

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const byDay = {};
let ok = 0, empty = 0, fail = 0;
for (const code of todo) {
  try {
    const r = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers: { 'user-agent': UA } });
    if (!r.ok) { fail++; log(`  🔴 ${code} HTTP ${r.status}`); await sleep(1200); continue; }
    const h = await r.text();
    const um = h.match(/class="UsernameText">([^<]+)</) || h.match(/instagram\.com\/([A-Za-z0-9._]{2,30})\/\?utm_source=ig_embed/);
    const u = um ? decode(um[1]).trim().toLowerCase() : '';
    const cm = h.match(/<div class="Caption">([\s\S]*?)<\/div>/);
    let cap = '';
    if (cm) {
      // 🔴 2026-09-30 검증에서 잡힌 것 — 이 두 조각을 떼지 않으면 캡션이 오염된다(첫 판에서 23/23 전부 오염됐다).
      //   ① 맨 앞 작성자는 **`<a class="CaptionUsername">`** 다 (`<div ...>` 가 아니다 — 첫 판이 여기서 틀렸다)
      //   ② 끝에 `<div class="CaptionComments"><a>View all 55 comments</a>` 가 붙는다.
      //      태그를 지우면 그 문구가 **앞 낱말에 그대로 달라붙어** `장목수네view` 같은 낱말이 생기고,
      //      ig_feed_to_table 의 토크나이저(/[가-힣A-Za-z0-9]{2,}/)는 한글+영문을 한 낱말로 보기 때문에
      //      상품명에 `all`·`comments` 가 섞여 손님 화면까지 나간다(메모리 product-name-hygiene).
      const body = cm[1].split('<div class="CaptionComments"')[0]
        .replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/g, '');
      cap = decode(body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''))
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n').trim();
      // 그래도 핸들로 시작하면 떼어낸다(구조가 또 바뀔 때의 폴백)
      if (u && cap.toLowerCase().startsWith(u)) cap = cap.slice(u.length).trim();
      // 🔑 남아 있으면 **그 글은 버린다** — 오염된 캡션을 파이프라인에 넣지 않는다
      // ⚠ 숫자에 **천 단위 쉼표**가 들어간다(`View all 2,098 comments`). `\d+` 로 썼다가 4건을 놓쳤다
      //   (2026-09-30, 규칙 0-P "내 검사 도구가 먼저 틀렸다" 누적 12번째)
      if (/View (?:all )?[\d,]+ comments?/i.test(cap)) {
        log(`  🔴 ${code} 캡션에 인스타 UI 문구가 남았다 — 버린다(embed 구조가 또 바뀐 것)`);
        seen.add(code); await sleep(1200); continue;
      }
    }
    if (!u || cap.length < 10) { empty++; log(`  ⚪ ${code} 작성자/캡션 못 읽음 (비공개·삭제 가능)`); seen.add(code); await sleep(1200); continue; }
    // 게시일을 못 구하면 **조용히 오늘로 떨어뜨리지 않는다** — 그러면 옛 글이 오늘 글로 판정돼
    // "오늘 오픈" 이 잘못 붙는다(2026-09-30 검증 지적). 로그를 남기고 그 글은 버린다.
    const day = postedAt(code);
    if (!day) { empty++; log(`  ⚪ ${code} 게시일 계산 실패 — 버린다(코드 형식이 낯설다)`); seen.add(code); await sleep(1200); continue; }
    (byDay[day] = byDay[day] || []).push({ code, u, fn: '', t: day, ad: false, src: 'embed', cap });
    ok++;
    log(`  ✅ ${code} ← @${u} (${day}) ${cap.slice(0, 40).replace(/\n/g, ' ')}…`);
    seen.add(code);
  } catch (e) { fail++; log(`  🔴 ${code} ${e.message}`); }
  await sleep(1200);
}

for (const [day, rows] of Object.entries(byDay)) {
  const f = path.join(DIR, `${day}.jsonl`);
  appendFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  log(`📝 ${path.relative(ROOT, f)} ← ${rows.length}건`);
}
writeFileSync(SEEN, [...seen].join('\n') + '\n', 'utf8');
log(`끝 — 성공 ${ok} · 빈 글 ${empty} · 실패 ${fail}`);
log('다음: node tools/daily/ig_feed_to_table.mjs <out.tsv> 가 공구 판정·세척을 한다');

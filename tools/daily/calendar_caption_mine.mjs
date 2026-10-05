/**
 * 달력 게시물의 **캡션 원문**에서 일정이 몇 건이나 들어 있는지 캐낸다
 *   사장님 지시 2026-10-05: *"24시간 내내 10월 달력 지금까지 올라온거 전부 파싱해놔라"*
 *
 * 🔑 왜 (2026-10-05 실측)
 *   달력은 그림이라고만 생각하고 253명치 원본을 받아 한 장씩 눈으로 읽고 있었는데,
 *   `iam_yaksa` 는 **캡션에 8건이 전부 적혀 있었다**(「1️⃣ 코큐텐 : 10/1~10/7 …」).
 *   `_cal_strong.json` 의 `cap` 이 100자로 잘려 있어서 안 보였을 뿐이다.
 *   → **그림을 읽기 전에 캡션부터 훑는다.** 공짜이고, 그림보다 정확하다(오타·판독 실수가 없다).
 *
 * 실행: node tools/daily/calendar_caption_mine.mjs [--min=2]
 * 입력: scratchpad/_cal_strong.json (핸들·shortcode) + scratchpad/ig_feed/*.jsonl (캡션 원문)
 * 산출물: scratchpad/calendar_captions.md — 날짜가 2건 이상 보이는 셀러의 캡션 전문
 *        (사람이/내가 읽어 등록한다. 등록 진행은 scratchpad/calendar_read.jsonl)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'scratchpad', '_cal_strong.json');
const FEED = join(ROOT, 'scratchpad', 'ig_feed');
const OUT = join(ROOT, 'scratchpad', 'calendar_captions.md');
const READ = join(ROOT, 'scratchpad', 'calendar_read.jsonl');
const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const MIN = Number((args.find((a) => a.startsWith('--min=')) || '--min=2').slice(6)) || 2;

const list = JSON.parse(readFileSync(SRC, 'utf8'));
const want = new Map(list.map((x) => [x.code, x.u]));
const done = new Set(existsSync(READ)
  ? readFileSync(READ, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).h) : []);

// 캡션 원문 — 같은 shortcode 가 여러 날 jsonl 에 있으면 **가장 긴 것**을 쓴다(잘린 판이 섞여 있다)
const cap = new Map();
for (const f of readdirSync(FEED).filter((x) => x.endsWith('.jsonl'))) {
  for (const l of readFileSync(join(FEED, f), 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    let o; try { o = JSON.parse(l); } catch (_) { continue; }
    if (!want.has(o.code)) continue;
    const c = o.cap || '';
    if (c.length > (cap.get(o.code) || '').length) cap.set(o.code, c);
  }
}
// 「10/5」 「10.5」 「10월 5일」 — 상품명이 붙은 줄만 세려고 날짜 토큰 수로 가늠한다
const DATE = /(?:^|[^0-9])10\s*[./월]\s*([12][0-9]|3[01]|0?[1-9])\s*(?:일)?(?![0-9])/g;
const rows = [];
for (const it of list) {
  const c = cap.get(it.code) || '';
  const n = (c.match(DATE) || []).length;
  rows.push({ u: it.u, code: it.code, n, len: c.length, cap: c, done: done.has(it.u) });
}
rows.sort((a, b) => b.n - a.n);
const hit = rows.filter((r) => r.n >= MIN && !r.done);
const out = [
  `# 달력 셀러 캡션에서 캔 일정 (${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')})`,
  '',
  `전체 ${rows.length}명 · 캡션에 10월 날짜가 ${MIN}건 이상 = **${hit.length}명** · 이미 읽은 셀러는 뺐다`,
  '',
  '> 여기 날짜가 다 있으면 **그림을 안 읽어도 등록할 수 있다.** 없으면 `calimg/<핸들>.jpg` 를 본다.',
  '',
];
for (const r of hit) out.push(`## @${r.u}  (날짜 ${r.n}개 · 캡션 ${r.len}자 · ${r.code})`, '', '```', r.cap.replace(/\s*\n\s*/g, NL), '```', '');
writeFileSync(OUT, out.join(NL), 'utf8');
console.log(`캡션에 날짜 ${MIN}건 이상: ${hit.length}명 / 전체 ${rows.length}명 → ${OUT}`);
console.log('날짜 많은 순 상위 25명:');
for (const r of hit.slice(0, 25)) console.log(`  @${r.u} — 날짜 ${r.n}개 · ${r.len}자`);

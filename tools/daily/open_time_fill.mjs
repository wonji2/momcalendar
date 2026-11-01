// 공구 오픈 시각 채우기 — 진행·예정 공구 행에 「몇 시 오픈」(KST HH:MM)을 셀러 원본에서 찾아 넣는다 (2026-10-27)
//   사장님 2026-10-27: 「공구팡팡은 몇시 오픈인지까지 나오는데 우리도 셀러 캡션 전문을 읽고 ai분석하면 이거 가능할 것 같은데」
//
// 원본 (앞에 있는 것이 이긴다 · 모르면 비워 둔다 — 지어내지 않는다)
//   ① 인포크   블록 시작 시각(start_at/open_at). 정각·30분만, 00:00 은 「시각 없음」 (scratchpad/inpock_harvest.mjs openTime)
//              매번 셀러 인포크를 직접 친다(우리 표 seller_inpock 슬러그만) — --cache 면 날짜 대조 캐시(scratchpad/date_audit/inpock, openTime 없을 수 있음)
//   ② 캡션     셀러 피드 글(scratchpad/ig_feed/*.jsonl, 최근 30일)에서 「그 오픈일 + 시각 + 오픈」 이 한 자리에 있는 것
//              예) 「10/30(목) 오전 10시 오픈」「11월 3일 밤 9시 OPEN」 · 오픈일에 올린 글의 「오늘 10시 오픈」
//              오전·오후 표시가 없는 1~8시는 모호해서 버린다(「8시 오픈」 = 아침? 저녁?). 같은 행에 시각이 둘로 갈리면 버린다
//   ③ 공구팡팡 오늘 카드의 시작 시각(scratchpad/_pangpang_today.tsv 9열 — aggregator_fetch.mjs)
//   상품은 이름 nameMatch 2점(거의 같음)·같은 오픈일일 때만 짝짓는다
// 쓰기  open_time 이 비어 있고 오픈일이 그대로인 행만 (where open_time is null and open_date=옛값). 오픈일이 바뀌면 DB 트리거가 시각을 비운다
//       (supabase/sql/gonggu_open_time_125.sql)
// 실행  node tools/daily/open_time_fill.mjs            예약작업 momcal-open-time (매시간 :35)
//       node tools/daily/open_time_fill.mjs --dry      쓰지 않고 몇 건 채울지만
//       node tools/daily/open_time_fill.mjs --cache    인포크를 직접 치지 않고 캐시로(빠름 · 충돌 판정이 약해진다)
//   셀러 불신 기억 scratchpad/open_time_distrust.json (90일) · 충돌 행 scratchpad/open_time_conflict.json
//   ④ 그래도 없으면 open_time_ai.mjs(AI 캡션 읽기)를 이어서 부른다 — 하루 2번까지, 답은 캡션에 글자 그대로 있을 때만(open_time_src='caption_ai')
// 로그  scratchpad/open_time_log.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { nameMatch, toks, STOP } from './verify_judge.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (...f) => path.join(REPO, 'scratchpad', ...f);
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DRY = process.argv.includes('--dry'), FRESH = !process.argv.includes('--cache');   // 인포크는 늘 직접 친다(날짜 대조 캐시엔 openTime 이 없다 — 검증자 2026-10-27). --cache 면 캐시
const kst = () => new Date(Date.now() + 9 * 3600e3);
const KSTSTAMP = () => kst().toISOString().slice(0, 16).replace('T', ' ');
// 인스타 게시물 코드 → 올린 시각(ms). 코드가 없으면 0
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const codeMs = (c) => { if (!c || !/^[A-Za-z0-9_-]{6,20}$/.test(c)) return 0; let id = 0n; for (const ch of c.slice(0, 11)) id = id * 64n + BigInt(B64.indexOf(ch)); return Number((id >> 23n) + 1314220021721n); };
const TODAY = kst().toISOString().slice(0, 10);
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const LOG = SP('open_time_log.txt');
const log = (s) => { const l = `[${kst().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); if (!DRY) try { fs.appendFileSync(LOG, l + '\n'); } catch {} };
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let qn = 0;
function sql(text, write = false) {
  const rel = `scratchpad/_otf_${process.pid}_${qn++}.sql`;
  fs.writeFileSync(path.join(REPO, rel), text, 'utf8');
  try {
    for (let i = 0; ; i++) {
      try {
        const r = parseRows(execFileSync(CLI, sbArgs(rel), { encoding: 'utf8', cwd: REPO, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
        if (!r.ok) throw new Error(r.why);
        return r.rows;
      } catch (e) { if (write || i >= 2) throw e; }
    }
  } finally { try { fs.unlinkSync(path.join(REPO, rel)); } catch {} }
}

// ── 캡션에서 시각 ─────────────────────────────────────────────────────
//   검증자 2026-10-27 재현으로 고친 것: 「밤 12시」→12:00 · 표시 없는 「9시」(밤 9시였다) · 「오후 2시 시작 추첨」 · 「라이브방송 저녁 8시 시작」 ·
//   「10/25 예정이던 A는 10/28 오전 11시로 변경」(25자 안의 다른 날짜) · 라인업 줄 넘김(사과즙 줄의 시각을 배즙 행에)
const pad = (n) => String(n).padStart(2, '0');
export const MIDNIGHT = '24:00';   // 「00시·자정·밤 12시 오픈」 — 화면엔 안 쓰지만 인포크 값과 **충돌**로 센다(#28848 인포크 10:00 · 캡션 「00시 오픈」)
export function toHHMM(mark, h, mi) {
  h = +h; mi = mi == null ? 0 : +mi;
  if (!(h >= 0 && h <= 24) || !(mi >= 0 && mi < 60)) return '';
  if (/밤|저녁|자정|새벽/.test(mark || '') && h === 12) return MIDNIGHT;
  if (/자정/.test(mark || '') && h !== 0 && h !== 24) return '';   // 「자정 12시·새벽 12시 오픈」 = 0시(검증자 2026-10-27: 낮 12시로 읽었다)
  if (/오후|저녁|밤|pm|p\.m\./i.test(mark || '')) { if (h < 12) h += 12; }
  else if (/낮/.test(mark || '')) { if (h < 6) h += 12; }
  else if (/오전|아침|am|a\.m\./i.test(mark || '')) { if (h === 12) h = 0; }
  else if (/새벽/.test(mark || '')) { /* 그대로 */ }
  else if (h >= 1 && h <= 9) return '';         // 오전·오후 표시 없는 1~9시는 모호하다(「#잠시후9시공구오픈」 이 밤 9시였다)
  if (h === 24 || h === 0) return MIDNIGHT;
  if (h < 6 || h > 23) return '';
  return `${pad(h)}:${pad(mi)}`;
}
const TIME_RE = /(오전|오후|아침|낮|저녁|밤|새벽|자정|am|pm|AM|PM|a\.m\.|p\.m\.)?\s*(\d{1,2})\s*(?:시(?!간)\s*(?:(\d{1,2})\s*분|(반))?|:(\d{2}))|(자정)/g;   // 시(?!간): 「24시간만」 은 길이(검증자 4차)
const OPEN_AFTER = /^[\s~부터에는은(]{0,6}(오픈|open|OPEN|Open)/;          // 「시작」 은 안 친다(추첨·라이브 시작)
const CLOSE_NEAR = /마감|종료|까지|끝/;
const LIVE_NEAR = /라이브|방송|라방|추첨|이벤트|live|홈쇼핑/i;
const LIVE_AFTER = /라이브|방송|라방|추첨|당첨|발표|live|홈쇼핑/i;   // 「오후 2시 오픈이벤트 당첨자 발표」 는 발표 시각(검증자 2차)   // 시각 뒤의 「이벤트」 는 「OPEN 이벤트」 머리말이라 안 친다(검증자 2026-10-27: jasin_yaksa 「오전 10시 OPEN / OPEN 이벤트」 를 버렸다)
// 시각 자리가 라이브·추첨 시각인가: 그 줄 안에서만 본다(앞 20자, 뒤 24자). 다음 줄 머리말이 넘어오지 않게
function liveNear(text, t, end) {
  const ls = text.lastIndexOf('\n', t.index - 1) + 1, le0 = text.indexOf('\n', end), le = le0 < 0 ? text.length : le0;
  return LIVE_NEAR.test(text.slice(Math.max(ls, t.index - 20), t.index)) || LIVE_AFTER.test(text.slice(end, Math.min(le, end + 24)));
}
// 날짜: 「1.3L」「2.5kg」「1.5배」 같은 용량·배수는 날짜가 아니다(검증자 2026-10-27: 1.3L 을 1/3 으로 읽어 라인업으로 오판)
//   단위는 **그 낱말로 끝날 때만** 단위로 본다 — 「9/29 입니다」「10/3 개천절」「10.24 배송」「10/30 mon」 은 날짜다(검증자 2차: 단위 꼬리가 진짜 날짜를 지워 다른 날·다른 상품 시각이 붙었다)
//   앞이 점이어도 막지 않는다 — 「2026.10.15」 의 10.15 는 날짜다
const ANY_DATE = /(^|[^\d])(1[0-2]|0?[1-9])\s*(?:[/.]\s*|월\s*)(3[01]|[12]\d|0?[1-9])(?!\d)(?!(?<=\d\.\d{1,2})(?:(?:L|l|ml|mL|ML|kg|KG|g|cm|mm)(?![A-Za-z])|(?:개|입|팩|병|봉|배)(?![가-힣])|%|인치|리터|키로))/g;
const SHIFT_NEAR = /연기|변경|미뤄|미루|당겨|취소|순연|늦춰|늦어|밀려|밀렸|지연/;
// 「오픈」 신호 — **시각 바로 뒤의 「오픈/open」 하나만** 쓴다 (2026-10-27 검증 4회)
//   「11시에 만나요」「오픈 : 10/28 오전 10시」「공구 기간 … 10시 ~」「날짜·시각뿐인 줄」 같은 약한 신호를 넓혀 봤다가
//   검증자가 회차마다 새 틀린 값(마감·공연·오픈채팅·Q&A·택배·N시간·홈쇼핑)을 찾아 **뺐다**. 틀린 시각이 빈칸보다 나쁘다.
//   약한 꼴로 채움률을 올리려면 규칙이 아니라 AI 후보(open_time_ai)로 보내고, 답 검사를 따로 설계한다(아직 안 함)
//   강한 신호에도 막는 것: 오픈채팅·오픈톡·오픈마켓·오픈라방·오픈 기념 · 같은 줄 뒤에 마감·결과·응모·선정·발표·종료
//   · 「오픈」 이 다음 줄에 있으면 그 줄에 라이브·홈쇼핑·마감이 없을 때만(「저녁 6시⏎CJ온스타일에서 오픈」「밤 9시⏎오픈라방」)
const OPEN_AFTER2 = /^[\s~부터에는은(]{0,6}(?:공구\s*|특가\s*|마켓\s*)?(?:오픈|open)(?!\s*(?:채팅|톡|마켓|라방|라이브|방송|기념))/i;
const LIVE_ANY = /라이브|방송|홈쇼핑|라방|네쇼라|쇼핑\s*라이브|live|온스타일|gs\s*샵|롯데\s*홈|현대\s*홈|홈앤|공영쇼핑|신세계\s*라이브|ns\s*몰|kt\s*알파/i;
const AFTER_BAD = /결과|응모|선정|발표|당첨자|이벤트\s*마감/;   // 「10시 오픈 ~ 10/9 마감」 의 마감은 기간 끝이라 안 친다(30일 회귀)
function openCue(text, t, end) {
  const ls = text.lastIndexOf('\n', t.index - 1) + 1, le0 = text.indexOf('\n', end), le = le0 < 0 ? text.length : le0;
  const after = text.slice(end, Math.min(le, end + 14));                     // 그 줄 안
  if (/^\s*(?:까지|마감|종료)/.test(after)) return false;
  if (OPEN_AFTER2.test(after)) {
    if (/^[\s~부터에는은(]{0,6}(?:공구\s*)?(?:오픈|open)\s*알림/i.test(after) && /\d{1,2}\s*(?:시(?!간)|:\d\d)[^\n]{0,6}(?:오픈|open)(?!\s*알림)/i.test(text.slice(le))) return false;
    return !AFTER_BAD.test(text.slice(end, Math.min(le, end + 30)));
  }
  // 줄바꿈 하나 넘어 「오픈」 — 「10/8 목요일 오전 10시⏎오픈예정이에요」
  const afterX = text.slice(end, end + 14);
  if (!/^[ \t]*\r?\n/.test(afterX) || !OPEN_AFTER2.test(afterX)) return false;
  const ns = text.indexOf('\n', end) + 1, ne0 = text.indexOf('\n', ns), next = text.slice(ns, ne0 < 0 ? text.length : ne0);
  return !LIVE_ANY.test(next) && !AFTER_BAD.test(next.slice(0, 30)) && !LIVE_ANY.test(text.slice(ls, end));
}
// 글 속 날짜들 — 「10/25~10/28」 의 뒤 날짜는 범위 끝(rangeEnd)이다. 범위 끝 바로 뒤의 시각은 범위 **시작일**의 것이다
export function datesOf(text) {
  const ds = [...String(text).matchAll(ANY_DATE)].map((x) => ({ p: x.index + x[1].length, m: +x[2], d: +x[3] }));
  ds.forEach((x, i) => { x.rangeEnd = i > 0 && /[~\-–]\s*$/.test(String(text).slice(Math.max(ds[i - 1].p, x.p - 12), x.p).replace(/\([^)]*\)/g, '')); x.start = x.rangeEnd ? (ds[i - 1].start || ds[i - 1]) : x; });
  return ds;
}
// 라인업(서로 다른 상품의 날짜가 여럿) — 한 상품의 「기간 10/27~10/30」 은 하나로 센다(검증자 2026-10-27)
export function isLineup(text) {
  if (new Set(datesOf(text).filter((x) => !x.rangeEnd).map((x) => `${x.m}/${x.d}`)).size >= 2) return true;
  //   날짜 바로 뒤 첫 낱말이 상품 이름일 때만 센다 — 「9/28일(월) 당첨자 발표」「9/28(월) 오전 10시」「10/27 오픈」 은 목록 줄이 아니다(30일 회귀: 한 상품 글을 라인업으로 봐 맞던 시각을 잃었다)
  const list = String(text).split('\n').filter((l) => /^[^\p{L}\p{N}]*(?:1[0-2]|0?[1-9])\s*[/.]\s*(?:3[01]|[12]\d|0?[1-9])(?!\d)\s*일?\s*(?:\([^)]*\))?\s*(?![월화수목금토일]요일|오늘|내일|단\s|총\s|오전|오후|아침|낮|저녁|밤|새벽|자정|am|pm|일|당첨|발표|오픈|open|마감|배송|출고|발송|공구|예정|부터|까지|cm|mm|kg|ml|g\b|L\b|~|-|–|\d)[\p{L}]/iu.test(l));
  return list.length >= 2;
}
// 캡션의 한 시각 자리(t: TIME_RE 매치)가 그 오픈일의 「오픈」 시각인가 — 규칙·AI 검사 공용
function slotOk(text, t, dates, postDay, openYmd, want, lineup) {
  const end = t.index + t[0].trimEnd().length;   // TIME_RE 의 「시 뒤 공백」 자리 가 줄바꿈까지 먹는다 → 아랫줄이 같은 줄로 보이던 것(아랫줄 「마감」 이 오픈 시각을 지웠다)
  if (!openCue(text, t, end)) return '';
  if (liveNear(text, t, end)) return '';
  if (CLOSE_NEAR.test(text.slice(Math.max(0, t.index - 6), t.index))) return '';
  const om = +openYmd.slice(5, 7), od = +openYmd.slice(8, 10);
  const prev = dates.filter((x) => x.p <= t.index && t.index - x.p <= 25).pop();
  const eff = prev ? prev.start : null;                                   // 범위 끝이면 범위 시작일
  { const ls0 = text.lastIndexOf('\n', t.index - 1) + 1, le0 = text.indexOf('\n', end);   // 「10/28 오픈 예정이었으나 11/1 로 연기」 — 그 줄에 연기·변경이 있으면 안 쓴다
    if (SHIFT_NEAR.test(text.slice(ls0, le0 < 0 ? text.length : le0))) return '';
    // 시각 뒤에 「늦춰집니다·연기·순연」 이 나오면 그 시각은 낡은 것이다(검증자 4차 S33). 앞에 나오면(「일정변경이 있었던 … 밤 8시 오픈」) 새 시각이라 둔다
    //   뒤쪽은 「연기·순연·늦춰·미뤄·밀려·일정/시간/오픈 변경」 만 본다 — 「주문 취소 불가」「옵션 변경」 은 흔한 안내문이라 치면 맞는 시각을 다 잃는다
    //   「오픈」 바로 곁의 연기 말만 — 「소화 속도를 늦춰」「세계자연기금」「잠시 미뤄두고」「다른 상품 일정 변경 안내」 는 아니다(30일 회귀)
    //   「오픈이 늦춰집니다·오픈 일정 연기」 처럼 4자 안 — 「오픈 후 가격 변경됩니다」「오픈으로 홍보가 늦어져」 는 아니다
    if (/(?:오픈|open)[^\n]{0,4}(?:연기|순연|늦춰|늦어|미뤄|밀려|밀렸|변경|지연)|(?:연기|순연|늦춰|미뤄|지연)[^\n]{0,4}(?:오픈|open)/i.test(text.slice(le0 < 0 ? text.length : le0))) return ''; }
  const near = !!eff && eff.m === om && eff.d === od;
  const before = text.slice(Math.max(0, t.index - 12), t.index);
  const todayPost = !prev && postDay === openYmd && /오늘|잠시\s*후|잠시후|곧/.test(before);
  const tmrwPost = !prev && postDay === addDays(openYmd, -1) && /내일/.test(before);
  if (!near && !todayPost && !tmrwPost) return '';
  if (lineup && want.length) {
    const ls = text.lastIndexOf('\n', t.index - 1) + 1, le = text.indexOf('\n', end); const pl = ls > 0 ? text.lastIndexOf('\n', ls - 2) + 1 : ls;
    const line = text.slice(ls, le < 0 ? text.length : le).toLowerCase();
    const above = ls > 0 ? text.slice(pl, ls).toLowerCase() : '';
    const aboveHasDate = [...above.matchAll(ANY_DATE)].length > 0;
    if (!want.some((w) => line.includes(w) || (!aboveHasDate && above.includes(w)))) return '';
  }
  const trail = t[1] ? null : (text.slice(end, end + 6).match(/^\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/i) || [])[1];
  return t[6] ? MIDNIGHT : toHHMM(t[1] || trail, t[2], t[4] ? 30 : (t[3] || t[5]));
}
// 캡션 → { hm, snip } (hm 이 MIDNIGHT 일 수 있다 — 쓰지 않고 충돌 판정에만)
export function captionTime(cap, postDay, openYmd, want = []) {
  const text = String(cap || '').normalize('NFKC');   // 꾸밈 글자(𝐎𝐏𝐄𝐍)를 보통 글자로
  const dates = datesOf(text), lineup = isLineup(text);
  const found = new Map();
  for (const t of text.matchAll(TIME_RE)) {
    const hm = slotOk(text, t, dates, postDay, openYmd, want, lineup);
    const end = t.index + t[0].length;
    if (hm && !found.has(hm)) found.set(hm, text.slice(Math.max(0, t.index - 30), end + 12).replace(/\s+/g, ' ').trim());
  }
  return found.size === 1 ? { hm: [...found.keys()][0], snip: [...found.values()][0] } : { hm: found.size > 1 ? 'MULTI' : '', snip: '' };
}
// AI 답 검사 — AI 가 고른 근거 문장(quote)이 캡션 속 **그 자리**에서 같은 규칙으로 그 시각을 내는가
//   (캡션 전체 문맥에서 quote 위치의 시각 자리만 본다: 「오픈」 에 묶임 · 라이브·추첨 아님 · 날짜는 그 오픈일·범위 시작·내일/오늘)
//   날짜 근거가 문장에 없으면(「목요일 오전 10시 오픈」) 요일이 맞고 글이 오픈 6일 안에 올라왔을 때만
export function quoteOk(quote, time, posts, openYmd, want = []) {
  for (const p of posts) {
    const text = String(p.caption || ''); const at = text.indexOf(quote);
    if (at < 0 || quote.length < 6) continue;
    const dates = datesOf(text), lineup = isLineup(text);
    for (const t of text.matchAll(TIME_RE)) {
      if (t.index < at || t.index >= at + quote.length) continue;
      const hm = slotOk(text, t, dates, p.posted, openYmd, want, lineup);
      if (hm === time) return true;
      // 날짜 없이 요일만: 같은 오픈 낱말·라이브 검사를 지나고 요일이 맞을 때
      const end = t.index + t[0].trimEnd().length;
      const wd = '일월화수목금토'[new Date(openYmd + 'T00:00:00Z').getUTCDay()];
      const hm2 = toHHMM(t[1], t[2], t[4] ? 30 : (t[3] || t[5]));
      if (!hm && hm2 === time && OPEN_AFTER.test(text.slice(end, end + 12)) && !liveNear(text, t, end)
        && new RegExp(`${wd}\\s*요일`).test(text.slice(Math.max(0, t.index - 15), t.index)) && !datesOf(text.slice(Math.max(0, t.index - 25), t.index)).length
        && !/다음\s*주|담주|다다음|이번\s*주|지난\s*주|저번\s*주/.test(text.slice(Math.max(0, t.index - 25), t.index))   // 「다음주 목요일」 은 어느 목요일인지 글만으론 모른다(검증자 2026-10-27)
        && p.posted <= openYmd && p.posted >= addDays(openYmd, -6) && (!lineup || want.some((w) => quote.toLowerCase().includes(w)))) return true;
    }
  }
  return false;
}

// ── 본체 (직접 실행할 때만 — import 로 captionTime 만 쓸 때 DB 를 건드리지 않게: 2026-10-27 시험 중 실수로 61건 쓴 사고) ──
const MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (MAIN) {
const rows = sql(`select id, name, lower(coalesce(insta,'')) insta, open_date from public.gonggu
  where approved and open_time is null and coalesce(insta,'') <> '' and open_date >= '${TODAY}' and open_date <= '${addDays(TODAY, 30)}' order by open_date, id;`);
const handles = [...new Set(rows.map((r) => r.insta))];
// 다시 보기 대상 — 인포크만 근거로 채운 행(오픈 오늘~+7일). 캡션이 새로 들어오면(open_time_collect) 다른 시각인지 본다
const ipRows = sql(`select id, name, lower(coalesce(insta,'')) insta, open_date, open_time from public.gonggu
  where approved and open_time_src = 'inpock' and coalesce(insta,'') <> '' and open_date >= '${TODAY}' and open_date <= '${addDays(TODAY, 7)}' order by open_date, id;`);
const feedHandles = new Set([...handles, ...ipRows.map((r) => r.insta)]);
log(`시작 — 시각 없는 진행·예정 행 ${rows.length}건 · 셀러 ${handles.length}명${FRESH ? ' · 인포크 직접' : ''}`);

// ① 인포크
const inpock = new Map();
if (FRESH) {
  const { harvest } = await import('../../scratchpad/inpock_harvest.mjs');
  const slugOf = new Map(sql('select lower(insta) insta, slug from public.seller_inpock;').map((r) => [r.insta, r.slug]));
  const list = handles.filter((h) => slugOf.has(h));
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (h) => {
      try { const r = await harvest(h, slugOf.get(h)); if (r && r.slug === slugOf.get(h)) inpock.set(h, r.rows || []); } catch {}
    }));
  }
} else {
  for (const h of handles) {
    try { const j = JSON.parse(fs.readFileSync(SP('date_audit', 'inpock', `${h}.json`), 'utf8')); if (j && Array.isArray(j.rows)) inpock.set(h, j.rows); } catch {}
  }
}
// ② 피드 캡션 (최근 30일)
const feed = new Map();
const fdir = SP('ig_feed'); const cut = addDays(TODAY, -30);
if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir).filter((x) => x.endsWith('.jsonl')).sort()) {
  if (f.slice(0, 10) < cut) continue;
  let txt = ''; try { txt = fs.readFileSync(path.join(fdir, f), 'utf8'); } catch { continue; }
  for (const line of txt.split('\n')) {
    if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    const u = String(o.u || '').toLowerCase(); if (!u || !o.cap || !feedHandles.has(u)) continue;
    if (!feed.has(u)) feed.set(u, []); feed.get(u).push({ t: String(o.t || f.slice(0, 10)).slice(0, 10), cap: String(o.cap), code: String(o.code || '') });
  }
}
// ③ 공구팡팡은 **원본이 아니다**(규칙 0-J) — 시각을 쓰지 않고 인포크 값과의 충돌 판정에만 쓴다
const pp = [];
const ppYear = (m) => (+m < +TODAY.slice(5, 7) - 6 ? +TODAY.slice(0, 4) + 1 : +TODAY.slice(0, 4));   // 12월에 1월 일정을 볼 때
try { for (const l of fs.readFileSync(SP('_pangpang_today.tsv'), 'utf8').split(/\r?\n/)) { const c = l.split('\t'); const md = (c[2] || '').match(/^(\d{1,2})\/(\d{1,2})/); if (c.length >= 9 && c[8] && c[8] !== '00:00' && md) pp.push({ h: c[0], name: c[1], open: `${ppYear(md[1])}-${pad(md[1])}-${pad(md[2])}`, t: c[8] }); } } catch {}

// 인포크 「기본값 시각」 — 블록이 그날 3시간 이하 칸(10:00~12:00 등, inpock_harvest shortWin)이면 셀러가 정한 오픈 시각이 아닐 수 있다
//   (diaryrang 블록 11개 전부 10:00~12:00 인데 캡션은 「10/28일 00시 오픈」) → 캡션이 같다고 할 때만 쓴다. 여러 날 이어지는 판매 칸이면 그대로 믿는다
// 셀러 단위 불신 — 그 셀러의 **어느 인포크 블록이든** 캡션이 다른 시각(자정 포함)을 말하면, 그 셀러 인포크 시각은 기본값일 수 있다
//   (diaryrang: 블록 전부 10:00 인데 캡션은 「10/28일 00시 오픈」「오늘 자정 OPEN」 — 검증자 2026-10-27) → 그 셀러는 캡션이 같다고 할 때만 쓴다
const capTimeOf = (h, name, ymd) => {
  const want = toks(name).filter((w) => !STOP.has(w) && w.length >= 2);
  const ts = new Set(); let multi = false;
  for (const p of feed.get(h) || []) {
    if (p.t > ymd || p.t < addDays(ymd, -21) || !want.some((w) => p.cap.toLowerCase().includes(w))) continue;
    const c = captionTime(p.cap, p.t, ymd, want);
    if (c.hm === 'MULTI') multi = true; else if (c.hm) ts.add(c.hm);
  }
  return { ts, multi, want };
};
// 한 번 불신한 셀러는 **90일 기억**한다 — 셀러가 끝난 블록을 지우거나 캡션이 30일 창에서 빠지면 근거가 사라져 다시 믿게 된다
//   (검증자 2026-10-27: diaryrang 10/28 블록만 빠지면 불신이 풀려 10행이 10:00 으로 채워진다)
const DISTRUST_F = SP('open_time_distrust.json');
const distrustMem = (() => { try { return JSON.parse(fs.readFileSync(DISTRUST_F, 'utf8')); } catch { return {}; } })();
const distrust = new Set(Object.entries(distrustMem).filter(([, v]) => v && v.since >= addDays(TODAY, -90)).map(([h]) => h));
for (const [h, blocks] of inpock) for (const c of blocks) {
  if (!c.openTime) continue;
  const { ts } = capTimeOf(h, c.name, c.open);
  if (ts.size && ![...ts].every((x) => x === c.openTime)) {
    if (!distrust.has(h)) distrustMem[h] = { since: TODAY, why: `인포크 「${c.name}」 ${c.open} ${c.openTime} · 캡션 ${[...ts].join('/')}` };
    distrust.add(h); break;
  }
}
// ④ 다시 보기 — 인포크만 근거인 시각을 캡션과 대조한다. 캡션이 **다른 시각(자정 포함)** 을 말하면 비운다(다른 값으로 바꾸지 않는다 —
//   비운 행은 다음 회차에 인포크·캡션이 달라 「충돌」로 남고, 셀러는 불신 목록에 들어간다). 같으면 그대로. 캡션이 없거나 여럿이면 손대지 않는다
//   채우기보다 좁게 본다(금붕어 검토 2026-10-27): 상품 낱말 2개 이상(낱말이 하나뿐이면 그 하나)이 든 글만 · **가장 최근 글 하나**가 말하는 시각만
//   (옛 글 11시·새 글 10시면 새 글이 이긴다) · 그 글이 시각 여럿(MULTI)이면 손대지 않는다 · 저장값과 같으면 그대로
const recheck = [];
let recheckAgree = 0;
const newestCapTime = (h, name, ymd) => {
  const want = toks(name).filter((w) => !STOP.has(w) && w.length >= 2);
  const need = Math.min(2, want.length);
  if (!need) return '';
  // 같은 날 글도 순서가 서게 게시물 코드에서 올린 시각(ms)을 꺼내 정렬한다(코드 = base64 media id, (id>>23)+1314220021721)
  const posts = (feed.get(h) || []).filter((p) => p.t <= ymd && p.t >= addDays(ymd, -21) && want.filter((w) => p.cap.toLowerCase().includes(w)).length >= need)
    .sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : codeMs(b.code) - codeMs(a.code)));
  for (const p of posts) {
    // 더 새 글이 「연기·변경」 을 말하면(시각이 바뀌었을 수 있다) 옛 글로 내려가지 않고 손대지 않는다(검증자 2026-10-27)
    if (SHIFT_NEAR.test(p.cap) && /\d{1,2}\s*(시|:\d\d)/.test(p.cap)) return '';
    const c = captionTime(p.cap, p.t, ymd, want); if (c.hm) return c.hm;   // 시각을 말한 가장 최근 글
  }
  return '';
};
// 다시 보기로 비운 행은 오픈일까지 기억한다 — 다음 회차에 인포크 수확이 실패해 충돌로 안 잡혀도 AI·인포크 단독으로 다시 못 채우게
const BLOCK_F = SP('open_time_recheck_block.json');
const recheckBlock = (() => { try { return JSON.parse(fs.readFileSync(BLOCK_F, 'utf8')); } catch { return {}; } })();
for (const [id, v] of Object.entries(recheckBlock)) if (!v || v.open_date < TODAY) delete recheckBlock[id];
for (const r of ipRows) {
  const hm = newestCapTime(r.insta, r.name, r.open_date);
  if (!hm || hm === 'MULTI') continue;
  if (hm === r.open_time) { recheckAgree++; continue; }
  const ts = [hm];
  recheck.push({ ...r, cap: ts.map((x) => (x === MIDNIGHT ? '00:00(자정)' : x)).join('/') });
  if (!distrust.has(r.insta)) distrustMem[r.insta] = { since: TODAY, why: `다시 보기 「${r.name}」 ${r.open_date} 인포크 ${r.open_time} · 캡션 ${[...ts].join('/')}` };
  distrust.add(r.insta);
}
log(`다시 보기 — 인포크만 근거 ${ipRows.length}행 중 캡션 같음 ${recheckAgree} · 캡션 다름 ${recheck.length}`);
for (const x of recheck.slice(0, 20)) log(`  ↺ #${x.id} ${x.insta} 「${x.name}」 ${x.open_date} 인포크 ${x.open_time} · 캡션 ${x.cap}`);
if (!DRY && recheck.length) {
  // 되돌리기 기록(규칙 0-S 6) — id·옛 시각
  const tsv = SP('handoff-log', `open_time_recheck_${TODAY}.tsv`);
  //   기록을 못 쓰면 비우지 않는다(검증자 2026-10-27: 기록 실패를 삼키고 비웠다). 후보를 먼저 적고(cleared=?), 실제로 비운 id 를 뒤에 한 줄 더 적는다
  //   → 되돌릴 때는 「cleared」 줄에 있는 id 만 쓴다
  let tsvOk = false;
  try {
    if (!fs.existsSync(tsv)) fs.writeFileSync(tsv, 'id\tinsta\tname\topen_date\told_time\told_src\tcaption\n');
    fs.appendFileSync(tsv, recheck.map((x) => [x.id, x.insta, x.name, x.open_date, x.open_time, 'inpock', x.cap].join('\t')).join('\n') + '\n');
    tsvOk = true;
  } catch (e) { log(`🔴 되돌리기 기록을 못 써서 다시 보기 비우기를 건너뜀: ${String(e.message).slice(0, 100)}`); process.exitCode = 1; }
  const vals = recheck.map((x) => `(${+x.id}, ${q(x.open_date)}, ${q(x.open_time)})`).join(',');
  if (tsvOk) try {
    const got = sql(`update public.gonggu g set open_time=null, open_time_src=null from (values ${vals}) v(id, od, t)
      where g.id=v.id and g.open_time=v.t and g.open_time_src='inpock' and g.open_date=v.od returning g.id;`, true);
    const ids = got.map((x) => +x.id);
    try { fs.appendFileSync(tsv, `# cleared ${KSTSTAMP()}\t${ids.join(',')}\n`); } catch (e) { log(`🔴 「# cleared」 줄을 못 씀 — 되돌릴 땐 후보 줄의 옛 값을 where open_time is null 로: ${String(e.message).slice(0, 80)}`); process.exitCode = 1; }
    for (const x of recheck) if (ids.includes(+x.id)) recheckBlock[x.id] = { open_date: x.open_date, old: x.open_time, cap: x.cap, since: TODAY };
    log(`  다시 보기로 비움 ${got.length}건 (되돌리기 ${path.relative(REPO, tsv)} 의 「# cleared」 줄 id 만)`);
  } catch (e) { log(`🔴 다시 보기 쓰기 실패: ${String(e.message).slice(0, 120)}`); process.exitCode = 1; }
}
if (!DRY) { try { fs.writeFileSync(DISTRUST_F, JSON.stringify(distrustMem, null, 1)); } catch (e) { log(`⚠ 불신 목록 못 씀: ${e.message}`); }
  try { fs.writeFileSync(BLOCK_F, JSON.stringify(recheckBlock, null, 1)); } catch (e) { log(`🔴 다시 보기 기억 못 씀: ${e.message}`); process.exitCode = 1; } }
const fills = [], by = { inpock: 0, caption: 0 }, conflict = [], skipDefault = []; let agree = 0;
for (const r of rows) {
  let t = '', src = '';
  const ip = (inpock.get(r.insta) || []).filter((c) => c.openTime && c.open === r.open_date && nameMatch(r.name, c.name) >= 2);
  const ipT = [...new Set(ip.map((c) => c.openTime))];
  const ipt = ipT.length === 1 ? ipT[0] : '', ipEv = ipt ? `인포크 「${ip[0].name}」` : '';
  const ipShort = ip.some((c) => c.shortWin);
  const { ts: tset, multi } = capTimeOf(r.insta, r.name, r.open_date);
  const capT = !multi && tset.size === 1 ? [...tset][0] : '';
  const ppT = [...new Set(pp.filter((x) => x.h === r.insta && x.open === r.open_date && nameMatch(r.name, x.name) >= 2).map((x) => x.t))];
  const disagree = (ipt && capT && ipt !== capT) || multi || tset.size > 1 || (ipt && ppT.length && !ppT.includes(ipt))
    || (capT && capT !== MIDNIGHT && ppT.length && !ppT.includes(capT));   // 공구팡팡과 캡션이 달라도 비운다
  if (disagree) { conflict.push(`#${r.id} ${r.insta} 「${r.name}」 인포크 ${ipt || '-'} · 캡션 ${[...tset].join('/') || (multi ? '여럿' : '-')} · 공구팡팡 ${ppT.join('/') || '-'}`); r.conflict = true; }
  else if (recheckBlock[r.id]) { /* 다시 보기로 비운 행 — 오픈일까지 빈칸 */ }
  else if (capT && capT !== MIDNIGHT) { t = capT; src = 'caption'; r.ev = `캡션 ${capT}` + (ipt ? ' (인포크도 같음)' : ''); if (ipt) agree++; }
  else if (ipt && !capT && !ipShort && !distrust.has(r.insta) && !recheckBlock[r.id]) { t = ipt; src = 'inpock'; r.ev = ipEv; }
  else if (ipt && !capT) skipDefault.push(r.id);
  if (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) { fills.push({ ...r, t, src }); by[src]++; }
}
// AI 단계가 「일부러 비운」 행을 다시 채우지 않게 충돌 행 id 를 남긴다
//   다시 보기로 비운 행도 넣는다 — 같은 회차의 AI 단계가 곧바로 다시 채우지 않게
if (!DRY) try { fs.writeFileSync(SP('open_time_conflict.json'), JSON.stringify([...rows.filter((r) => r.conflict).map((r) => +r.id), ...recheck.map((x) => +x.id), ...Object.keys(recheckBlock).map(Number)])); } catch {}
log(`찾음 ${fills.length}건 (인포크 ${by.inpock} · 캡션 ${by.caption}) · 인포크=캡션 일치 ${agree} · 서로 달라 비움 ${conflict.length} · 인포크 기본값 의심이라 안 씀 ${skipDefault.length} (셀러 불신 ${distrust.size}명: ${[...distrust].slice(0, 8).join(',')})`);
if (conflict.length) for (const c of conflict.slice(0, 20)) log(`  ⚠ ${c}`);
if (DRY) { for (const f of fills) console.log(`  #${f.id} ${f.insta} 「${f.name}」 ${f.open_date} ${f.t} (${f.src}) ← ${f.ev || ''}`); process.exitCode = 0; }
else {
  let done = 0;
  for (let i = 0; i < fills.length; i += 200) {
    const part = fills.slice(i, i + 200);
    const vals = part.map((f) => `(${+f.id}, ${q(f.open_date)}, ${q(f.t)}, ${q(f.src)})`).join(',');
    try {
      done += sql(`update public.gonggu g set open_time=v.t, open_time_src=v.s from (values ${vals}) v(id, od, t, s)
        where g.id=v.id and g.open_time is null and g.open_date=v.od returning g.id;`, true).length;
    } catch (e) { log(`🔴 쓰기 실패: ${String(e.message).slice(0, 120)}`); process.exitCode = 1; }
  }
  log(`끝 — ${done}건 채움`);
  // 규칙이 못 찾은 것 중 캡션에 「시각+오픈」 이 있는 행만 AI 가 읽는다(open_time_ai.mjs — 하루 2번까지·답은 캡션 글자 그대로일 때만)
  try { execFileSync(process.execPath, [path.join(REPO, 'tools', 'daily', 'open_time_ai.mjs')], { cwd: REPO, encoding: 'utf8', timeout: 20 * 60e3, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { log(`⚠ AI 읽기 실패: ${String(e.stderr || e.message).slice(0, 120)}`); }
}
}

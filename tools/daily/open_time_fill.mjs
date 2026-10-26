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
  if (/밤|저녁|자정|새벽/.test(mark || '') && h === 12) return MIDNIGHT;   // 「자정 12시·새벽 12시 오픈」 = 0시(검증자 2026-10-27: 낮 12시로 읽었다)
  if (/오후|저녁|밤|pm/i.test(mark || '')) { if (h < 12) h += 12; }
  else if (/낮/.test(mark || '')) { if (h < 6) h += 12; }
  else if (/오전|아침|am/i.test(mark || '')) { if (h === 12) h = 0; }
  else if (/새벽/.test(mark || '')) { /* 그대로 */ }
  else if (h >= 1 && h <= 9) return '';         // 오전·오후 표시 없는 1~9시는 모호하다(「#잠시후9시공구오픈」 이 밤 9시였다)
  if (h === 24 || h === 0) return MIDNIGHT;
  if (h < 6 || h > 23) return '';
  return `${pad(h)}:${pad(mi)}`;
}
const TIME_RE = /(오전|오후|아침|낮|저녁|밤|새벽|자정|am|pm|AM|PM)?\s*(\d{1,2})\s*(?:시\s*(?:(\d{1,2})\s*분|(반))?|:(\d{2}))|(자정)/g;
const OPEN_AFTER = /^[\s~부터에는은(]{0,6}(오픈|open|OPEN|Open)/;          // 「시작」 은 안 친다(추첨·라이브 시작)
const CLOSE_NEAR = /마감|종료|까지|끝/;
const LIVE_NEAR = /라이브|방송|라방|추첨|이벤트/;
const ANY_DATE = /(^|[^\d])(1[0-2]|0?[1-9])\s*(?:[/.]\s*|월\s*)(3[01]|[12]\d|0?[1-9])(?!\d)/g;
const SHIFT_NEAR = /연기|변경|미뤄|미루|당겨|취소/;
// 글 속 날짜들 — 「10/25~10/28」 의 뒤 날짜는 범위 끝(rangeEnd)이다. 범위 끝 바로 뒤의 시각은 범위 **시작일**의 것이다
export function datesOf(text) {
  const ds = [...String(text).matchAll(ANY_DATE)].map((x) => ({ p: x.index + x[1].length, m: +x[2], d: +x[3] }));
  ds.forEach((x, i) => { x.rangeEnd = i > 0 && /[~\-–]\s*$/.test(String(text).slice(Math.max(ds[i - 1].p, x.p - 12), x.p).replace(/\([^)]*\)/g, '')); x.start = x.rangeEnd ? (ds[i - 1].start || ds[i - 1]) : x; });
  return ds;
}
// 라인업(서로 다른 상품의 날짜가 여럿) — 한 상품의 「기간 10/27~10/30」 은 하나로 센다(검증자 2026-10-27)
export function isLineup(text) {
  return new Set(datesOf(text).filter((x) => !x.rangeEnd).map((x) => `${x.m}/${x.d}`)).size >= 2;
}
// 캡션의 한 시각 자리(t: TIME_RE 매치)가 그 오픈일의 「오픈」 시각인가 — 규칙·AI 검사 공용
function slotOk(text, t, dates, postDay, openYmd, want, lineup) {
  const end = t.index + t[0].length;
  if (!OPEN_AFTER.test(text.slice(end, end + 12))) return '';
  if (LIVE_NEAR.test(text.slice(Math.max(0, t.index - 20), end + 24))) return '';
  if (CLOSE_NEAR.test(text.slice(Math.max(0, t.index - 6), t.index))) return '';
  const om = +openYmd.slice(5, 7), od = +openYmd.slice(8, 10);
  const prev = dates.filter((x) => x.p <= t.index && t.index - x.p <= 25).pop();
  const eff = prev ? prev.start : null;                                   // 범위 끝이면 범위 시작일
  { const ls0 = text.lastIndexOf('\n', t.index - 1) + 1, le0 = text.indexOf('\n', end);   // 「10/28 오픈 예정이었으나 11/1 로 연기」 — 그 줄에 연기·변경이 있으면 안 쓴다
    if (SHIFT_NEAR.test(text.slice(ls0, le0 < 0 ? text.length : le0))) return ''; }
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
  return t[6] ? MIDNIGHT : toHHMM(t[1], t[2], t[4] ? 30 : (t[3] || t[5]));
}
// 캡션 → { hm, snip } (hm 이 MIDNIGHT 일 수 있다 — 쓰지 않고 충돌 판정에만)
export function captionTime(cap, postDay, openYmd, want = []) {
  const text = String(cap || '');
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
      const end = t.index + t[0].length;
      const wd = '일월화수목금토'[new Date(openYmd + 'T00:00:00Z').getUTCDay()];
      const hm2 = toHHMM(t[1], t[2], t[4] ? 30 : (t[3] || t[5]));
      if (!hm && hm2 === time && OPEN_AFTER.test(text.slice(end, end + 12)) && !LIVE_NEAR.test(text.slice(Math.max(0, t.index - 20), end + 24))
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
    const u = String(o.u || '').toLowerCase(); if (!u || !o.cap || !handles.includes(u)) continue;
    if (!feed.has(u)) feed.set(u, []); feed.get(u).push({ t: String(o.t || f.slice(0, 10)).slice(0, 10), cap: String(o.cap) });
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
if (!DRY) try { fs.writeFileSync(DISTRUST_F, JSON.stringify(distrustMem, null, 1)); } catch {}
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
  else if (capT && capT !== MIDNIGHT) { t = capT; src = 'caption'; r.ev = `캡션 ${capT}` + (ipt ? ' (인포크도 같음)' : ''); if (ipt) agree++; }
  else if (ipt && !capT && !ipShort && !distrust.has(r.insta)) { t = ipt; src = 'inpock'; r.ev = ipEv; }
  else if (ipt && !capT) skipDefault.push(r.id);
  if (t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) { fills.push({ ...r, t, src }); by[src]++; }
}
// AI 단계가 「일부러 비운」 행을 다시 채우지 않게 충돌 행 id 를 남긴다
if (!DRY) try { fs.writeFileSync(SP('open_time_conflict.json'), JSON.stringify(rows.filter((r) => r.conflict).map((r) => +r.id))); } catch {}
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

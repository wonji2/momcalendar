// 🔎 공구팡팡 ↔ 우리 DB 갭 비교 — 「공구팡팡 오늘 갯수보고 우리도 맞춰서 계속 스윕해」 (사장님 2026-10-15)
//
// 공구팡팡은 공개 Supabase(자기 사이트 JS 에 anon 키가 그대로 실려 있다)로 오퍼를 읽는다.
// 이 도구는 **그 사이트가 손님에게 보여 주는 같은 공개 목록**에서 오늘~모레 오픈 오퍼를 세어
//   ① 건수를 우리 DB(approved, open_date)와 나란히 보여 주고
//   ② 우리 DB 에 셀러가 없거나 같은 상품이 없는 오퍼의 **인스타 핸들만** 명단으로 뽑는다(상품·날짜는 셀러 원본으로 맞춘다 — 규칙 8).
//
//   node tools/daily/pangpang_gap.mjs [--days 3]        → scratchpad/_todo_pp_gap.txt (핸들 명단)
//   이어서: node tools/daily/parsing_nightly.mjs --todo scratchpad/_todo_pp_gap.txt --n 60
// 상태·로그: scratchpad/pangpang_gap_log.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB_CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DAYS = Number((process.argv.find((a) => a === '--days') ? process.argv[process.argv.indexOf('--days') + 1] : 3)) || 3;
const log = (s) => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); console.log(s); try { fs.appendFileSync(path.join(ROOT, 'scratchpad', 'pangpang_gap_log.txt'), `[${t}] ${s}\n`); } catch { } };

// ① 공개 키 — 사이트가 손님에게 내려보내는 JS 에서 읽는다(캘린더 페이지의 청크)
const html = await (await fetch('https://09pangpang.com/calendar', { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"' ]+\.js/g)].map((m) => m[0]))];
let key = '';
for (const p of chunks) {
  const t = await (await fetch('https://09pangpang.com' + p)).text();
  const m = t.match(/(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/);
  if (m) { key = m[1]; break; }
}
if (!key) { log('⚠ 공구팡팡 공개 키를 못 찾았다 — 사이트 구조가 바뀌었을 수 있다'); process.exit(1); }
const B = 'https://phgrmcinchojnqmxtdup.supabase.co/rest/v1';
const H = { apikey: key, Authorization: 'Bearer ' + key };

// ② 오늘(KST)부터 DAYS 일 오픈 오퍼
const kst = (s) => new Date(new Date(s).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const from = new Date(today + 'T00:00:00+09:00').toISOString();
const to = new Date(new Date(today + 'T00:00:00+09:00').getTime() + DAYS * 864e5).toISOString();
const todayEnd = new Date(new Date(today + 'T00:00:00+09:00').getTime() + 864e5).toISOString();
const offers = [];
for (let off = 0; off < 2000; off += 500) {
  // 🔑 팡팡 화면의 「오늘」은 **오늘이 기간 안에 든 것 전부**(수백 건, 무한 스크롤)다 — 오픈일이 그날인 것만 세면 51건뿐이다
  const r = await fetch(`${B}/offers?select=id,title,start_at,end_at,account_id&start_at=lt.${todayEnd}&end_at=gte.${from}&order=start_at.desc&limit=500&offset=${off}`, { headers: H });
  const j = await r.json(); if (!Array.isArray(j) || !j.length) break; offers.push(...j); if (j.length < 500) break;
}
const fresh = await (await fetch(`${B}/offers?select=created_at&order=created_at.desc&limit=1`, { headers: H })).json();
const lastIn = fresh && fresh[0] && fresh[0].created_at ? fresh[0].created_at.slice(0, 16) : '?';
const staleDays = lastIn === '?' ? 99 : Math.floor((Date.now() - new Date(lastIn + ':00Z').getTime()) / 864e5);
if (staleDays >= 2) log(`⚠ 공구팡팡 데이터가 ${staleDays}일째 안 늘었다(마지막 등록 ${lastIn}) — 이 대조는 그 시점까지의 진행분이다`);
const ids = [...new Set(offers.map((o) => o.account_id))];
const acc = {};
for (let i = 0; i < ids.length; i += 100) {
  const r = await fetch(`${B}/accounts?select=id,instagram_handle&id=in.(${ids.slice(i, i + 100).join(',')})`, { headers: H });
  for (const a of await r.json()) acc[a.id] = a;
}
const rows = offers.map((o) => ({ u: ((acc[o.account_id] || {}).instagram_handle || '').toLowerCase(), title: o.title, open: kst(o.start_at) }));
const per = {}; rows.forEach((r) => (per[r.open] = (per[r.open] || 0) + 1));

// ③ 우리 DB
const q = path.join(ROOT, 'scratchpad', '_q_pp_gap.sql');
const lastDay = kst(new Date(new Date(today + 'T00:00:00+09:00').getTime() + (DAYS - 1) * 864e5));
fs.writeFileSync(q, `select insta, name, open_date from public.gonggu where approved and open_date <= '${lastDay}' and end_date >= '${today}';`);
const out = execFileSync(SB_CLI, ['db', 'query', '--linked', '--output-format', 'json', '-f', q], { encoding: 'utf8', maxBuffer: 64e6, cwd: ROOT });
const ours = JSON.parse(out.slice(out.indexOf('{'))).rows;
const ourPer = {}; ours.forEach((r) => (ourPer[r.open_date] = (ourPer[r.open_date] || 0) + 1));
const norm = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const byHandle = {};
for (const r of ours) (byHandle[(r.insta || '').toLowerCase()] ||= []).push(norm(r.name));
const gaps = [];
for (const o of rows) {
  if (!o.u) continue;
  const mine = byHandle[o.u];
  const t = norm(o.title);
  if (!mine || !mine.some((n) => n && t && (n.includes(t.slice(0, 4)) || t.includes(n.slice(0, 4))))) gaps.push(o);
}
const handles = [...new Set(gaps.map((o) => o.u))];
fs.writeFileSync(path.join(ROOT, 'scratchpad', '_todo_pp_gap.txt'), handles.join('\n'));
log(`팡팡 진행중 ${rows.length}건(셀러 ${new Set(rows.map((r) => r.u)).size}) · 우리 진행중 ${ours.length}행 · 갭 오퍼 ${gaps.length}건 · 수확 핸들 ${handles.length}명 → _todo_pp_gap.txt`);

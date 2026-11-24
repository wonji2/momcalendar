// 검색 노출 매일 점검 → 다음 조치 판정 장부 (사장님 지시 2026-11-25 「니가다하고 8월 구글 검색으로 돌려놔 빨리 색인 매일 점검해서 맞는 방향으로 디벨롭해」)
//
//   목표: 구글 노출·클릭을 8월 하순 수준(08-16~31 16일 클릭 1,323 · 노출 12,315 → 7일로 환산 클릭 579 · 노출 5,388)으로 되돌린다.
//   무엇을 매일 재나:
//     ① 서치콘솔 검색 실적(공식 API, 읽기 전용) — 최근 7일 vs 그 전 7일, 종류별(홈·허브·s·p·g·gg) 클릭·노출, 「맘캘」 이름 검색을 뺀 노출
//     ② 색인 표본 — index_sample.mjs 가 같은 회차 바로 앞에서 ops_status 'seo-index' 에 쓴 종류별 색인 수(어제 대비)
//     ③ 사이트맵 종류별 주소 수(라이브) · 얇은 g noindex 장수(tools/seo/g_noindex.txt)
//   판정(아래 RULES): 무엇이 늘고 줄었는지 → 다음 조치 한 줄씩. 이름 뺀 노출이 30% 넘게 줄거나 색인 표본이 한 종류에서 3개 이상 줄면 health_alerts 'seo:개선'(관리자 「고장 난 것」).
//   스스로 고치는 부분: 얇은 g·끝난 gg 의 색인 제외는 매일 빌드가 지킴 명단(16개월 노출)을 새로 받아 정한다 → 노출이 생긴 페이지는 다음 날 저절로 색인으로 돌아온다.
//                      판정이 「되돌리기」를 말하면 사람(세션)이 build.ps1 -GTier off / -GgKeepDays 21 로 되돌린다(자동으로 대량 변경을 하지 않는다 — 규칙 「막는 장치는 승인 먼저」).
//   기록:  Supabase ops_status id='seo-develop' — payload.days 에 하루 한 줄(최근 180일). 사람이 읽는 판: node tools/seo/seo_develop.mjs --show (scratchpad/seo_develop_ledger.md 로도 쓴다)
//   어디서·언제: 깃허브 Actions seo-index-sample.yml(색인 측정 바로 뒤) — 07:30·09:07·11:43 KST 세 번 걸고 오늘 회차가 있으면 건너뛴다(--once). PC 가 꺼져도 돈다.
//   열쇠:  GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN · SUPABASE_SERVICE_KEY (Secrets / 로컬은 tools/daily/.env)
//   한도:  서치콘솔 검색 실적 API 하루 몇 번 · ops_status 한 줄(수십 KB) — 한도 영향 없음
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://momcalendar.com/';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry'), SHOW = process.argv.includes('--show'), ONCE = process.argv.includes('--once');
const envFile = () => { try { return Object.fromEntries(fs.readFileSync(path.join(ROOT, 'tools/daily/.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } };
const E = { ...envFile(), ...process.env };
const CID = E.GSC_CLIENT_ID || E.BLOGGER_CLIENT_ID, CSEC = E.GSC_CLIENT_SECRET || E.BLOGGER_CLIENT_SECRET, RT = E.GSC_REFRESH_TOKEN;
const SK = E.SUPABASE_SERVICE_KEY || E.SB_SERVICE_KEY;
const die = (m) => { console.error('🔴 ' + m); process.exit(1); };
if (!SK) die('SUPABASE_SERVICE_KEY 가 없다');
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const sb = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });
const alertSet = async (kind, detail) => { if (DRY) return; await sb(`health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE' }); if (detail) await sb('health_alerts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: detail.slice(0, 1800) }) }); };
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TARGET7 = { clk: 579, imp: 5388 };   // 8월 하순 16일(08-16~31) 클릭 1,323 · 노출 12,315 를 7일로 환산
const FOLDERS = ['홈', '허브', 's 셀러', 'p 제품', 'g 브랜드', 'gg 공구'];
const folderOf = (p) => { if (p === '/' || p === '') return '홈'; const m = p.match(/^\/(gg|g|p|s)\//); if (m) return { gg: 'gg 공구', g: 'g 브랜드', p: 'p 제품', s: 's 셀러' }[m[1]]; return '허브'; };

let state = { days: [] };
try { const r = await sb('ops_status?id=eq.seo-develop&select=payload').then((x) => x.json()); if (r?.[0]?.payload) state = { days: [], ...r[0].payload }; } catch {}

const fmt = (d) => {
  const L = [];
  L.push(`## ${d.day}`);
  if (d.gsc) {
    const g = d.gsc;
    L.push(`- 서치콘솔 최근 7일(${g.range}): 클릭 ${g.cur.clk} · 노출 ${g.cur.imp} (그 전 7일 ${g.prev.clk} · ${g.prev.imp}) · 8월 목표 대비 클릭 ${Math.round((g.cur.clk / TARGET7.clk) * 100)}% · 노출 ${Math.round((g.cur.imp / TARGET7.imp) * 100)}%`);
    L.push(`- 이름 검색(맘캘) 뺀 노출: ${g.cur.nb} (그 전 7일 ${g.prev.nb})`);
    L.push(`- 종류별 노출 7일: ${FOLDERS.map((f) => `${f} ${g.byF[f]?.imp || 0}(${g.byFP[f]?.imp || 0})`).join(' · ')}  ← 괄호는 그 전 7일`);
  }
  if (d.idx) L.push(`- 색인 표본(${d.idx.day}): ${d.idx.total} · ${FOLDERS.map((f) => `${f} ${d.idx.byF[f] || '-'}`).join(' · ')}${d.idx.prevDay ? `  (직전 ${d.idx.prevDay}: ${d.idx.prevTotal})` : ''}`);
  if (d.sm) L.push(`- 사이트맵(라이브): ${Object.entries(d.sm).map(([k, v]) => `${k} ${v}`).join(' · ')} · 얇은 g noindex ${d.gNo ?? '?'}장`);
  L.push(`- 판정: ${d.verdict.join(' / ')}`);
  L.push(`- 다음 조치: ${d.next.join(' / ')}`);
  return L.join('\n');
};

if (SHOW) {
  const md = `# 검색 노출 매일 점검 장부 (ops_status 'seo-develop')\n\n목표: 8월 하순 7일 환산 클릭 ${TARGET7.clk} · 노출 ${TARGET7.imp}\n\n` + [...state.days].reverse().map(fmt).join('\n\n') + '\n';
  console.log(md);
  try { fs.writeFileSync(path.join(ROOT, 'scratchpad/seo_develop_ledger.md'), md); } catch {}
  process.exit(0);
}
if (ONCE && state.days.some((x) => x.day === today && x.gsc)) { console.log(`오늘(${today}) 장부가 이미 있다 — 건너뜀`); process.exit(0); }

// ① 서치콘솔
let gsc = null, gscErr = '';
try {
  if (!CID || !CSEC || !RT) throw new Error('서치콘솔 열쇠 없음');
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: RT, grant_type: 'refresh_token' }) }).then((x) => x.json());
  if (!tok.access_token) throw new Error('토큰 갱신 실패 ' + (tok.error || ''));
  const q = async (body) => { const j = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json()); if (j.error) throw new Error(j.error.message); return j.rows || []; };
  // 서치콘솔은 2~3일 늦게 찬다 → 데이터가 있는 마지막 날을 끝으로 잡는다
  const ymd = (d) => d.toISOString().slice(0, 10);
  const days = await q({ startDate: ymd(new Date(Date.now() - 20 * 864e5)), endDate: ymd(new Date()), dimensions: ['date'], rowLimit: 30 });
  if (!days.length) throw new Error('최근 20일 검색 실적이 비었다');
  const last = days.map((r) => r.keys[0]).sort().pop();
  const add = (s, n) => ymd(new Date(Date.parse(s) + n * 864e5));
  const cur = [add(last, -6), last], prev = [add(last, -13), add(last, -7)];
  const tot = async ([a, b], extra = {}) => { const r = await q({ startDate: a, endDate: b, rowLimit: 1, ...extra }); return { clk: r[0]?.clicks || 0, imp: r[0]?.impressions || 0 }; };
  const nb = async (rg) => (await tot(rg, { dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'notContains', expression: '맘캘' }] }] })).imp;
  const byFolder = async ([a, b]) => { const o = {}; for (let at = 0; ; at += 25000) { const r = await q({ startDate: a, endDate: b, dimensions: ['page'], rowLimit: 25000, startRow: at }); for (const x of r) { let p; try { p = decodeURIComponent(new URL(x.keys[0]).pathname); } catch { continue; } const f = folderOf(p); (o[f] ||= { clk: 0, imp: 0 }); o[f].clk += x.clicks; o[f].imp += x.impressions; } if (r.length < 25000) break; } return o; };
  const c = await tot(cur), p = await tot(prev);
  c.nb = await nb(cur); p.nb = await nb(prev);
  gsc = { range: `${cur[0]}~${cur[1]}`, cur: c, prev: p, byF: await byFolder(cur), byFP: await byFolder(prev) };
} catch (e) { gscErr = e.message; console.error('⚠ 서치콘솔: ' + e.message); }

// ② 색인 표본(index_sample.mjs 결과)
let idx = null;
try {
  const r = await sb('ops_status?id=eq.seo-index&select=payload').then((x) => x.json());
  const runs = (r?.[0]?.payload?.runs || []).filter((x) => !x.apiErr);
  const lastRun = runs[runs.length - 1], prevRun = [...runs].reverse().find((x) => x.day !== lastRun?.day && x.n === lastRun?.n);
  if (lastRun) idx = { day: lastRun.day, total: `${lastRun.idx}/${lastRun.n}`, idxN: lastRun.idx, byF: Object.fromEntries(Object.entries(lastRun.byFolder || {}).map(([k, v]) => [k, `${v.idx}/${v.n}`])), byFN: Object.fromEntries(Object.entries(lastRun.byFolder || {}).map(([k, v]) => [k, v.idx])), prevDay: prevRun?.day, prevTotal: prevRun ? `${prevRun.idx}/${prevRun.n}` : '', prevN: prevRun?.idx, prevByFN: prevRun ? Object.fromEntries(Object.entries(prevRun.byFolder || {}).map(([k, v]) => [k, v.idx])) : null, lastmodPct: lastRun.lastmod?.pct };
} catch {}

// ③ 사이트맵·얇은 g
const sm = {};
for (const [k, nm] of [['main', 'sitemap-main.xml'], ['brand', 'sitemap-brand.xml'], ['product', 'sitemap-product.xml'], ['seller', 'sitemap-seller.xml'], ['gonggu', 'sitemap-gonggu.xml']]) {
  try { const x = await fetch(SITE + nm).then((r) => r.text()); sm[k] = (x.match(/<loc>/g) || []).length; } catch { sm[k] = '?'; }
}
let gNo = null; try { const t = fs.readFileSync(path.join(ROOT, 'tools/seo/g_noindex.txt'), 'utf8'); gNo = t.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).length; } catch {}

// 판정 RULES — 늘면 유지, 줄면 원인 후보와 되돌리기 길을 적는다
const verdict = [], next = [], alarm = [];
if (gsc) {
  const { cur: c, prev: p } = gsc;
  const ch = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
  verdict.push(`노출 7일 ${ch(c.imp, p.imp) >= 0 ? '+' : ''}${ch(c.imp, p.imp)}% · 클릭 ${ch(c.clk, p.clk) >= 0 ? '+' : ''}${ch(c.clk, p.clk)}% · 이름 뺀 노출 ${p.nb} → ${c.nb}`);
  for (const f of FOLDERS) {
    const a = gsc.byF[f]?.imp || 0, b = gsc.byFP[f]?.imp || 0;
    if (b >= 30 && a < b * 0.6) verdict.push(`${f} 노출 감소 ${b}→${a}`);   // 종류별은 판정 줄만 — 11월 실측: 하루 노출이 0~100 으로 튄다(08·09·15일). 경보는 이름 뺀 노출·색인 표본 하락에만
    else if (a >= b * 1.3 && a - b >= 20) verdict.push(`${f} 노출 증가 ${b}→${a}`);
  }
  if (c.imp >= TARGET7.imp && c.clk >= TARGET7.clk) next.push('8월 수준 회복 — 지금 설정 유지, 늘어나는 종류에 본문 보강을 먼저 넣는다');
  else if (c.nb > p.nb * 1.2 && c.nb - p.nb >= 20) next.push('이름 뺀 노출이 늘고 있다 — 색인 정리 방향 유지(되돌리지 않는다)');
  else if (c.nb < p.nb * 0.7 && p.nb >= 30) { next.push('이름 뺀 노출이 30% 넘게 줄었다 — 최근 7일 빌드 변경(g 계층·gg 창·본문)을 하나씩 되돌려 본다'); alarm.push(`이름 뺀 노출 ${p.nb}→${c.nb}`); }
  else next.push('큰 변화 없음 — 색인 정리 효과는 2~4주 단위로 본다(11-25 반영). 매일 같은 기준으로 계속 잰다');
} else { verdict.push('서치콘솔 못 읽음: ' + gscErr); }
if (idx?.prevByFN) {
  for (const f of FOLDERS) {
    const a = idx.byFN[f], b = idx.prevByFN[f];
    if (a == null || b == null) continue;
    if (b - a >= 3) { verdict.push(`색인 표본 ${f} ${b}→${a}`); alarm.push(`색인 표본 ${f} ${b}→${a}`); }
    else if (a - b >= 3) verdict.push(`색인 표본 ${f} 증가 ${b}→${a}`);
  }
}
if (idx?.lastmodPct > 50) { next.push(`사이트맵 lastmod=오늘 ${idx.lastmodPct}% — CoreHash(tools/seo/lib.ps1 $RX_CORE)에서 날마다 바뀌는 줄을 뺀다`); alarm.push(`lastmod=오늘 ${idx.lastmodPct}%`); }
if (typeof sm.gonggu === 'number' && sm.gonggu > 9000) next.push(`sitemap-gonggu ${sm.gonggu} — 11-25 계획(약 6,700)보다 많다. build.ps1 GgKeepDays(7)와 gg_window.txt 를 본다`);
if (gNo != null && (gNo < 3000 || gNo > 6500)) next.push(`얇은 g noindex ${gNo}장 — 11-25 시험치 약 4,800 에서 크게 벗어났다. g_keep_index.txt 줄 수·진행 판정을 본다`);
if (!next.length) next.push('유지');

const row = { day: today, gsc, idx, sm, gNo, verdict, next, alarm };
state.days = [...state.days.filter((x) => x.day !== today), row].slice(-180);
const md = fmt(row);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### 검색 노출 매일 점검\n\n' + md + '\n'); } catch {} }
if (!DRY) {
  await sb('ops_status?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'seo-develop', payload: state, updated_at: new Date().toISOString() }) });
  await alertSet('seo:개선', alarm.length ? `검색 노출 매일 점검(${today}) 하락: ${alarm.join(' · ')} — 다음 조치: ${next.join(' / ')} · 장부 ops_status 'seo-develop' (node tools/seo/seo_develop.mjs --show)` : null);
}
if (!gsc) process.exit(1);

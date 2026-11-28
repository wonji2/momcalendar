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

const GA_NAMES = { 'source:m.search.naver.com': '네이버 검색(모바일)', 'source:naver.com': '네이버(PC)', 'source:google': '구글', 'source:chatgpt.com': 'ChatGPT', 'source:gemini.google.com': '제미나이', 'source:claude.ai': 'Claude', 'source:perplexity.ai': '퍼플렉시티', 'channel:AI Assistant': 'AI 답변 전체', 'channel:Organic Social': 'SNS', 'channel:Organic Search': '검색 전체' };
let state = { days: [] }, stateRead = false;
try { const r = await sb('ops_status?id=eq.seo-develop&select=payload').then((x) => x.json()); if (Array.isArray(r)) { stateRead = true; if (r[0]?.payload) state = { days: [], ...r[0].payload }; } } catch {}
// 어제까지의 장부를 못 읽은 채 쓰면 180일 이력을 오늘 한 줄로 덮는다(코덱스 2026-11-28) → 못 읽었으면 쓰지 않고 끝낸다
if (!stateRead && !DRY && !SHOW) die('장부(ops_status seo-develop)를 못 읽었다 — 이력을 덮어쓰지 않으려고 멈춘다');

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
  if (d.ext) {
    const x = d.ext, st = (o) => (o?.stale ? ' ⚠자료 묵음' : '');
    if (x.ga) L.push(`- 유입 GA4 7일(${x.ga.range}, 괄호는 그 전 7일)${st(x.ga)}: ${Object.entries(x.ga.by).map(([k, o]) => `${GA_NAMES[k] || k} ${o.cur}(${o.prev})`).join(' · ')}`); else L.push(`- 유입 GA4: 못 읽음(${x.ga_err || ''})`);
    if (x.kw) { L.push(`- 밀 검색어(${String(x.kw.src).slice(0, 16)})${st(x.kw)}: 순위표 ${x.kw.ranked}개 · 상위 ${x.kw.top.map((t) => `${t.kw} ${t.vol}/공구 ${t.n}/${t.rank}`).join(' · ')}`); L.push(`  - 민 검색어: ${x.kw.pushed.length ? x.kw.pushed.map((p) => `${p.kw}(${p.since}~ · ${p.base}→${p.now || '?'})`).join(' · ') : '없음'}${x.kw.up.length ? ` · 오른 것 ${x.kw.up.map((m) => `${m.q} ${m.from || '없음'}→${m.to}`).join(', ')}` : ''}${x.kw.down.length ? ` · 내린 것 ${x.kw.down.map((m) => `${m.q} ${m.from}→${m.to || '없음'}`).join(', ')}` : ''}`); } else L.push(`- 밀 검색어: 못 읽음(${x.kw_err || ''})`);
    if (x.nsa) L.push(`- 네이버 서치어드바이저(${String(x.nsa.src).slice(0, 16)})${st(x.nsa)}: ${x.nsa.state}${x.nsa.expire ? ` · 만료일 ${x.nsa.expire}` : ''}${x.nsa.ok && !x.nsa.parsed ? ' · 항목 해석 전' : ''}`); else L.push(`- 네이버 서치어드바이저: 못 읽음(${x.nsa_err || ''})`);
    if (x.ai) L.push(`- AI 검색 실측(${String(x.ai.src).slice(0, 16)})${st(x.ai)}: 빙 색인(ChatGPT·덕덕고) ${x.ai.summary?.ddg?.cited ?? '?'}/${x.ai.summary?.ddg?.measured ?? '?'} 질문에 나옴(3위 안 ${x.ai.summary?.ddg?.top3 ?? '?'}) · 안 나오는 질문: ${x.ai.miss.map((m) => m.q).join(', ') || '없음'} · 브레이브(Claude)·구글(제미나이)은 자동으로 못 잼`); else L.push(`- AI 검색 실측: 못 읽음(${x.ai_err || ''})`);
    if (x.blog) L.push(`- 블로그 주간(${x.blog.week}, ${String(x.blog.src).slice(0, 10)})${st(x.blog)}: 조회 7일 ${x.blog.cv7 ?? '?'}(그 전 ${x.blog.cv7_prev ?? '?'}) · 유입 검색어 ${x.blog.search.map((s) => `${s.q} ${s.cv}`).join(', ')}`); else L.push(`- 블로그 주간: 못 읽음(${x.blog_err || ''})`);
    L.push(`- 잘되는 것: ${(d.good || []).join(' / ') || '없음(판정할 만큼 오른 것이 없다)'}`);
    L.push(`- 안 되는 것: ${(d.bad || []).join(' / ') || '없음'}`);
    L.push(`- 다음 할 일: ${(d.todo || []).join(' / ') || '없음'}`);
  }
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
if (ONCE && state.days.some((x) => x.day === today && x.gsc && x.ext?.kw?.src && Date.now() - Date.parse(x.ext.kw.src) < 20 * 3600e3)) { console.log(`오늘(${today}) 장부가 이미 있다 — 건너뜀`); process.exit(0); }

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
// 같은 날 다시 도는 회차(넓힌 칸을 채우러)에서 서치콘솔이 실패하면, 오늘 앞 회차가 읽은 값을 그대로 쓴다 — 좋은 줄을 빈 줄로 덮고 열린 경보를 지우지 않게(검증 2026-11-28)
const gscToday = state.days.find((x) => x.day === today)?.gsc;
if (!gsc && gscToday) { gsc = gscToday; console.error('서치콘솔 실패 — 오늘 앞 회차 값을 유지한다'); }

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
if (idx?.lastmodPct > 30 && idx.lastmodPct <= 50 && idx.day > '2026-11-25') next.push(`사이트맵 lastmod=오늘 ${idx.lastmodPct}% — 평소(약 22%)보다 높다. 그날 빌드에서 본문이 바뀐 줄을 찾아 하루치 변경인지, CoreHash($RX_CORE)가 날마다 바뀌는 줄을 무는지 가린다(11-25 는 g 셀러 링크·gg 창 축소의 하루치로 58%)`);
if (idx?.lastmodPct > 50) { next.push(`사이트맵 lastmod=오늘 ${idx.lastmodPct}% — CoreHash(tools/seo/lib.ps1 $RX_CORE)에서 날마다 바뀌는 줄을 뺀다`); alarm.push(`lastmod=오늘 ${idx.lastmodPct}%`); }
if (typeof sm.gonggu === 'number' && sm.gonggu > 9000) next.push(`sitemap-gonggu ${sm.gonggu} — 11-25 계획(약 6,700)보다 많다. build.ps1 GgKeepDays(7)와 gg_window.txt 를 본다`);
if (gNo != null && (gNo < 3000 || gNo > 6500)) next.push(`얇은 g noindex ${gNo}장 — 11-25 시험치 약 4,800 에서 크게 벗어났다. g_keep_index.txt 줄 수·진행 판정을 본다`);
if (!next.length) next.push('유지');

// ④ 넓힌 칸 (사장님 2026-11-28 「잘되는 걸 매일 확인해서 디벨롭시켜 · 클로드·제미나이 · 경쟁사 키워드」) — 네이버 유입·AI 유입·밀 검색어·서치어드바이저·AI 검색 실측·블로그.
//   원칙: 원자료에서 직접 읽은 것만 쓴다 · 칸마다 원자료 시각(src) · 묵은 칸(PC 수집 48시간, 주간 자료 9일)은 「자료 묵음」으로 적고 판정에 안 쓴다 · 못 읽은 것은 0 이 아니라 null
//   PC 수집기(08시대: tools/daily/kw_focus.mjs · ai_search_probe.mjs · sns-automation/src/naver-sa.js · blog-stats.js)가 ops_status 에 올린 줄을 읽는다. 이 블록이 통째로 죽어도 위 구글 칸은 그대로 남는다.
const ext = {}, good = [], bad = [], todo = [];
const ageH = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600e3 : 1e9);
const ops = async (id) => { const r = await sb(`ops_status?id=eq.${id}&select=payload,updated_at`).then((x) => x.json()); if (!Array.isArray(r)) throw new Error(`${id} ${JSON.stringify(r).slice(0, 80)}`); return r[0] || null; };
try {
  const ymd = (d) => new Date(d).toISOString().slice(0, 10);
  const from = ymd(Date.now() + 9 * 3600e3 - 16 * 864e5);
  const rows = [];
  for (let off = 0; off < 20000; off += 1000) { const r = await sb(`analytics_daily?source=eq.ga4&metric=eq.sessions&day=gte.${from}&select=day,dim,value&order=day.asc,dim.asc&limit=1000&offset=${off}`).then((x) => x.json()); if (!Array.isArray(r)) throw new Error('analytics_daily ' + JSON.stringify(r).slice(0, 80)); rows.push(...r); if (r.length < 1000) break; }
  const last = rows.map((r) => r.day).sort().pop();
  if (!last) throw new Error('GA4 세션 행이 없다');
  const add = (s, n) => ymd(Date.parse(s) + n * 864e5);
  const curFrom = add(last, -6), prevFrom = add(last, -13), prevTo = add(last, -7);
  const by = {};
  for (const r of rows) { if (!GA_NAMES[r.dim]) continue; const o = (by[r.dim] ||= { cur: 0, prev: 0 }); if (r.day >= curFrom) o.cur += +r.value; else if (r.day >= prevFrom && r.day <= prevTo) o.prev += +r.value; }
  const stale = last < ymd(Date.now() + 9 * 3600e3 - 3 * 864e5);
  ext.ga = { src: last, range: `${curFrom}~${last}`, prev_range: `${prevFrom}~${prevTo}`, stale, by };
  if (!stale) for (const [k, o] of Object.entries(by)) {
    if (o.cur < 30 && o.prev < 30) continue;   // 표본이 적은 칸은 판정하지 않는다(제미나이 주 5세션 같은 것)
    const pct = o.prev ? Math.round(((o.cur - o.prev) / o.prev) * 100) : 100;
    if (pct >= 20) good.push(`${GA_NAMES[k]} 유입 ${o.prev}→${o.cur} 세션(+${pct}%)`); else if (pct <= -20) bad.push(`${GA_NAMES[k]} 유입 ${o.prev}→${o.cur} 세션(${pct}%)`);
  }
} catch (e) { ext.ga = null; ext.ga_err = String(e.message).slice(0, 120); }
try {
  const r = await ops('kw-focus');
  if (!r) ext.kw = null, ext.kw_err = '아직 한 번도 안 올라옴';
  else {
    const p = r.payload, stale = ageH(p.at) > 48;
    ext.kw = { src: p.at, stale, ranked: p.ranked, top: (p.top || []).slice(0, 5).map((t) => ({ kw: t.kw, vol: t.vol, n: t.n, rank: t.rank_state })), pushed: (p.pushed || []).map((x) => ({ kw: x.kw, since: x.since, until: x.until, base: x.base_rank, now: x.now_rank, gonggu: x.gonggu })), up: (p.rank_up || []).slice(0, 5), down: (p.rank_down || []).slice(0, 5), notes: (p.notes || []).slice(0, 4) };
    if (!stale) {
      for (const m of ext.kw.up.slice(0, 3)) good.push(`네이버 「${m.q}」 ${m.from || '없음'}→${m.to}위`);
      for (const m of ext.kw.down.slice(0, 3)) bad.push(`네이버 「${m.q}」 ${m.from}위→${m.to || '20위 안에 없음'}`);
      const newest = [...ext.kw.pushed].sort((a, b) => (a.since < b.since ? 1 : -1))[0];
      if (newest) todo.push(`밀 검색어 「${newest.kw}」(공구 ${newest.gonggu ?? '?'}건 · 네이버 ${newest.now || newest.base}) — 블로그 일정 글 제목 머리와 그 브랜드 페이지 첫 문장에 넣는다(${newest.since}~${newest.until} 고정, 그동안 다른 변경 금지)`);
    }
  }
} catch (e) { ext.kw = null; ext.kw_err = String(e.message).slice(0, 120); }
try {
  const r = await ops('naver-sa');
  if (!r) ext.nsa = null, ext.nsa_err = '아직 한 번도 안 올라옴';
  else {
    const p = r.payload, stale = ageH(p.at) > 48;
    ext.nsa = { src: p.at, stale, ok: !!p.ok, state: p.state, expire: p.expire, parsed: !!p.parsed, note: String(p.note || '').slice(0, 200) };
    if (!stale && !p.ok && /소유확인/.test(p.state || '')) { bad.push(`네이버 서치어드바이저 ${p.state}${p.expire ? `(만료일 ${p.expire})` : ''} — 수치를 읽을 수 없다`); todo.unshift(`[사장님 승인 필요] 서치어드바이저 › 사이트 관리 › 「소유확인 진행」 다시 누르기 — 그 전에는 네이버 노출·클릭·수집·색인 수치가 없다`); }
    else if (!stale && !p.ok) bad.push(`네이버 서치어드바이저 ${p.state} — ${String(p.note || '').slice(0, 60)}`);
    if (!stale && p.ok && p.expire_soon) todo.unshift(`[사장님 승인 필요] 서치어드바이저 소유확인이 ${p.expire} 에 만료된다(30일 안) — 사이트 관리에서 다시 누르기(보안문자 입력 있음)`);
  }
} catch (e) { ext.nsa = null; ext.nsa_err = String(e.message).slice(0, 120); }
try {
  const r = await ops('ai-search');
  if (!r) ext.ai = null, ext.ai_err = '아직 한 번도 안 올라옴';
  else {
    const p = r.payload, stale = ageH(p.at) > 48;
    const miss = [], gain = [], lose = [];
    const d7 = new Date(Date.now() + 9 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
    for (const [q, v] of Object.entries(p.q || {})) {
      // 엔진 둘 중 더 최근에 잰 쪽을 쓰고, 7일 넘은 값은 판정에 안 쓴다(전체 at 만 새로 찍히고 질문 값은 묵을 수 있다 — 코덱스 2026-11-28)
      const eng = (v.ddg?.day || '') >= (v.bing?.day || '') ? 'ddg' : 'bing'; const c = v[eng], o = v[eng + '_prev']; if (!c || c.day < d7) continue; if (!c.pos) miss.push({ q, ahead: (c.ahead || []).slice(0, 2) }); if (o && c.day !== o.day) { const a = o.pos || 99, b = c.pos || 99; if (b < a) gain.push(`「${q}」 ${o.pos || '없음'}→${c.pos}번째`); else if (b > a) lose.push(`「${q}」 ${o.pos}번째→${c.pos || '없음'}`); } }
    ext.ai = { src: p.at, stale, summary: p.summary, miss: miss.slice(0, 8), not_measured: p.not_measured || null };
    if (!stale) {
      gain.slice(0, 2).forEach((x) => good.push(`빙 색인(ChatGPT·덕덕고) ${x}`)); lose.slice(0, 2).forEach((x) => bad.push(`빙 색인(ChatGPT·덕덕고) ${x}`));
      if (miss.length) { bad.push(`빙 색인에서 안 나오는 질문 ${miss.length}개: ${miss.slice(0, 3).map((m) => `「${m.q}」`).join(' ')}`); if (todo.length < 2) todo.push(`「${miss[0].q}」 질문에 빙 색인이 우리를 안 준다(앞선 곳 ${miss[0].ahead.join(', ')}) — 그 질문을 제목·첫 문장에 그대로 쓴 질문 페이지가 있는지 보고, 없으면 keywords.json 에 한 장 더한다`); }
    }
  }
} catch (e) { ext.ai = null; ext.ai_err = String(e.message).slice(0, 120); }
try {
  const r = await ops('blog-stats');
  if (!r) ext.blog = null, ext.blog_err = '아직 한 번도 안 올라옴';
  else { const p = r.payload; ext.blog = { src: p.at, stale: ageH(p.at) > 9 * 24, week: p.week, cv7: p.cv7 ?? null, cv7_prev: p.cv7_prev ?? null, search: (p.search || []).slice(0, 8) }; if (!ext.blog.stale && p.cv7 != null && p.cv7_prev) { const pct = Math.round(((p.cv7 - p.cv7_prev) / p.cv7_prev) * 100); if (pct >= 20) good.push(`블로그 조회 7일 ${p.cv7_prev}→${p.cv7}(+${pct}%)`); else if (pct <= -20) bad.push(`블로그 조회 7일 ${p.cv7_prev}→${p.cv7}(${pct}%)`); } }
} catch (e) { ext.blog = null; ext.blog_err = String(e.message).slice(0, 120); }
const extNull = ['ga', 'kw', 'nsa', 'ai', 'blog'].filter((k) => !ext[k]), extStale = ['ga', 'kw', 'nsa', 'ai', 'blog'].filter((k) => ext[k]?.stale);
if (extStale.length) bad.push(`자료 묵음: ${extStale.join('·')} — PC 수집기가 안 돌았다(이 칸으로는 판정하지 않음)`);

const row = { day: today, gsc, idx, sm, gNo, verdict, next, alarm, ext, good: good.slice(0, 6), bad: bad.slice(0, 6), todo: todo.slice(0, 2) };
state.days = [...state.days.filter((x) => x.day !== today), row].slice(-180);
const md = fmt(row);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n### 검색 노출 매일 점검\n\n' + md + '\n'); } catch {} }
if (!DRY) {
  await sb('ops_status?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'seo-develop', payload: state, updated_at: new Date().toISOString() }) });
  await alertSet('seo:개선', alarm.length ? `검색 노출 매일 점검(${today}) 하락: ${alarm.join(' · ')} — 다음 조치: ${next.join(' / ')} · 장부 ops_status 'seo-develop' (node tools/seo/seo_develop.mjs --show)` : null);
}
if (!gsc) process.exit(1);

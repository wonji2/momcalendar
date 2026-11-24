// 구글 색인 표본 측정 (사장님 지시 2026-11-24 「구글색인보완해」 → 「색인 다 살려」 — 종류별 색인 수를 매일 재서 장부에 쌓는다)
//
//   무엇을: tools/seo/index_sample.txt 의 주소(약 200개, 종류별 30~40개)를 구글 서치콘솔 「URL 검사」 공식 API 로 하나씩 조회해
//           종류(홈·허브·s 셀러·p 제품·g 브랜드·gg 공구)별로 「색인됨 / 발견됨-색인 안 됨 / 크롤링됨-색인 안 됨 / 구글이 모름 / 그 밖」을 센다.
//           구글 검색 화면을 긁지 않는다. 읽기 전용(webmasters.readonly)이라 사이트·서치콘솔 설정을 바꾸지 않는다.
//   어디서: 깃허브 Actions .github/workflows/seo-index-sample.yml — 매일 07:30 KST(seo-daily 빌드 05:10 뒤). PC 가 꺼져도 돈다.
//   실행:   node tools/seo/index_sample.mjs          ← 측정·기록·경보
//           node tools/seo/index_sample.mjs --dry    ← 읽기만(기록·경보 안 함)
//   열쇠:   GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN (rank_weekly.mjs 와 같은 깃허브 Secrets) · SUPABASE_SERVICE_KEY
//           로컬은 tools/daily/.env 의 GSC_REFRESH_TOKEN + BLOGGER_CLIENT_ID·SECRET 로도 돈다. 코드에 박지 않는다
//   기록:   Supabase ops_status id='seo-index' — payload.runs 에 회차별 결과(최근 40회만 → 한도 영향 없음), 심박 겸용
//           첫 회차(2026-11-24 22:40 KST, CoreHash 고치기 전)가 기준선이다: 100개 중 색인 27 · 발견됨-색인 안 됨 48 · 모름 23 · 404 옛 기록 2
//           (첫 표본 27장: 색인 9 · 발견됨 14 · 모름 4 — 같은 날 낮 조회는 9·7·11 이었다. 구글 쪽 값이 하루 안에도 흔들린다)
//           2026-11-24 밤 종류별 보강(197개)으로 다시 잰 회차가 종류별 기준선이다(표본 수가 다른 회차끼리는 비교하지 않는다).
//   경보:   health_alerts kind='seo:색인표본' — 같은 표본 수의 최근 7회 최고치보다 전체 색인이 5개 넘게, 또는 한 종류가 3개 이상 줄면. 회복되면 지운다.
//           조회 실패가 섞인 회차는 판정하지 않는다. 열쇠가 없으면 바로 'seo:색인측정'.
//           API 가 3회 연속 실패하면 'seo:색인측정'.
//           사이트맵 lastmod 가 오늘인 주소가 50% 를 넘으면 'seo:lastmod' — 2026-11-21~24 에 앱 안내 숫자 한 줄 때문에 93% 가 날마다 「오늘 수정」으로 나갔다(CoreHash, tools/seo/lib.ps1).
//           커밋을 막지 않는다(막으면 페이지가 굳는다). 경보만.
//   한도:   URL 검사 API 하루 2,000건 · 분당 600건 — 한 회차 200건 안팎이라 넉넉하다(약 5분).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://momcalendar.com/';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = () => { try { return Object.fromEntries(fs.readFileSync(path.join(ROOT, 'tools/daily/.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } };
const E = { ...envFile(), ...process.env };
const CID = E.GSC_CLIENT_ID || E.BLOGGER_CLIENT_ID, CSEC = E.GSC_CLIENT_SECRET || E.BLOGGER_CLIENT_SECRET;
const SK = E.SUPABASE_SERVICE_KEY || E.SB_SERVICE_KEY;
const die = (m) => { console.error('🔴 ' + m); process.exit(1); };
if (!SK && !DRY) die('SUPABASE_SERVICE_KEY 가 없다(--dry 면 없어도 된다)');
const NO_GSC = !CID || !CSEC || !E.GSC_REFRESH_TOKEN;   // 아래 run() 에서 실패로 세어 경보까지 낸다(조용히 끝나지 않게)

const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const sb = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });
const alertSet = async (kind, detail) => { if (DRY) return; await sb(`health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE' }); if (detail) await sb('health_alerts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: detail.slice(0, 1800) }) }); };
let state = { runs: [], fail: 0 };
if (SK) { try { const r = await sb('ops_status?id=eq.seo-index&select=payload').then((x) => x.json()); if (r?.[0]?.payload) state = { runs: [], fail: 0, ...r[0].payload }; } catch {} }
const saveState = async () => { if (DRY) return; await sb('ops_status?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'seo-index', payload: state, updated_at: new Date().toISOString() }) }); };

const list = fs.readFileSync(path.join(ROOT, 'tools/seo/index_sample.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('/'));
const KO = { 'Submitted and indexed': '색인됨', 'Indexed, not submitted in sitemap': '색인됨', 'Discovered - currently not indexed': '발견됨-색인 안 됨', 'Crawled - currently not indexed': '크롤링됨-색인 안 됨', 'URL is unknown to Google': '구글이 모름', 'Not found (404)': '404(구글 옛 기록)' };
const folderOf = (p) => { if (p === '/') return '홈'; const m = p.match(/^\/([a-z]+)\//); if (!m || ['c', 'm', 'd'].includes(m[1])) return '허브'; return { s: 's 셀러', p: 'p 제품', g: 'g 브랜드', gg: 'gg 공구' }[m[1]] || m[1]; };

async function run() {
  if (NO_GSC) throw new Error('GSC_CLIENT_ID·GSC_CLIENT_SECRET·GSC_REFRESH_TOKEN 이 없다(깃허브 Secrets 또는 tools/daily/.env)');
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: E.GSC_REFRESH_TOKEN, grant_type: 'refresh_token' }) }).then((x) => x.json());
  if (!tok.access_token) throw new Error('구글 토큰 실패: ' + (tok.error || '') + ' ' + (tok.error_description || ''));
  const rows = new Array(list.length); let apiErr = 0;
  // 주소 하나 조회에 수 초가 걸린다(11-24 실측 100개 약 10분) → 5개씩 동시에(분당 600건 한도 안). 결과 순서는 표본 순서 그대로
  const one = async (p) => {
    let st = '조회 실패', crawl = '';
    for (let k = 0; k < 2 && st === '조회 실패'; k++) {
      try {
        const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: 'https://momcalendar.com' + encodeURI(p), siteUrl: SITE }), signal: AbortSignal.timeout(30000) }).then((x) => x.json());
        const s = r.inspectionResult?.indexStatusResult;
        if (s) { st = KO[s.coverageState] || s.coverageState || '그 밖'; crawl = (s.lastCrawlTime || '').slice(0, 10); }
      } catch {}
      if (st === '조회 실패') await new Promise((r) => setTimeout(r, 2000));
    }
    if (st === '조회 실패') apiErr++;
    return { p, st, crawl };
  };
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => { while (next < list.length) { const i = next++; rows[i] = await one(list[i]); } }));
  if (apiErr > list.length / 2) throw new Error(`URL 검사 ${apiErr}/${list.length} 실패`);
  rows.apiErr = apiErr;
  return rows;
}

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let rows;
try { rows = await run(); state.fail = 0; }
catch (e) {
  state.fail = (state.fail || 0) + 1; console.error('🔴 ' + e.message);
  if (state.fail >= 3 || NO_GSC) await alertSet('seo:색인측정', `구글 색인 표본 측정이 ${state.fail}회 연속 실패: ${e.message} — tools/seo/index_sample.mjs · GSC 열쇠 확인`);
  await saveState(); process.exit(1);
}
await alertSet('seo:색인측정', null);

// 사이트맵 lastmod=오늘 비율 (같은 꼴 재발 감시)
let lm = null;
try {
  let n = 0, t = 0;
  for (const nm of ['sitemap-brand.xml', 'sitemap-gonggu.xml', 'sitemap-product.xml', 'sitemap-seller.xml']) {
    const x = await fetch('https://momcalendar.com/' + nm).then((r) => r.text());
    for (const m of x.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) { n++; if (m[1].slice(0, 10) === today) t++; }
  }
  if (n) lm = { n, today: t, pct: Math.round((t / n) * 1000) / 10 };
} catch {}
if (lm && lm.pct > 50) await alertSet('seo:lastmod', `사이트맵 주소 ${lm.n}개 중 ${lm.today}개(${lm.pct}%)가 lastmod=오늘(${today}). 날마다 저절로 바뀌는 줄이 CoreHash(tools/seo/lib.ps1 $RX_CORE)에서 안 빠진 것 — 어제·오늘 페이지를 비교해 바뀐 줄을 찾아 뺀다. IndexNow 도 그만큼 보내고 있다`);
else if (lm && lm.today > 0) await alertSet('seo:lastmod', null);   // 오늘 날짜가 하나도 없으면 빌드가 안 돈 날 — 0% 를 「정상」으로 보고 지우지 않는다

const sum = (rs) => { const o = {}; for (const r of rs) o[r.st] = (o[r.st] || 0) + 1; return o; };
const byFolder = {}; for (const r of rows) { const f = folderOf(r.p); (byFolder[f] ||= { n: 0, idx: 0 }); byFolder[f].n++; if (r.st === '색인됨') byFolder[f].idx++; }
const first27 = rows.slice(0, 27);
const res = { day: today, n: rows.length, all: sum(rows), first27: sum(first27), byFolder, idx: rows.filter((r) => r.st === '색인됨').length, lastmod: lm, notIdx: rows.filter((r) => r.st !== '색인됨').map((r) => r.p + ' ' + r.st).slice(0, 60) };
const prev = state.runs.filter((x) => x.day !== today).slice(-1)[0];   // 같은 날 다시 돌린 회차는 덮어쓴다 — 비교는 전날 이전 회차와
state.runs = [...state.runs.filter((x) => x.day !== today), res].slice(-40);

const base = state.runs.length > 1 ? state.runs[0] : null;
const line = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ');
let md = `### 구글 색인 표본 ${today} (주소 ${rows.length}개, 서치콘솔 URL 검사 API)\n\n- 전체: ${line(res.all)}\n- 첫 표본 27장: ${line(res.first27)}${base ? ` (기준선 ${base.day}: ${line(base.first27)})` : ''}\n- 사이트맵 lastmod=오늘: ${lm ? `${lm.today}/${lm.n} (${lm.pct}%)` : '못 읽음'}
- 종류별 색인: ${Object.entries(byFolder).map(([f, v]) => `${f} ${v.idx}/${v.n}`).join(' · ')}\n`;
if (prev) md += `- 직전 회차(${prev.day}) 색인 ${prev.idx}/${prev.n} → 이번 ${res.idx}/${res.n}\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch {} }
// 하락 판정 — 같은 표본 수의 최근 7회(오늘 빼고) 최고치와 비교한다. 다음 날 그대로여도 회복될 때까지 경보가 남는다.
//   조회 실패가 하나라도 있으면 판정하지 않는다(429 등 실패를 미색인으로 세지 않게) — 경보는 그대로 둔다
res.apiErr = rows.apiErr || 0;
const peers = state.runs.filter((x) => x.day !== today && x.n === res.n && !x.apiErr).slice(-7);
const best = peers.length ? peers.reduce((a, b) => (b.idx > a.idx ? b : a)) : null;
const drops = best ? Object.entries(byFolder).filter(([k, v]) => { const m = Math.max(...peers.map((x) => (x.byFolder?.[k]?.n === v.n ? x.byFolder[k].idx : -1))); return m >= 0 && m - v.idx >= 3; }).map(([k, v]) => `${k} 최근 최고 ${Math.max(...peers.map((x) => (x.byFolder?.[k]?.n === v.n ? x.byFolder[k].idx : -1)))}→${v.idx}/${v.n}`) : [];
if (res.apiErr) console.log(`조회 실패 ${res.apiErr}건 — 하락 판정 건너뜀(경보 상태 유지)`);
else if (best && (best.idx - res.idx > 5 || drops.length)) await alertSet('seo:색인표본', `구글 색인 표본이 최근 최고(${best.day}) ${best.idx}/${best.n} → ${today} ${res.idx}/${res.n}${drops.length ? ' (' + drops.join(' · ') + ')' : ''} 로 줄었다. 사이트맵 lastmod·noindex·빌드 변경을 먼저 본다(tools/seo/build.ps1·lib.ps1 CoreHash). 상세 ops_status 'seo-index'`);
else if (best) await alertSet('seo:색인표본', null);
await saveState();

// 구글 순위 주간 측정 (사장님 지시 2026-11-18 「매주 재서 보고하고 떨어지면 디벨롭 · PC 와 상관없이 계속」)
//
//   무엇을: 목표 검색어(아래 TARGETS)의 구글 평균 순위·노출·클릭을 구글 서치콘솔 공식 API 로 읽어 지난주와 비교한다.
//           구글 검색 화면을 긁지 않는다(깃허브 서버에서 긁으면 막히고, 막힌 걸 뚫는 건 하지 않는다).
//   어디서: 깃허브 Actions .github/workflows/seo-rank-weekly.yml — 매주 월요일 07:10 KST. PC 가 꺼져도 돈다.
//   실행:   node tools/seo/rank_weekly.mjs           ← 측정·기록·경보
//           node tools/seo/rank_weekly.mjs --dry     ← 읽기만(기록·경보 안 함)
//           node tools/seo/rank_weekly.mjs --auth    ← 처음 한 번(PC): 구글 동의 → GSC_REFRESH_TOKEN 을 tools/daily/.env 에 저장
//   열쇠:   GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN (깃허브 Secrets, 없으면 즉시 멈춘다. 코드에 박지 않는다)
//           SUPABASE_SERVICE_KEY (기록·경보)
//           로컬 --auth 는 GSC_CLIENT_* 가 없으면 블로거용 구글 앱(BLOGGER_CLIENT_ID·SECRET)을 그대로 쓴다. 범위는 읽기 전용(webmasters.readonly)
//   기록:   Supabase ops_status id='seo-rank' — payload.weeks 에 주별 결과(최근 30주만 남긴다 → 한도 영향 없음), 심박 겸용
//   경보:   health_alerts kind='seo:순위' — 어느 검색어가 몇 위에서 몇 위로 떨어졌는지·그 검색어의 우리 페이지·먼저 손볼 곳
//           (관리자 홈 「고장 난 것」에 뜬다). 회복되면 지운다. 연속 실패 3회면 'seo:순위측정' 경보.
//   한계:   서치콘솔은 「우리 사이트」 순위만 준다. 경쟁사가 몇 위인지는 모른다. 자료는 2~3일 늦게 들어와서 「그제까지 7일」을 잰다.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://momcalendar.com/';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
// 목표 검색어: 붙여쓰기·띄어쓰기를 한 묶음으로 본다(묶음 안에서 노출이 가장 많은 꼴의 순위를 쓴다). page = 그 검색어를 노리는 허브
const TARGETS = [
  { key: '공구일정사이트', q: ['공구일정사이트', '공구일정 사이트', '공구 일정 사이트'], page: '공구일정사이트.html' },
  { key: '인스타 공구 사이트', q: ['인스타 공구 사이트', '인스타공구사이트', '인스타공구 사이트'], page: '인스타공구사이트.html' },
  { key: '공구모음사이트', q: ['공구모음사이트', '공구모음 사이트', '공구 모음 사이트'], page: '공구모음사이트.html' },
  { key: '공동구매 사이트', q: ['공동구매 사이트', '공동구매사이트'], page: '공동구매사이트.html' },
  { key: '공동구매하는곳', q: ['공동구매하는곳', '공동구매 하는곳', '공동구매 하는 곳'], page: '공동구매하는곳.html' },
  { key: '인스타공구모음', q: ['인스타공구모음', '인스타 공구 모음', '인스타공구 모음'], page: '인스타공구모음.html' },
];
const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENVF = path.join(ROOT, 'tools/daily/.env');
const envFile = () => { try { return Object.fromEntries(fs.readFileSync(ENVF, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } };
const E = { ...envFile(), ...process.env };
const CID = E.GSC_CLIENT_ID || E.BLOGGER_CLIENT_ID, CSEC = E.GSC_CLIENT_SECRET || E.BLOGGER_CLIENT_SECRET;
const SK = E.SUPABASE_SERVICE_KEY || E.SB_SERVICE_KEY;
const die = (m) => { console.error('🔴 ' + m); process.exit(1); };

// ── 처음 한 번: 구글 동의(읽기 전용) ──
if (process.argv.includes('--auth')) {
  if (!CID || !CSEC) die('구글 앱 열쇠(GSC_CLIENT_ID·SECRET 또는 BLOGGER_CLIENT_ID·SECRET)가 tools/daily/.env 에 없다');
  const PORT = 8765, RED = `http://127.0.0.1:${PORT}/`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: CID, redirect_uri: RED, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/webmasters.readonly' });
  console.log('아래 주소를 서치콘솔 주인 계정으로 열어 「허용」을 눌러 주세요(읽기 전용 권한):\n\n' + url + '\n');
  await new Promise((done) => {
    const srv = http.createServer(async (req, res) => {
      const code = new URL(req.url, RED).searchParams.get('code');
      if (!code) { res.end('code 없음'); return; }
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, client_id: CID, client_secret: CSEC, redirect_uri: RED, grant_type: 'authorization_code' }) }).then((x) => x.json());
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (!r.refresh_token) { res.end('토큰을 못 받았습니다. 창을 닫고 다시 시도해 주세요.'); console.error('🔴 refresh_token 없음:', r.error || '', r.error_description || ''); srv.close(); done(); return; }
      let env = ''; try { env = fs.readFileSync(ENVF, 'utf8'); } catch {}
      env = env.replace(/^GSC_REFRESH_TOKEN=.*\r?\n?/m, ''); if (env && !env.endsWith('\n')) env += '\n';
      fs.writeFileSync(ENVF, env + `GSC_REFRESH_TOKEN=${r.refresh_token}\n`);
      res.end('끝났습니다. 이 창은 닫아도 됩니다.'); console.log('✅ GSC_REFRESH_TOKEN 을 tools/daily/.env 에 저장했다(값은 출력하지 않는다)'); srv.close(); setTimeout(done, 300);
    }).listen(PORT, '127.0.0.1');
  });
  process.exitCode = 0;
} else {
  await measure();
}
async function measure() {
// ── 측정 ──
if (!CID || !CSEC || !E.GSC_REFRESH_TOKEN) die('GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN 이 없다 — 멈춘다(깃허브 Secrets 또는 --auth)');
if (!SK && !DRY) die('SUPABASE_SERVICE_KEY 가 없다 — 멈춘다');
const H = { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' };
const sb = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });
const alertSet = async (kind, detail) => { if (DRY) return; await sb(`health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE' }); if (detail) await sb('health_alerts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail: detail.slice(0, 1800) }) }); };
const ymd = (d) => d.toISOString().slice(0, 10);
const kst = new Date(Date.now() + 9 * 3600e3);
const end = new Date(kst); end.setUTCDate(end.getUTCDate() - 3);           // 자료가 2~3일 늦다
const SPAN = 28;   // 목표 검색어는 구글 검색량이 아주 적다(2026-11-18 실측: 28일에 검색어당 노출 1회) → 7일 창은 거의 비어서 28일 창으로 잰다
const start = new Date(end); start.setUTCDate(start.getUTCDate() - (SPAN - 1));
const pEnd = new Date(start); pEnd.setUTCDate(pEnd.getUTCDate() - 1);
const pStart = new Date(pEnd); pStart.setUTCDate(pStart.getUTCDate() - (SPAN - 1));

let prevState = { weeks: [], fail: 0 };
if (SK) { try { const r = await sb('ops_status?id=eq.seo-rank&select=payload').then((x) => x.json()); if (r?.[0]?.payload) prevState = { weeks: [], fail: 0, ...r[0].payload }; } catch {} }
const saveState = async (st) => { if (DRY) return; await sb('ops_status?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'seo-rank', payload: st, updated_at: new Date().toISOString() }) }); };

try {
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: E.GSC_REFRESH_TOKEN, grant_type: 'refresh_token' }) }).then((x) => x.json());
  if (!tok.access_token) throw new Error('구글 토큰 갱신 실패: ' + (tok.error || '') + ' ' + (tok.error_description || ''));
  const gsc = async (s, e) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: ymd(s), endDate: ymd(e), dimensions: ['query', 'page'], rowLimit: 5000,
        dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'query', operator: 'includingRegex', expression: '공구|공동구매' }] }] }),
    });
    const j = await r.json(); if (!r.ok) throw new Error(`서치콘솔 ${r.status}: ${j?.error?.message || ''}`);
    return j.rows || [];
  };
  const [now, prev] = [await gsc(start, end), await gsc(pStart, pEnd)];
  // 사이트 전체(검색어 무관) 클릭·노출 — 목표 검색어가 비어도 흐름은 이 숫자로 본다
  const total = async (s, e) => { const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ startDate: ymd(s), endDate: ymd(e), dimensions: [] }) }).then((x) => x.json()); const o = r.rows?.[0] || {}; return { clk: o.clicks || 0, imp: o.impressions || 0, pos: +(o.position || 0).toFixed(1) }; };
  const [tNow, tPrev] = [await total(start, end), await total(pStart, pEnd)];
  const pick = (rows, t) => {
    const mine = rows.filter((r) => t.q.includes(r.keys[0]));
    if (!mine.length) return null;
    const byQ = {}; for (const r of mine) { const o = (byQ[r.keys[0]] ||= { imp: 0, clk: 0, posW: 0, pages: [] }); o.imp += r.impressions; o.clk += r.clicks; o.posW += r.position * r.impressions; o.pages.push({ p: decodeURIComponent(r.keys[1].replace(SITE, '/')), imp: r.impressions, pos: r.position }); }
    const [q, o] = Object.entries(byQ).sort((a, b) => b[1].imp - a[1].imp)[0];
    const top = o.pages.sort((a, b) => b.imp - a.imp)[0];
    return { q, pos: +(o.posW / Math.max(1, o.imp)).toFixed(1), imp: mine.reduce((s, r) => s + r.impressions, 0), clk: mine.reduce((s, r) => s + r.clicks, 0), page: top.p };
  };
  const rows = TARGETS.map((t) => ({ key: t.key, want: '/' + t.page, now: pick(now, t), prev: pick(prev, t) }));
  const lines = [], drops = [];
  for (const r of rows) {
    const a = r.now, b = r.prev;
    const d = a && b ? +(a.pos - b.pos).toFixed(1) : null;
    lines.push(`${r.key}: ${a ? a.pos + '위 · 노출 ' + a.imp + ' · 클릭 ' + a.clk + ' · 잡힌 쪽 ' + a.page : '노출 없음'}${b ? ' (지난번 ' + b.pos + '위)' : ''}`);
    if (a && b && d >= 3 && a.imp >= 3 && b.imp >= 3) drops.push(`${r.key} ${b.pos}위→${a.pos}위(잡힌 쪽 ${a.page}${a.page !== r.want && a.page !== '/' ? ', 노린 쪽은 ' + r.want : ''})`);
    else if (!a && b && b.imp >= 5) drops.push(`${r.key} 지난번 ${b.pos}위(노출 ${b.imp}) → 이번엔 노출 없음`);
  }
  lines.push(`사이트 전체: 클릭 ${tNow.clk}(지난번 ${tPrev.clk}) · 노출 ${tNow.imp}(지난번 ${tPrev.imp}) · 평균 ${tNow.pos}위`);
  if (tPrev.clk >= 50 && tNow.clk < tPrev.clk * 0.7) drops.push(`사이트 전체 구글 클릭 ${tPrev.clk}→${tNow.clk}`);
  const week = { end: ymd(end), total: tNow, rows: rows.map((r) => ({ key: r.key, pos: r.now?.pos ?? null, imp: r.now?.imp ?? 0, clk: r.now?.clk ?? 0, page: r.now?.page ?? null })) };
  console.log(`구글 순위 주간 측정(최근 28일) ${ymd(start)} ~ ${ymd(end)} (비교 ${ymd(pStart)} ~ ${ymd(pEnd)})\n` + lines.join('\n'));
  const weeks = [...(prevState.weeks || []).filter((w) => w.end !== week.end), week].slice(-30);
  await saveState({ weeks, fail: 0, last: lines, measured_at: new Date().toISOString() });
  if (drops.length) {
    await alertSet('seo:순위', `구글 순위 하락(${ymd(end)} 주): ${drops.join(' / ')}. 먼저 볼 것: ① 그 검색어에 잡힌 쪽이 노린 허브가 아니면 허브 제목·첫 문단·내부링크 ② seo-daily 가 매일 돌았는지 ③ 홈 「오늘 공구 목록」이 채워졌는지 ④ 그 주에 바꾼 것. 다음 채팅에서 「순위 떨어진 것 봐줘」로 이어서 고친다`);
    console.log('🔴 하락: ' + drops.join(' / '));
  } else { await alertSet('seo:순위', ''); console.log('✅ 2위 이상 떨어진 검색어 없음'); }
  await alertSet('seo:순위측정', '');
} catch (e) {
  const fail = (prevState.fail || 0) + 1;
  console.error('🔴 측정 실패: ' + e.message);
  await saveState({ ...prevState, fail, last_error: String(e.message).slice(0, 300), measured_at: new Date().toISOString() });
  if (fail >= 3) await alertSet('seo:순위측정', `구글 순위 주간 측정이 ${fail}번 연속 실패: ${String(e.message).slice(0, 300)} — 열쇠(GSC_REFRESH_TOKEN)·서치콘솔 API 사용 설정을 볼 것`);
  process.exit(1);
}
}

// 애플(App Store Connect) 수집 — Analytics Reports API (오더 §4-3 · §6-5)
//   필요한 것: APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_P8 (ios 빌드가 쓰는 기존 키 그대로 — 새로 만들지 않는다)
//   순서: analyticsReportRequests(ONGOING) → reports → instances(DAILY) → segments → .gz 내려받기 → 탭 구분 글 읽기
//   🔴 이 파일이 App Store Connect 에 만드는 것은 ONGOING 리포트 요청 1건뿐이다(읽기용). 그 밖의 스토어 변경은 하지 않는다.
//   ONGOING 요청이 없으면 데이터가 오지 않는다. 처음 만들면 첫 리포트는 24~48시간 뒤, 데이터 완성은 D-2.
//   손으로:  node tools/analytics/apple.mjs --check    키로 앱 조회 + 지금 있는 요청 목록(아무것도 만들지 않는다)
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { saveDaily, setMeta, has, errText, parseDelimited, num, kstDay, sbGet, sbUpsert, APP_ID } from './lib.mjs';

const API = 'https://api.appstoreconnect.apple.com';
const WANT = { downloads: 'App Downloads', engagement: 'App Store Discovery and Engagement' };

function readP8() {
  let k = String(process.env.APPLE_API_KEY_P8 || '').trim();
  if (!k) return null;
  if (!k.includes('BEGIN')) { try { const d = Buffer.from(k, 'base64').toString('utf8'); if (d.includes('BEGIN')) k = d; } catch {} }
  k = k.replace(/\\n/g, '\n');
  if (!k.includes('BEGIN')) k = `-----BEGIN PRIVATE KEY-----\n${k.replace(/\s+/g, '\n')}\n-----END PRIVATE KEY-----\n`;
  try { return crypto.createPrivateKey(k); } catch { return null; }
}
export function appleCheck() {
  return { kid: has('APPLE_API_KEY_ID'), iss: has('APPLE_API_ISSUER_ID'), p8: has('APPLE_API_KEY_P8'), p8Readable: !!readP8() };
}
function jwt() {
  const key = readP8(); if (!key) throw new Error('APPLE_API_KEY_P8 를 키로 읽지 못함');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'ES256', kid: String(process.env.APPLE_API_KEY_ID).trim(), typ: 'JWT' }) + '.' + b64({
    iss: String(process.env.APPLE_API_ISSUER_ID).trim(), iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const sig = crypto.createSign('SHA256').update(unsigned).sign({ key, dsaEncoding: 'ieee-p1363' }, 'base64url');
  return unsigned + '.' + sig;
}
async function call(method, pathOrUrl, body) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = (j.errors && j.errors[0]) || {}; const err = new Error(`${r.status} ${e.code || ''} ${e.title || ''} ${e.detail || ''}`.trim()); err.status = r.status; throw err; }
  return j;
}
async function listAll(path) {
  const out = []; let next = path;
  for (let n = 0; next && n < 30; n++) { const j = await call('GET', next); out.push(...(j.data || [])); next = (j.links && j.links.next) || null; }
  return out;
}

/** 차트 순위 교차 확인 — iTunes RSS(쇼핑, 한국). 100위까지만 준다. 키가 없어도 돈다. 사람이 본 값은 manual_rank 로 남긴다. */
export async function updateChartRank() {
  try {
    const r = await fetch('https://itunes.apple.com/kr/rss/topfreeapplications/limit=100/genre=6024/json');
    if (!r.ok) throw new Error('RSS HTTP ' + r.status);
    const e = ((await r.json()).feed || {}).entry || [];
    const i = e.findIndex((x) => x && x.id && x.id.attributes && x.id.attributes['im:id'] === APP_ID);
    const rss = { rss_rank: i >= 0 ? i + 1 : null, checked_at: kstDay(0), source: 'rss', list_size: e.length };
    const cur = (await sbGet('analytics_manual?select=as_of,payload&id=eq.app_store')) || [];
    const p = (cur[0] && cur[0].payload) || {};
    const next = { ...p, chart_rank: rss };
    if (typeof p.chart_rank === 'number' && p.manual_rank == null) { next.manual_rank = p.chart_rank; next.manual_rank_as_of = cur[0].as_of || null; }
    if (cur.length) await sbUpsert('analytics_manual', 'id', [{ id: 'app_store', as_of: cur[0].as_of, payload: next, updated_at: new Date().toISOString() }]);
    console.log(`   쇼핑 차트 RSS(${e.length}개): ${rss.rss_rank ? rss.rss_rank + '위' : '100위 밖'}`);
    return rss;
  } catch (e) { console.log('   차트 RSS 확인 실패: ' + errText(e)); return null; }
}

export async function collectApple({ days = 28 } = {}) {
  await updateChartRank();
  const c = appleCheck();
  const stop = async (status, note, detail) => { await setMeta('apple', status, note, detail); return { status, note, rows: 0 }; };
  const miss = [!c.kid && 'APPLE_API_KEY_ID', !c.iss && 'APPLE_API_ISSUER_ID', !c.p8 && 'APPLE_API_KEY_P8'].filter(Boolean);
  if (miss.length) return stop('미설정', miss.join('·') + ' 없음');
  if (!c.p8Readable) return stop('오류', 'APPLE_API_KEY_P8 를 키로 읽지 못함');
  try {
    // ① 요청 목록
    const reqs = await listAll(`/v1/apps/${APP_ID}/analyticsReportRequests?limit=200`);
    for (const q of reqs) console.log(`   요청 ${q.attributes.accessType} · 비활성으로 멈춤=${q.attributes.stoppedDueToInactivity}`);
    let ongoing = reqs.find((q) => q.attributes.accessType === 'ONGOING');
    // ② 없으면 ONGOING 1건만 만든다(그 외 스토어 변경 없음)
    if (!ongoing) {
      try {
        await call('POST', '/v1/analyticsReportRequests', { data: { type: 'analyticsReportRequests', attributes: { accessType: 'ONGOING' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
      } catch (e) {
        if (e.status === 403) return stop('오류', '403 — 리포트 요청을 만들려면 Admin 역할 키가 필요함');
        throw e;
      }
      return stop('ok', '요청 생성, 첫 리포트 24~48h', { created_at: new Date().toISOString() });
    }
    if (ongoing.attributes.stoppedDueToInactivity) return stop('오류', 'ONGOING 요청이 비활성으로 멈춰 있음 — App Store Connect 에서 확인 필요(새로 만들지 않음)');
    // ③ 리포트 이름은 응답에서 읽어 맞춘다
    const reports = await listAll(`/v1/analyticsReportRequests/${ongoing.id}/reports?limit=200`);
    const names = reports.map((r) => r.attributes.name);
    console.log('   리포트 이름: ' + (names.join(' | ') || '(아직 없음)'));
    const pickReport = (want) => {
      const c2 = reports.filter((r) => String(r.attributes.name || '').toLowerCase().startsWith(want.toLowerCase()));
      return c2.find((r) => r.attributes.name.toLowerCase() === want.toLowerCase()) || c2.find((r) => /standard/i.test(r.attributes.name)) || c2[0] || null;
    };
    const rDl = pickReport(WANT.downloads), rEn = pickReport(WANT.engagement);
    if (!reports.length) return stop('ok', '기존 요청 사용 · 리포트 아직 없음(첫 리포트 24~48h)');
    if (!rDl && !rEn) return stop('오류', '리포트 이름이 예상과 다름 — 사람 확인 필요: ' + names.slice(0, 12).join(' | '), { names });
    const since = kstDay(-(days + 3));
    const readReport = async (rep) => {
      const inst = (await listAll(`/v1/analyticsReports/${rep.id}/instances?filter[granularity]=DAILY&limit=200`)).filter((i) => String(i.attributes.processingDate || '') >= since);
      const tables = [];
      for (const i of inst) {
        for (const s of await listAll(`/v1/analyticsReportInstances/${i.id}/segments?limit=200`)) {
          const r = await fetch(s.attributes.url);
          if (!r.ok) throw new Error('세그먼트 내려받기 실패 HTTP ' + r.status);
          const raw = Buffer.from(await r.arrayBuffer());
          let text; try { text = zlib.gunzipSync(raw).toString('utf8'); } catch { text = raw.toString('utf8'); }
          tables.push(parseDelimited(text, '\t'));
        }
      }
      return { instances: inst.length, tables };
    };
    const col = (head, name) => head.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
    const out = []; const info = {};
    if (rDl) {
      const { instances, tables } = await readReport(rDl); info.downloads = { name: rDl.attributes.name, instances };
      const acc = new Map();
      for (const t of tables) {
        if (t.length < 2) continue; const h = t[0]; const d = col(h, 'Date'), ty = col(h, 'Download Type'), cn = col(h, 'Counts');
        if (d < 0 || ty < 0 || cn < 0) { console.log('   다운로드 리포트 칸 이름이 다름: ' + h.join('|').slice(0, 200)); continue; }
        for (const r of t.slice(1)) {
          const kind = String(r[ty] || '').toLowerCase(); const v = num(r[cn]); if (v == null) continue;
          const dim = /first/.test(kind) ? 'type:first' : /redownload/.test(kind) ? 'type:redownload' : null; if (!dim) continue;
          const k = r[d] + '|' + dim; acc.set(k, (acc.get(k) || 0) + v);
        }
      }
      for (const [k, value] of acc) { const [day, dim] = k.split('|'); out.push({ day, metric: 'downloads', dim, value }); }
    }
    if (rEn) {
      const { instances, tables } = await readReport(rEn); info.engagement = { name: rEn.attributes.name, instances };
      const acc = new Map(); const add = (day, metric, v) => { if (v == null) return; const k = day + '|' + metric; acc.set(k, (acc.get(k) || 0) + v); };
      for (const t of tables) {
        if (t.length < 2) continue; const h = t[0]; const d = col(h, 'Date'), ev = col(h, 'Event'), cn = col(h, 'Counts'), un = col(h, 'Unique Counts');
        if (d < 0 || ev < 0 || cn < 0) { console.log('   노출 리포트 칸 이름이 다름: ' + h.join('|').slice(0, 200)); continue; }
        for (const r of t.slice(1)) {
          const e = String(r[ev] || '').toLowerCase();
          if (e === 'impression') { add(r[d], 'impressions', num(r[cn])); if (un >= 0) add(r[d], 'impressions_unique', num(r[un])); }
          else if (e === 'page view') add(r[d], 'page_views', num(r[cn]));
        }
      }
      for (const [k, value] of acc) { const [day, metric] = k.split('|'); out.push({ day, metric, value }); }
    }
    const n = await saveDaily('apple', out);
    const note = n ? `${n}행 · 기존 요청 사용 · 완성 기준 D-2` : '기존 요청 사용 · 0행(신규 데이터 없음)';
    await setMeta('apple', 'ok', note, { ...info, names: names.slice(0, 40) });
    return { status: 'ok', note, rows: n };
  } catch (e) {
    return stop('오류', errText(e));
  }
}

// ── 손으로 확인 ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--check')) {
  const c = appleCheck();
  console.log(`APPLE_API_KEY_ID ${c.kid ? '있음' : '없음'} · APPLE_API_ISSUER_ID ${c.iss ? '있음' : '없음'} · APPLE_API_KEY_P8 ${c.p8 ? (c.p8Readable ? '있음' : '있음(키로 못 읽음)') : '없음'}`);
  if (!(c.kid && c.iss && c.p8Readable)) { console.log('⏭️ 애플 키 미설정 — 확인을 건너뜀'); process.exit(0); }
  try {
    const app = await call('GET', `/v1/apps/${APP_ID}`);
    console.log(`✅ 200 · 앱 이름: ${app.data.attributes.name} · 번들 ${app.data.attributes.bundleId}`);
    const reqs = await listAll(`/v1/apps/${APP_ID}/analyticsReportRequests?limit=200`);
    console.log(`   리포트 요청 ${reqs.length}건: ` + (reqs.map((q) => `${q.attributes.accessType}(멈춤=${q.attributes.stoppedDueToInactivity})`).join(', ') || '없음'));
  } catch (e) { console.log('🔴 ' + errText(e)); process.exit(process.argv.includes('--strict') ? 1 : 0); }
}

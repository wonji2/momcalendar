// 구글 서치콘솔(GSC) 수집 — Search Console API searchAnalytics.query (2026-11-26, 사장님 「자동으로 해야지」)
//   오더: ORDER_GSC_ANALYTICS_2026-11-26(비공개 인계 문서) · 부르는 곳: collect.mjs jobs 의 'gsc'
//   실행   node tools/analytics/collect.mjs --only gsc [--days 28]   (키 점검만: --dry)
//   필요한 것: GA4_SA_KEY(서비스 계정 JSON 또는 base64) — GA4 와 같은 서비스 계정을 쓴다(GSC 속성에 '제한적' 권한 부여됨, 2026-11-26)
//             새 시크릿 없음. 토큰은 이 파일 안에서 webmasters.readonly 범위로만 따로 받는다(lib.mjs googleToken() 범위는 그대로).
//   선택   GSC_SITE (기본 'https://momcalendar.com/' — URL 접두어 속성)
//   저장   analytics_daily.source='gsc'
//     metric=clicks|impressions|ctr|position, dim=''                 → 날짜별 합계(일별 한 줄씩)
//       ctr      = 퍼센트, 소수 2자리(예 41.3). API 는 비율(0.413)로 준다 → ×100
//       position = 평균 순위(작을수록 좋다), 소수 2자리
//     metric=clicks|impressions, dim='query:<검색어>' | 'page:<경로>' → 최근 7일 상위 100개 스냅샷(그 7일의 마지막 집계일에 한 줄)
//       순서 = 클릭 많은 순, 같으면 노출 많은 순(우리 규모에선 클릭 0 인 검색어가 대부분이라 노출로 가른다)
//   날짜   GSC 는 2~3일 늦게 확정된다 → 끝 날짜 D-3(KST), dataState 'final'
//   실패   403·오류여도 analytics_meta('gsc') 에 사유만 남기고 다른 소스는 그대로 저장된다
//   되돌리기 collect.mjs 의 jobs 에서 gsc 한 줄을 빼면 꺼진다(쌓인 데이터는 Supabase 에 남는다)
import crypto from 'node:crypto';
import { has, errText, kstDay, readServiceAccount, saveDaily, setMeta } from './lib.mjs';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const SITE = String(process.env.GSC_SITE || 'https://momcalendar.com/').trim();

export function gscCheck() {
  const sa = readServiceAccount();
  return { key: has('GA4_SA_KEY'), keyReadable: !!sa, saEmail: sa ? sa.client_email : '', site: !!SITE, siteEnv: has('GSC_SITE') };
}

let _tok = null;
async function gscToken() {
  if (_tok && _tok.exp > Date.now() + 60e3) return _tok.token;
  const sa = readServiceAccount();
  if (!sa) throw new Error('GA4_SA_KEY 를 서비스 계정 JSON 으로 읽지 못함');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`GSC 토큰 교환 실패 HTTP ${r.status} ${j.error || ''} ${j.error_description || ''}`);
  _tok = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return _tok.token;
}

async function query(body) {
  const token = await gscToken();
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || '';
    const hint = r.status === 403 ? ' / GSC 속성 사용자·권한에 이 서비스 계정이 없거나 「제한적」 미만, 또는 Search Console API 사용 설정 확인' : '';
    throw new Error(`${r.status} ${msg}${hint}`.slice(0, 280));
  }
  return j.rows || [];
}

const isoDay = (s) => String(s || '').slice(0, 10);

export async function collectGsc({ days = 28 } = {}) {
  const c = gscCheck();
  const stop = async (status, note) => { await setMeta('gsc', status, note); return { status, note, rows: 0 }; };
  if (!c.key) return stop('미설정', 'GA4_SA_KEY 없음');
  if (!c.keyReadable) return stop('오류', 'GA4_SA_KEY 를 서비스 계정 JSON 으로 읽지 못함');
  try {
    const end = kstDay(-3);
    const start = kstDay(-3 - (days - 1));
    const out = [];
    for (const row of await query({ startDate: start, endDate: end, dimensions: ['date'], type: 'web', dataState: 'final', rowLimit: 25000 })) {
      const day = isoDay(row.keys && row.keys[0]);
      out.push({ day, metric: 'clicks', value: row.clicks || 0 },
               { day, metric: 'impressions', value: row.impressions || 0 },
               { day, metric: 'ctr', value: +(100 * (row.ctr || 0)).toFixed(2) },
               { day, metric: 'position', value: +(row.position || 0).toFixed(2) });
    }
    // 최근 7일 상위 검색어·페이지 100개씩 — 7일 창의 마지막 집계일(end)에 스냅샷으로
    const wStart = kstDay(-3 - 6);
    let nTop = 0;
    for (const dim of ['query', 'page']) {
      const rows = await query({ startDate: wStart, endDate: end, dimensions: [dim], type: 'web', dataState: 'final', rowLimit: 25000 });
      // 페이지는 경로로 줄인다(?q= 같은 꼬리가 다른 주소는 같은 경로로 합산 — 안 합치면 저장 때 한 줄만 남아 값이 틀린다)
      const agg = new Map();
      for (const r of rows) {
        let k = String(r.keys[0]);
        if (dim === 'page') { try { k = decodeURIComponent(new URL(k).pathname); } catch { try { k = new URL(k).pathname; } catch {} } }
        const key = `${dim}:${k}`.slice(0, 300);
        const a = agg.get(key) || { key, clicks: 0, impressions: 0 };
        a.clicks += r.clicks || 0; a.impressions += r.impressions || 0; agg.set(key, a);
      }
      const top = [...agg.values()].sort((a, b) => (b.clicks - a.clicks) || (b.impressions - a.impressions)).slice(0, 100);
      for (const a of top) {
        out.push({ day: end, metric: 'clicks', dim: a.key, value: a.clicks },
                 { day: end, metric: 'impressions', dim: a.key, value: a.impressions });
        nTop++;
      }
    }
    const n = await saveDaily('gsc', out);
    const note = n ? `${n}행 · ${start}~${end} · 상위 ${nTop}개` : '0행(신규 데이터 없음)';
    await setMeta('gsc', 'ok', note, { days, site: SITE, range: [start, end], top_window: [wStart, end], rows: n, sa: c.saEmail });
    return { status: 'ok', note, rows: n };
  } catch (e) {
    return stop('오류', errText(e));
  }
}

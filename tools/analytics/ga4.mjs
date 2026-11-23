// 웹(GA4) 수집 — Data API runReport (오더 §4-1 · §6-3)
//   필요한 것: GA4_SA_KEY(서비스 계정 JSON 또는 base64) · GA4_PROPERTY_ID(숫자 속성 ID — G-XXXX 측정 ID 가 아니다)
//   서비스 계정 이메일이 GA4 속성에 「뷰어」로 들어 있어야 한다(없으면 403).
import { googleToken, saveDaily, setMeta, has, errText, kstDay, readServiceAccount } from './lib.mjs';

const AI_SOURCES = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'claude.ai', 'copilot.microsoft.com', 'naver.com', 'search.naver.com', 'm.search.naver.com', 'google', 'daum.net'];
const ymd = (s) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

export function ga4Check() {
  const pid = String(process.env.GA4_PROPERTY_ID || '').trim();
  return { key: has('GA4_SA_KEY'), keyReadable: !!readServiceAccount(), pid: !!pid, pidOk: /^\d{6,12}$/.test(pid), pidLooksMeasurement: /^G-/i.test(pid) };
}

export async function collectGa4({ days = 28 } = {}) {
  const c = ga4Check();
  const stop = async (status, note) => { await setMeta('ga4', status, note); return { status, note, rows: 0 }; };
  if (!c.key) return stop('미설정', 'GA4_SA_KEY 없음');
  if (!c.pid) return stop('미설정', 'GA4_PROPERTY_ID 없음');
  if (!c.keyReadable) return stop('오류', 'GA4_SA_KEY 를 서비스 계정 JSON 으로 읽지 못함(JSON 전체 또는 base64 로 다시 등록)');
  if (!c.pidOk) return stop('오류', c.pidLooksMeasurement ? 'GA4_PROPERTY_ID 에 측정 ID(G-…)가 들어 있음 — 숫자 속성 ID 로 바꿔야 함' : 'GA4_PROPERTY_ID 가 숫자가 아님');
  try {
    const token = await googleToken();
    const pid = String(process.env.GA4_PROPERTY_ID).trim();
    const run = async (body) => {
      const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${pid}:runReport`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }], limit: 20000, ...body }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const st = (j.error && j.error.status) || '';
        const hint = r.status === 403 ? ' — GA4 속성 액세스 관리에 서비스 계정을 뷰어로 추가 필요' : r.status === 400 ? ' — 속성 ID(숫자) 확인 필요' : '';
        throw new Error(`${r.status} ${st}${hint}`);
      }
      return (j.rows || []).map((x) => ({ d: (x.dimensionValues || []).map((v) => v.value), m: (x.metricValues || []).map((v) => Number(v.value)) }));
    };
    const out = [];
    // G1 날짜별 기본 지표
    for (const r of await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }] })) {
      const day = ymd(r.d[0]); if (!day) continue;
      out.push({ day, metric: 'active_users', value: r.m[0] }, { day, metric: 'total_users', value: r.m[1] }, { day, metric: 'sessions', value: r.m[2] }, { day, metric: 'page_views', value: r.m[3] });
    }
    // G2 유입 채널 — 날짜별로 쌓아야 화면의 기간 합이 맞는다(기간 합을 하루에 넣으면 매일 겹쳐 더해진다)
    for (const r of await run({ dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }] })) {
      const day = ymd(r.d[0]); if (day) out.push({ day, metric: 'sessions', dim: 'channel:' + (r.d[1] || '(없음)'), value: r.m[0] });
    }
    // G3 AI·검색 유입 — 허용 목록만(source 는 수백 개다)
    for (const r of await run({ dimensions: [{ name: 'date' }, { name: 'sessionSource' }], metrics: [{ name: 'sessions' }],
      dimensionFilter: { filter: { fieldName: 'sessionSource', inListFilter: { values: AI_SOURCES, caseSensitive: false } } } })) {
      const day = ymd(r.d[0]); const src = String(r.d[1] || '').toLowerCase();
      if (day && AI_SOURCES.includes(src)) out.push({ day, metric: 'sessions', dim: 'source:' + src, value: r.m[0] });
    }
    // G4 웹→앱 CTA 클릭(합계만 — place 는 이벤트 파라미터라 여기서 못 가른다)
    for (const r of await run({ dimensions: [{ name: 'date' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'seo_app_cta' } } } })) {
      const day = ymd(r.d[0]); if (day) out.push({ day, metric: 'app_cta', dim: 'place:all', value: r.m[0] });
    }
    // G5 OS·브라우저 분포(기간 합, 참고용 — 카드에 「앱 사용자」로 쓰지 않는다). 어제 날짜 한 줄로 둔다.
    const mix = await run({ dimensions: [{ name: 'operatingSystem' }, { name: 'browser' }], metrics: [{ name: 'activeUsers' }], limit: 200 });
    const y = kstDay(-1); const os = {}, br = {};
    for (const r of mix) { os[r.d[0]] = (os[r.d[0]] || 0) + r.m[0]; br[r.d[1]] = (br[r.d[1]] || 0) + r.m[0]; }
    for (const [k, v] of Object.entries(os)) out.push({ day: y, metric: 'os_mix', dim: 'os:' + k, value: v });
    for (const [k, v] of Object.entries(br)) out.push({ day: y, metric: 'os_mix', dim: 'browser:' + k, value: v });
    console.log('   브라우저 상위 10(앱 분리 판단용): ' + Object.entries(br).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(' · '));
    const n = await saveDaily('ga4', out);
    const note = n ? `${n}행 · D-1까지` : '0행(신규 데이터 없음)';
    await setMeta('ga4', 'ok', note, { days, rows: n });
    return { status: 'ok', note, rows: n };
  } catch (e) {
    return stop('오류', errText(e));
  }
}

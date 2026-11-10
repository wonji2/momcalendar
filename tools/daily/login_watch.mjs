// 로그인 길별(카카오·네이버·애플) 완료율 감시 — 서버(깃허브 Actions)에서 매시간, PC 와 무관 (사장님 2026-11-10 「네이버로그인 안된다고 오류제보왔을텐데 자동으로 안 고치고 있어?」)
//   사고: 앱 네이버 로그인이 30일 95번 눌려 완료 4번(7일 0번)이었는데 아무 경보가 없었다. error_radar() 의 로그인 감시는 카카오 이벤트(kakao_login_*)만 봤다.
//   하는 일: events 의 <제공자>_login_start / _done / _fail 을 24시간·3시간으로 세어, 시작 ≥3 인데 완료율 <30% 이면 health_alerts(kind 'login:<제공자>')에 올린다.
//            정상으로 돌아오면 그 줄을 지운다. 알림은 관리자 홈 「고장 난 것」·ops.html 알림에 뜬다(폰 푸시 아님 — 2026-10-27 지시).
//   DB 함수·표는 바꾸지 않는다(REST 읽기 + health_alerts 쓰기만).
// 실행: SB_SERVICE_KEY=… node tools/daily/login_watch.mjs      (cloud_jobs.mjs JOBS.login_watch, 매시 17분)
const SBU = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY = process.env.SB_SERVICE_KEY;
if (!KEY) { console.log('SB_SERVICE_KEY 없음'); process.exit(1); }
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
async function count(type, hours) {
  const r = await fetch(`${SBU}/rest/v1/events?select=id&event_type=eq.${type}&visited_at=gte.${encodeURIComponent(iso(hours))}&limit=1`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const m = (r.headers.get('content-range') || '').match(/\/(\d+)$/);
  if (!r.ok && r.status !== 206) throw new Error(`${type} ${r.status}`);
  return m ? +m[1] : 0;
}
const NAMES = { kakao: '카카오', naver: '네이버', apple: '애플' };
let bad = 0;
for (const p of ['kakao', 'naver', 'apple']) {
  const [s24, d24, f24, s3, d3] = await Promise.all([count(`${p}_login_start`, 24), count(`${p}_login_done`, 24), count(`${p}_login_fail`, 24), count(`${p}_login_start`, 3), count(`${p}_login_done`, 3)]);
  const rate24 = s24 ? d24 / s24 : 1, rate3 = s3 ? d3 / s3 : 1;
  const red = (s24 >= 3 && rate24 < 0.30) || (s3 >= 3 && d3 === 0);
  const kind = `login:${p}`;
  console.log(`${NAMES[p]}: 24h 시작 ${s24} 완료 ${d24} 실패기록 ${f24} (${(rate24 * 100).toFixed(0)}%) · 3h 시작 ${s3} 완료 ${d3} → ${red ? '🔴' : '✅'}`);
  await fetch(`${SBU}/rest/v1/health_alerts?kind=eq.${encodeURIComponent(kind)}`, { method: 'DELETE', headers: H }).catch(() => {});
  if (red) {
    bad++;
    const detail = `${NAMES[p]} 로그인 완료율 낮음 — 24시간 시작 ${s24} · 완료 ${d24} (${(rate24 * 100).toFixed(0)}%) · 실패 기록 ${f24}건. ${p === 'naver' ? '네이버 개발자센터 앱 상태(개발 중/검수)·콜백 주소 확인' : '제공자 설정·키 확인'}`;
    await fetch(`${SBU}/rest/v1/health_alerts`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ kind, detail }) }).catch(() => {});
  }
}
process.exitCode = 0;   // 감시 결과는 health_alerts 로 알린다(작업 자체가 실패한 건 아니다)

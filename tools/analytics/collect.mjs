// 📊 통합 지표 수집기 — 웹(GA4) · 안드로이드(Google Play) · 애플(App Store) (2026-11-23)
//   오더: orders/ORDER_UNIFIED_ANALYTICS_2026-11-23.md · 화면: admin.html 「📊 통합 지표」 탭(RPC analytics_overview)
//
//   흐름   매일 08:40 KST .github/workflows/analytics-daily.yml → 이 파일 → Supabase analytics_daily / analytics_meta
//   실행   node tools/analytics/collect.mjs [--only ga4|play|apple] [--days 28] [--dry] [--report] [--strict]
//            --dry     API 를 부르지 않고 키 점검표만(값은 찍지 않는다 — 있음/없음·형식만)
//            --report  analytics_meta 를 표로 출력(GitHub 실행 요약에도 쓴다)
//            --strict  하나라도 오류면 종료코드 1(검증용). 평소엔 늘 0 — 한 소스가 죽어도 나머지는 저장된다
//   키가 하나도 없어도 끝까지 돈다: 그 소스는 analytics_meta 에 「미설정」만 남기고 넘어간다.
//   상태   DB analytics_meta(source 별 status·note·last_ok_at) — 파일 상태는 없다. 저장소에 아무것도 커밋하지 않는다.
//   의존성 0(node: 내장 + fetch). PC 가 꺼져도 돈다(깃허브 Actions). 재부팅으로 풀리는 로그인 없음(전부 시크릿 키).
import fs from 'node:fs';
import { SB_KEY, SB_URL, has, errText, sbGet, setMeta } from './lib.mjs';
import { collectGa4, ga4Check } from './ga4.mjs';
import { collectPlay, playCheck } from './play.mjs';
import { collectApple, appleCheck } from './apple.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const only = String(opt('only', '') || '').toLowerCase();
const days = Math.max(1, Math.min(120, parseInt(opt('days', '28'), 10) || 28));
const yn = (b) => (b ? '있음' : '없음');

function dry() {
  const g = ga4Check(), p = playCheck(), a = appleCheck();
  console.log('키 점검 (값은 출력하지 않습니다)');
  console.log(`  SUPABASE_SERVICE_KEY  ${yn(!!SB_KEY)}${SB_KEY ? '' : ' — 없으면 수집해도 저장하지 못함'}`);
  console.log(`  GA4_SA_KEY            ${yn(g.key)}${g.key && !g.keyReadable ? ' (서비스 계정 JSON 으로 못 읽음)' : ''}`);
  console.log(`  GA4_PROPERTY_ID       ${yn(g.pid)}${g.pid ? (g.pidOk ? ' (숫자 형식 맞음)' : g.pidLooksMeasurement ? ' (측정 ID 가 들어 있음 — 숫자 속성 ID 여야 함)' : ' (숫자가 아님)') : ''}`);
  console.log(`  PLAY_BUCKET           ${yn(p.bucket)}${p.bucket ? (p.bucketOk ? ' (버킷 이름 형식 맞음)' : ' (gs:// 나 경로 없이 버킷 이름만)') : ''}`);
  console.log(`  APPLE_API_KEY_ID      ${yn(a.kid)}`);
  console.log(`  APPLE_API_ISSUER_ID   ${yn(a.iss)}`);
  console.log(`  APPLE_API_KEY_P8      ${yn(a.p8)}${a.p8 && !a.p8Readable ? ' (키로 못 읽음)' : ''}`);
  console.log(`  → GA4 ${g.key && g.pid ? '수집 대상' : '미설정'} · PLAY ${p.key && p.bucket ? '수집 대상' : '미설정'} · APPLE ${a.kid && a.iss && a.p8 ? '수집 대상' : '미설정'}`);
}

async function report() {
  let rows = [];
  try { rows = (await sbGet('analytics_meta?select=source,status,note,last_ok_at,last_try_at&order=source')) || []; }
  catch (e) { console.log('상태 표를 읽지 못함: ' + errText(e)); }
  const kst = (t) => (t ? new Date(new Date(t).getTime() + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '—');
  const lines = ['| 소스 | 상태 | 마지막 성공(KST) | 마지막 시도(KST) | 사유 |', '| --- | --- | --- | --- | --- |'];
  for (const s of ['ga4', 'play', 'apple']) {
    const r = rows.find((x) => x.source === s);
    lines.push(r ? `| ${s} | ${r.status} | ${kst(r.last_ok_at)} | ${kst(r.last_try_at)} | ${String(r.note || '').replace(/\|/g, '/')} |` : `| ${s} | 기록 없음 | — | — | ${SB_KEY ? '아직 한 번도 안 돎' : 'SUPABASE_SERVICE_KEY 없음'} |`);
  }
  const text = '### 통합 지표 수집 상태\n\n' + lines.join('\n') + '\n';
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text); } catch {} }
}

async function main() {
  if (flag('dry')) return dry();
  if (flag('report')) return report();
  if (only && !['ga4', 'play', 'apple'].includes(only)) { console.log(`--only 는 ga4·play·apple 중 하나여야 합니다(받은 값: ${only})`); return; }
  if (!SB_KEY) console.log('⚠ SUPABASE_SERVICE_KEY 없음 — 수집은 하되 저장하지 못합니다(상태도 기록 안 됨)');
  const jobs = [['ga4', collectGa4], ['play', collectPlay], ['apple', collectApple]].filter(([k]) => !only || k === only);
  let bad = 0;
  for (const [name, fn] of jobs) {
    let r;
    try { r = await fn({ days }); }
    catch (e) { r = { status: '오류', note: errText(e), rows: 0 }; await setMeta(name, '오류', r.note); }
    const mark = r.status === 'ok' ? '✅' : r.status === '미설정' ? '⏭️' : '🔴';
    console.log(`${mark} ${name} · 행 ${r.rows}개 · ${r.status}${r.note ? ' · ' + r.note : ''}`);
    if (r.status === '오류') bad++;
  }
  if (flag('strict') && bad) process.exitCode = 1;
}

process.on('unhandledRejection', (e) => { console.log('🔴 처리 안 된 오류: ' + errText(e)); });
main().catch((e) => { console.log('🔴 ' + errText(e)); if (flag('strict')) process.exitCode = 1; });

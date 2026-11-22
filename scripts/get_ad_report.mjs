// 스폰서 배너 광고 결과보고서 — 총 노출·총 클릭·클릭률(CTR)·날짜별 추이를 광고주 전달용 표(Markdown)로 뽑는다
//   (지시서 scratchpad/ORDER_SPONSORED_BANNER_AND_TRACKING.md 4장, 2026-11-12)
//
//   node scripts/get_ad_report.mjs --ad slim_231                      그 광고의 전체 기간
//   node scripts/get_ad_report.mjs --ad slim_231 --from 2026-11-12 --to 2026-11-19
//   node scripts/get_ad_report.mjs --ad slim_231 --out report.md      파일로도 저장
//   node scripts/get_ad_report.mjs --ad darim_202611 --mock           DB 없이 가짜 자료로 모양만 확인
//   node scripts/get_ad_report.mjs --list                             최근 30일에 기록이 있는 광고 id 목록
//
//   자료: Supabase events 표의 event_type 'sponsored_ad_impression'(화면에 50% 이상 보인 횟수, 쪽마다 1회) · 'sponsored_ad_click', event_data = 「<광고id>:<모양 A|B|C|T>」
//   광고 id: 관리자에서 건 띠배너는 「slim_<배너 번호>」(관리자 🖼 배너 탭의 번호). 날짜는 한국 시간 기준.
//   DB 접속: 이 PC 의 Supabase CLI(로그인·프로젝트 연결된 상태)로 읽기만 한다. 비밀값은 이 파일에 없다. 상태파일 없음.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : (argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=').slice(1).join('=') || null; };
const AD = arg('ad'), FROM = arg('from'), TO = arg('to'), OUT = arg('out'), MOCK = argv.includes('--mock'), LIST = argv.includes('--list');
if (!LIST && !AD) { console.error('사용법: node scripts/get_ad_report.mjs --ad <광고id> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out 파일] [--mock]   또는   --list'); process.exit(1); }
for (const [k, v] of [['ad', AD], ['from', FROM], ['to', TO]]) if (v && !/^[A-Za-z0-9_.\-]+$/.test(v)) { console.error(`--${k} 값에 쓸 수 없는 글자가 있습니다: ${v}`); process.exit(1); }

const CLI = process.env.SUPABASE_CLI || (process.platform === 'win32' ? 'C:/Users/FAMILY/supabase-cli/supabase.exe' : 'supabase');
const sql = (q) => { const out = execFileSync(CLI, ['db', 'query', q, '--linked', '--output-format', 'json']   /* 예약작업에서는 이 플래그가 없으면 JSON 이 아닌 표가 나온다(sb_query.mjs 의 경고 — 2026-11-12 ops_autofix 가 두 회차를 헛돌았다) */, { encoding: 'utf8', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50e6 }); const j = JSON.parse(out.slice(out.search(/[\[{]/))); return Array.isArray(j) ? j : j.rows; };

if (LIST) {
  const rows = sql("select split_part(event_data,':',1) ad, count(*) filter (where event_type='sponsored_ad_impression') imp, count(*) filter (where event_type='sponsored_ad_click') clk, to_char(min(visited_at at time zone 'Asia/Seoul'),'YYYY-MM-DD') first_day, to_char(max(visited_at at time zone 'Asia/Seoul'),'YYYY-MM-DD') last_day from events where event_type in ('sponsored_ad_impression','sponsored_ad_click') and visited_at > now() - interval '30 days' group by 1 order by 2 desc");
  console.log('| 광고 id | 노출 | 클릭 | 첫 기록 | 마지막 기록 |\n|---|---:|---:|---|---|'); for (const r of rows) console.log(`| ${r.ad} | ${r.imp} | ${r.clk} | ${r.first_day} | ${r.last_day} |`);
  if (!rows.length) console.log('| (최근 30일 기록 없음) | | | | |');
  process.exit(0);
}

// 날짜별 [{day, type, imp, clk}]
let rows;
if (MOCK) {
  const base = FROM || '2026-11-12'; const d0 = new Date(base + 'T00:00:00Z'); rows = [];
  const imps = [1840, 2105, 1962, 1410, 1388, 2230, 2075], clks = [41, 52, 47, 29, 27, 61, 49];
  for (let i = 0; i < 7; i++) { const day = new Date(d0.getTime() + i * 864e5).toISOString().slice(0, 10); if (TO && day > TO) break; rows.push({ day, type: 'B', imp: imps[i], clk: clks[i] }); }
} else {
  const cond = [`event_type in ('sponsored_ad_impression','sponsored_ad_click')`, `split_part(event_data,':',1) = '${AD}'`];
  if (FROM) cond.push(`visited_at >= ('${FROM} 00:00:00'::timestamp at time zone 'Asia/Seoul')`);
  if (TO) cond.push(`visited_at < (('${TO} 00:00:00'::timestamp + interval '1 day') at time zone 'Asia/Seoul')`);
  rows = sql(`select to_char(visited_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day, coalesce(nullif(split_part(event_data,':',2),''),'-') as type, count(*) filter (where event_type='sponsored_ad_impression') as imp, count(*) filter (where event_type='sponsored_ad_click') as clk from events where ${cond.join(' and ')} group by 1,2 order by 1,2`)
    .map((r) => ({ day: r.day, type: r.type, imp: +r.imp, clk: +r.clk }));
}

const n = (x) => Number(x).toLocaleString('ko-KR');
const ctr = (c, i) => (i > 0 ? (c / i * 100).toFixed(2) + '%' : '-');
const byDay = new Map(); const byType = new Map();
for (const r of rows) { const d = byDay.get(r.day) || { imp: 0, clk: 0 }; d.imp += r.imp; d.clk += r.clk; byDay.set(r.day, d); const t = byType.get(r.type) || { imp: 0, clk: 0 }; t.imp += r.imp; t.clk += r.clk; byType.set(r.type, t); }
const days = [...byDay.keys()].sort(); const tot = [...byDay.values()].reduce((a, d) => ({ imp: a.imp + d.imp, clk: a.clk + d.clk }), { imp: 0, clk: 0 });
const SHAPE = { A: '시안 A(왼쪽 사진 + 한 줄)', B: '시안 B(가로 사진)', C: '시안 C(글 두 줄 + 사진)', T: '글자 배너', '-': '모양 기록 없음' };
const L = [];
L.push(`# 맘캘린더 배너 광고 결과보고서`);
L.push('');
L.push(`- 광고: ${AD}${MOCK ? ' (가짜 자료 — 모양 확인용)' : ''}`);
L.push(`- 집계 기간: ${days.length ? days[0] + ' ~ ' + days[days.length - 1] : (FROM || '-') + ' ~ ' + (TO || '-')} (한국 시간, ${days.length}일)`);
L.push(`- 노출 위치: 맘캘린더 공구 탭 이웃셀러 아래 스폰서 배너`);
L.push('');
L.push('## 요약');
L.push('');
L.push('| 총 노출수 | 총 클릭수 | 클릭률(CTR) | 하루 평균 노출 | 하루 평균 클릭 |');
L.push('|---:|---:|---:|---:|---:|');
L.push(`| ${n(tot.imp)} | ${n(tot.clk)} | ${ctr(tot.clk, tot.imp)} | ${days.length ? n(Math.round(tot.imp / days.length)) : '-'} | ${days.length ? n(Math.round(tot.clk / days.length * 10) / 10) : '-'} |`);
L.push('');
L.push('## 날짜별');
L.push('');
L.push('| 날짜 | 노출수 | 클릭수 | 클릭률(CTR) |');
L.push('|---|---:|---:|---:|');
for (const d of days) { const v = byDay.get(d); const wd = '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()]; L.push(`| ${d} (${wd}) | ${n(v.imp)} | ${n(v.clk)} | ${ctr(v.clk, v.imp)} |`); }
if (!days.length) L.push('| (기록 없음) | 0 | 0 | - |');
L.push(`| **합계** | **${n(tot.imp)}** | **${n(tot.clk)}** | **${ctr(tot.clk, tot.imp)}** |`);
if (byType.size > 1) { L.push(''); L.push('## 배너 모양별'); L.push(''); L.push('| 모양 | 노출수 | 클릭수 | 클릭률(CTR) |'); L.push('|---|---:|---:|---:|'); for (const [t, v] of [...byType.entries()].sort()) L.push(`| ${SHAPE[t] || t} | ${n(v.imp)} | ${n(v.clk)} | ${ctr(v.clk, v.imp)} |`); }
L.push('');
L.push('## 집계 기준');
L.push('');
L.push('- 노출수: 배너가 화면에 절반 이상 보였을 때 1회로 셉니다(화면을 한 번 열 때마다 최대 1회).');
L.push('- 클릭수: 배너를 눌러 광고주 페이지로 이동한 횟수입니다.');
L.push('- 클릭률(CTR) = 클릭수 ÷ 노출수.');
L.push(`- 광고주 페이지 주소에는 utm_source=momcalendar · utm_medium=banner · utm_campaign=${AD} 가 붙어, 광고주 쪽 통계에서도 유입을 확인할 수 있습니다.`);
const text = L.join('\n') + '\n';
process.stdout.write(text);
if (OUT) { fs.writeFileSync(OUT, text); console.error('저장: ' + OUT); }
if (!MOCK && !days.length) console.error(`⚠ 「${AD}」 기록이 없습니다. 광고 id 는 --list 로 확인하세요.`);

// 네이버 상시 핫딜 가격 자동 추적 (사장님 지시 2026-08-21)
//   "매일 올리는 계란 가격 지금 7120원인데 왜 9500원으로 떠있어 매일 들어가서 실시간 가격 받아와야지"
//
// 경로가 특이한 이유: 네이버 스마트스토어는 자동 조회가 전부 막혀 있다 (2026-08-21 실측 3종).
//   서버 curl → 로그인/캡차 · 인앱 브라우저 → 정책 차단 · 크롬 확장 → 정책 차단
//   유일하게 열린 길 = **네이버 통합검색(SERP)**. 검색결과 JSON 에 상품 카드(channelProductId)와
//   salePrice / discountedKRWSalePrice / couponDiscountedPrice 가 들어 있다.
// ⚠ SERP 값은 실제 페이지와 시차·차이가 있을 수 있다(실측: 페이지 7,120 vs SERP 쿠폰가 8,800).
//   그래도 몇 주째 옛 가격으로 굳는 것보다 낫다. 검색에서 사라지면 갱신하지 않고 경보만 남긴다.
//
// 실행: node tools/daily/naver_track.mjs   (예약작업 momcal-naver-track, 6시간마다)
// 로그: scratchpad/naver_track_log.txt
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LOG = join(ROOT, 'scratchpad', 'naver_track_log.txt');
const log = (s) => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(LOG, `[${t}] ${s}\n`); console.log(s); };
const sqlf = join(ROOT, 'scratchpad', '_naver_track.sql');
const runSql = (sql) => { writeFileSync(sqlf, sql); return execFileSync(SB, ['db', 'query', '--linked', '-f', sqlf], { encoding: 'utf8', timeout: 60000 }); };

// 1) 추적 대상: 살아있는 네이버 소스 핫딜
const out = runSql(`select json_agg(json_build_object('id',id,'title',title,'price',price,'price_before',price_before,'link',link)) j
from hotdeals where source='naver' and (expires_at is null or expires_at>now());`);
const m = out.match(/"j":\s*(\[.*\])\s*\}/s);
const deals = m ? JSON.parse(m[1].replace(/\\u0026/g, '&')) : [];
// 🔴 조용히 죽지 않게 (2026-09-01: 8/23~9/1 9일간 로그가 한 줄도 없었다).
//    예전엔 대상 조회가 실패해도 console.log 만 하고 끝나 예약작업 결과는 '성공(0)' 으로 남았다.
//    → 파일 로그로 남겨야 다음 세션이 "안 돌고 있다" 를 알아챈다.
if (!m) { log('🔴 추적 대상 조회 실패 — SQL 응답을 못 읽었다 (CLI 출력 형식 변경 의심)'); process.exit(1); }
if (!deals.length) { log('추적할 네이버 핫딜 없음 (source=naver 살아있는 카드 0건)'); process.exit(0); }

for (const d of deals) {
  const pidM = (d.link || '').match(/channelProductNo=(\d+)/);
  if (!pidM) { log(`🔴 id ${d.id} 링크에 channelProductNo 없음`); continue; }
  const pid = pidM[1];
  // 제목에서 검색어 (괄호/특수문자 정리)
  const q = d.title.replace(/\[[^\]]*\]/g, ' ').replace(/[^가-힣a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const r = await fetch('https://search.naver.com/search.naver?query=' + encodeURIComponent(q),
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' } });
  const html = await r.text();
  const idx = html.indexOf(`"channelProductId":"${pid}"`);
  if (idx < 0) {
    log(`⚠ id ${d.id} SERP 에서 상품(${pid}) 못 찾음 — 가격 유지, 경보`);
    runSql(`insert into health_alerts(kind, detail) values ('naver핫딜조회불가',
      'id ${d.id} ${d.title.slice(0, 30).replace(/'/g, "''")} — SERP 미노출. 판매 종료면 카드 내릴 것');`);
    continue;
  }
  const ctx = html.slice(idx, idx + 4000);
  const pick = (re) => { const x = ctx.match(re); return x ? Number(x[1].replace(/,/g, '')) : null; };
  const sale = pick(/"salePrice"\s*:\s*"?([0-9,]+)"?/);
  const disc = pick(/"discountedKRWSalePrice"\s*:\s*"?([0-9,]+)"?/);
  const coup = pick(/"couponDiscountedPrice"\s*:\s*"?([0-9,]+)"?/);
  const candidates = [coup, disc].filter(x => x && x > 100);
  // 🔴 할인·쿠폰가를 못 읽으면 **갱신하지 않는다** (2026-09-01 사고).
  //    예전엔 못 읽으면 salePrice(정가)로 폴백했다 → 계란 카드가 정가 13,900원으로 덮였다.
  //    핫딜 카드에 정가가 들어가면 그건 핫딜이 아니다. 못 읽으면 그대로 두고 경보만 남긴다.
  if (!candidates.length) {
    log(`⚠ id ${d.id} 할인·쿠폰가를 못 읽음 (SERP 정가 ${sale ?? '-'}) — 갱신 안 함`);
    runSql(`insert into health_alerts(kind, detail) values ('naver핫딜가격파싱실패',
      'id ${d.id} ${d.title.slice(0, 30).replace(/'/g, "''")} — SERP 에서 할인가를 못 읽었다. 카드 가격 직접 확인 필요');`);
    continue;
  }
  const newPrice = Math.min(...candidates);
  if (!newPrice || newPrice < 100) { log(`⚠ id ${d.id} 가격 필드 없음`); continue; }
  // 급변(3배 이상·1/3 이하)은 파싱 오류로 보고 건드리지 않는다
  if (d.price && (newPrice > d.price * 3 || newPrice < d.price / 3)) {
    log(`⚠ id ${d.id} 가격 급변 의심 ${d.price}→${newPrice} — 갱신 안 함`); continue;
  }
  // 🔴 SERP 값이 지난번과 같으면 카드를 건드리지 않는다 (2026-08-21 실측):
  //    페이지 전용 쿠폰 때문에 실가(7,120)가 SERP 쿠폰가(8,800)보다 쌀 수 있다.
  //    사장님이 실측으로 정정한 값을 SERP 가 매일 되돌려 쓰면 안 된다.
  //    SERP 값이 **변했을 때만** "딜이 바뀌었다"로 보고 갱신한다.
  const stateF = join(ROOT, 'scratchpad', 'naver_track_state.json');
  let state = {}; try { state = JSON.parse(readFileSync(stateF, 'utf8')); } catch (_) {}
  // 🔴 SERP 값이 지난번과 같아도 **카드 값과 크게 벌어져 있으면 그냥 넘기지 않는다** (2026-09-01 사고).
  //    예전엔 "SERP 변동 없음 → 카드 유지" 로 무조건 넘겨서, 8/22 부터 9일간 카드가 7,120원에 굳어 있었다
  //    (실제 8,900원). 사장님 수동 정정을 되돌리지 않으려던 의도였는데 틀린 값을 지키는 로직이 됐다.
  //    → 자동 갱신은 여전히 안 한다(수동 정정 존중). 대신 10% 이상 벌어지면 경보를 남겨 사람이 보게 한다.
  if (state[d.id] === newPrice) {
    const gap = d.price ? Math.abs(newPrice - d.price) / d.price : 0;
    if (gap >= 0.1) {
      log(`🔴 id ${d.id} SERP ${newPrice} vs 카드 ${d.price} — ${Math.round(gap * 100)}% 차이. 확인 필요`);
      runSql(`insert into health_alerts(kind, detail) values ('naver핫딜가격불일치',
        'id ${d.id} ${d.title.slice(0, 30).replace(/'/g, "''")} — 카드 ${d.price}원 / 네이버 ${newPrice}원 (${Math.round(gap * 100)}% 차이)');`);
    } else {
      log(`= id ${d.id} SERP 변동 없음 (${newPrice}) — 카드 유지 ${d.price}`);
    }
    continue;
  }
  state[d.id] = newPrice; writeFileSync(stateF, JSON.stringify(state));
  if (newPrice === d.price) { log(`= id ${d.id} 변동 없음 (${newPrice})`); continue; }
  const rate = d.price_before ? Math.round((1 - newPrice / d.price_before) * 100) : null;
  runSql(`update hotdeals set price=${newPrice}${rate != null ? `, discount_rate=${rate}` : ''},
    deal_day=(now() at time zone 'Asia/Seoul')::date where id=${d.id};`);
  log(`✅ id ${d.id} ${d.price}→${newPrice}원 갱신 (SERP 정가 ${sale ?? '-'} · 할인 ${disc ?? '-'} · 쿠폰 ${coup ?? '-'})`);
}

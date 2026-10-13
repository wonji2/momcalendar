// 서비스형 수익링크(나들이·여행·도서 등) 머천트가 아직 통과하는지 점검 — 승인이 풀리면 카드가 조용히 에러 페이지로 간다
//   node tools/daily/aff_service_probe.mjs        → 통과/막힘 표, 막힌 게 있으면 종료코드 1
// 흐름: click.linkprice.com/click.php?m=<머천트>&a=A100706561&tu=<머천트 실제 주소> 의 첫 응답 Location 이
//       view/error/error.php 면 막힘. test.html 의 MC_TRIP_BRANDS·tripGo('kw') 와 같은 목록을 쓴다(바꾸면 여기도).
// 2026-10-13 실측 통과: klook · yanolja · myrealtrip · agoda · expedia · momq · hmall · yes24 (kurly 는 통과하나 최종 404 라 제외)
// 2026-10-13 승인대기(REQ): banksalad · interpark · hanatour · booking · chungho · wjcoway · cjmall · tmon · eduwill — 링크프라이스 로그인 후 제휴 신청
// 상태파일 없음. 삼쩜삼·핀다는 링크프라이스에 코드가 없다(존재하지 않음) — 다른 네트워크/직접 제휴 필요.
const AFF = 'A100706561';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const T = [
  ['klook', 'https://www.klook.com/ko/search/result/?query=' + encodeURIComponent('서울랜드')],
  ['yanolja', 'https://www.yanolja.com/'],
  ['myrealtrip', 'https://www.myrealtrip.com/'],
  ['agoda', 'https://www.agoda.com/ko-kr/'],
  ['expedia', 'https://www.expedia.co.kr/'],
  ['momq', 'https://www.momq.co.kr/'],
  ['hmall', 'https://www.hmall.com/'],
  ['yes24', 'https://www.yes24.com/'],
];
let bad = 0;
for (const [m, tu] of T) {
  const u = `https://click.linkprice.com/click.php?m=${m}&a=${AFF}&l=9999&l_cd1=3&l_cd2=0&tu=${encodeURIComponent(tu)}`;
  try {
    const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    const loc = r.headers.get('location') || '';
    const ok = r.status >= 300 && r.status < 400 && loc && !/view\/error\/error\.php/.test(loc);
    if (!ok) bad++;
    console.log(ok ? '✅' : '⛔', m.padEnd(11), ok ? loc.slice(0, 70) : '막힘/오류 ' + r.status + ' ' + loc.slice(0, 60));
  } catch (e) { bad++; console.log('⛔', m.padEnd(11), 'ERR', String(e).slice(0, 50)); }
}
console.log(bad ? `\n⛔ ${bad}곳 막힘 — test.html 의 해당 카드를 내리거나 제휴 상태를 확인할 것` : '\n✅ 전부 통과');
process.exit(bad ? 1 : 0);

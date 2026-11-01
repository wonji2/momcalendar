/**
 * 🧪 맘캘봇 문의 갈래 점검 — 문의(교환·환불·오류 제보·입점) 말과 「같은 낱말이 든 상품 검색」이 서로 안 뺏는지
 *   (2026-10-24 2차 검증 지적: 「전열교환기」「교환 가능한 기저귀」「오류 없는 체온계」가 문의 안내로 빠졌다. 전열교환기는 실손님)
 *
 * 실행  node tools/daily/bot_cs_probe.mjs                 운영 함수(kakao-skill)
 *       node tools/daily/bot_cs_probe.mjs kakao-skill-test 시험 함수 — 배포 전에 이걸로 먼저 돈다
 * 판정  pay = 결제·배송 고정 안내 / seller = 셀러 등록 안내 / mail = 문의 메일 카드 / search = 그 밖(공구 카드·없음 안내)
 *   ⚠ 문의 갈래 정규식(CS_PAY·CS_SELLER·CS_MAIL)을 고치면 이 점검을 두 함수에 다 돌린다. 하나라도 ✗ 면 배포하지 않는다.
 */
const FN = process.argv[2] || 'kakao-skill';
const U = `https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/${FN}`;
const CASES = [
  // 상품 검색이어야 한다 — 문의 낱말이 상품명 안에 있다
  ['전열교환기', 'search'], ['교환 가능한 기저귀', 'search'], ['교환권', 'search'], ['오류 없는 체온계', 'search'],
  ['오류없는 체온계', 'search'], ['반품 특가', 'search'], ['공구 신청하고 싶어요', 'search'], ['택배 박스', 'search'], ['기저귀', 'search'],
  // 문의여야 한다
  ['교환하고 싶어요', 'pay'], ['환불', 'pay'], ['환불 받고 싶어요', 'pay'], ['반품하려면 어떻게 해요', 'pay'], ['배송 언제 와요', 'pay'],
  ['교환 문의', 'pay'], ['주문 취소', 'pay'],
  ['입점하고 싶어요', 'seller'], ['공구 등록하고 싶어요', 'seller'],
  ['오류가 있어요', 'mail'], ['오류 제보', 'mail'], ['에러 떠요', 'mail'], ['건의할게요', 'mail'], ['삭제 요청', 'mail'], ['메일로 문의하기', 'mail'],
];
const kind = (o) => {
  const t = o.textCard?.text || o.simpleText?.text || '';
  if (/유용한 정보를 모아 공유/.test(t)) return 'pay';
  if (/셀러 입점은/.test(t)) return 'seller';
  if (/문의 보내기/.test(o.listCard?.header?.title || '')) return 'mail';
  return 'search';
};
let bad = 0;
for (const [say, want] of CASES) {
  const j = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: say, user: { id: 'BOTCSPROBE' } } }) }).then((r) => r.json()).catch((e) => ({ err: String(e) }));
  const got = j.err ? 'ERR' : kind(j?.template?.outputs?.[0] || {});
  if (got !== want) bad++;
  console.log(got === want ? '✓' : '✗', say.padEnd(16), '→', got, got === want ? '' : `(기대 ${want})`);
}
console.log(`${FN}: ${CASES.length - bad}/${CASES.length} 통과`);
process.exit(bad ? 1 : 0);

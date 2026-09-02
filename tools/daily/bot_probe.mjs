/**
 * 🧪 챗봇 선제 점검 — 손님이 쓸 법한 말을 미리 던져 오류를 찾는다
 *   (사장님 지시 2026-09-01 "오류 계속 잡아가야해" · "예측해서 더 넣어놔 넓게")
 *
 * 실행  node tools/daily/bot_probe.mjs            전체
 *       node tools/daily/bot_probe.mjs 말투        그 묶음만
 * 판정  card = 공구를 찾아줘야 함 / text = 안내가 정답(인사·없는 브랜드)
 *   ⚠ DB 에 없는 브랜드는 text 가 정답이다. 그걸 오류로 세면 진짜 문제가 묻힌다.
 *   ⚠ 카드가 나왔다고 정답이 아니다 — '로얄젤리' 에 장난감정리함이 나간 적 있다(2026-09-01).
 *      그래서 bad 낱말(나오면 안 되는 말)도 함께 검사한다.
 */
import { checkSpec } from './kakao_spec.mjs';
const U = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1/kakao-skill';
const ONLY = process.argv[2] || '';

// [묶음, 발화, 기대, 카드에 이 낱말이 들어가야 함(선택)]
const CASES = [
  // ── 날짜·목록
  ['날짜', '오늘 공구', 'card'], ['날짜', '오늘공구', 'card'], ['날짜', '오늘 뭐 있어?', 'card'],
  ['날짜', '오늘 뭐있나요', 'card'], ['날짜', '오늘 공구 뭐잇어?', 'card'], ['날짜', '지금 하는 공구', 'card'],
  ['날짜', '내일 공구 알려줘', 'card'], ['날짜', '낼 공구', 'card'], ['날짜', '이번주 공구', 'card'],
  ['날짜', '이번 주 일정', 'card'], ['날짜', '주말 공구', 'card'], ['날짜', '토요일 공구', 'card'],
  ['날짜', '일요일 공구', 'card'], ['날짜', '오늘 오픈하는거 뭐야', 'card'], ['날짜', '오늘 오픈', 'card'],
  ['날짜', '오늘 마감', 'card'], ['날짜', '오늘 마감되는거', 'card'], ['날짜', '마감임박', 'card'],
  ['날짜', '오늘 끝나는 공구', 'card'], ['날짜', '마지막날인거', 'card'],
  // ── 인기
  ['인기', '인기 공구', 'card'], ['인기', '젤 핫한거', 'card'], ['인기', '오늘의 탑텐', 'card'],
  ['인기', '제일 인기있는거', 'card'], ['인기', '조회수 많은거', 'card'], ['인기', '베스트', 'card'],
  ['인기', '순위 알려줘', 'card'], ['인기', '요즘 핫한 공구', 'card'],
  // ── 품목 (DB 에 있는 것 — 그 낱말이 카드에 있어야 한다)
  ['품목', '물티슈', 'card', '물티슈'], ['품목', '기저귀', 'card', '기저귀'],
  ['품목', '카시트', 'card', '카시트'], ['품목', '유모차', 'card', '유모차'],
  ['품목', '곰탕', 'card', '곰탕'], ['품목', '김', 'card', '김'],
  ['품목', '스티커', 'card', '스티커'], ['품목', '블록', 'card', '블록'],
  ['품목', '사운드북', 'card', '사운드'], ['품목', '이유식', 'card'],
  ['품목', '유산균', 'card'], ['품목', '젤리', 'card', '젤리'],
  // ── 브랜드
  ['브랜드', '뽀로로', 'card', '뽀로로'], ['브랜드', '티니핑', 'card', '티니핑'],
  ['브랜드', '아티바바', 'card', '아티바바'], ['브랜드', '우아한김', 'card', '김'],
  ['브랜드', '동결건조국', 'card', '동결건조'],
  // ── 붙여 쓴 말·수식어 (수식어를 브랜드로 착각하면 안 된다)
  // 아기물티슈는 핫딜 제목에 그 말이 통째로 들어 있다(퓨어스트 … 아기물티슈 캡형).
  //   사장님 지시대로(2026-09-02) 핫딜 안내가 나가는 게 맞다.
  //   핫딜 목록은 매일 바뀌므로 any 로 둔다. 못 박으면 내일 가짜 경보가 된다.
  ['붙임', '아기물티슈', 'any', ''], ['붙임', '아기곰탕', 'card', '곰탕'],
  ['붙임', '아기김', 'card', '김'], ['붙임', '유아카시트', 'card', '카시트'],
  ['붙임', '신생아 기저귀', 'card', '기저귀'], ['붙임', '아기 유모차', 'card', '유모차'],
  ['붙임', '네임스티커', 'card', '스티커'], ['붙임', '이름스티커', 'card', '스티커'],
  ['붙임', '네임 스티커', 'card', '스티커'], ['붙임', '이름 스티커', 'card', '스티커'],
  // ── 별칭·줄임
  // ⚠ 뽀사카 계열은 답이 **그날 상황에 따라 달라진다** (사장님 설명 2026-09-01):
  //    뽀로로사운드카드 공구가 지금 없어서 내일까지만 핫딜을 보여주는 임시 조치다.
  //    공구가 올라오면 카드가 정답이 되므로 기대값을 못 박지 않고 'any'(장애만 아니면 통과) 로 둔다.
  ['별칭', '뽀사카', 'any'], ['별칭', '뽀로로사운드카드', 'any'],
  ['별칭', '뽀로로 사운드 카드', 'any'], ['별칭', '오징어블록', 'card', '아티바바'],
  ['별칭', '오징어블럭', 'card', '아티바바'],
  // ── 말투
  ['말투', '물티슈 알려줘', 'card', '물티슈'], ['말투', '물티슈알려죠', 'card', '물티슈'],
  ['말투', '물티슈 알려줭', 'card', '물티슈'], ['말투', '물티슈 있어?', 'card', '물티슈'],
  ['말투', '물티슈 잇어?', 'card', '물티슈'], ['말투', '물티슈 있나요', 'card', '물티슈'],
  ['말투', '물티슈 궁금해요', 'card', '물티슈'], ['말투', '물티슈 공구 궁금해요!', 'card', '물티슈'],
  ['말투', '물티슈 알고싶어요', 'card', '물티슈'], ['말투', '물티슈 좀 보여줘', 'card', '물티슈'],
  ['말투', '물티슈 추천해줘', 'card', '물티슈'], ['말투', '물티슈 파는 곳', 'card', '물티슈'],
  ['말투', '물티슈 공구하는곳 있어?', 'card', '물티슈'], ['말투', '물티슈 언제해요?', 'card', '물티슈'],
  ['말투', '물티슈 종류 있어?', 'card', '물티슈'], ['말투', '물티슈 뭐 있엉', 'card', '물티슈'],
  ['말투', '물티슈공구알려줘', 'card', '물티슈'], ['말투', '물티슈말해봐', 'card', '물티슈'],
  // ── 인사·감사·작별 (글이 정답)
  ['인사', '안녕', 'text'], ['인사', '안뇽', 'text'], ['인사', '하이', 'text'], ['인사', '넹', 'text'],
  ['인사', '안녕하세요', 'text'], ['인사', '뭐해', 'text'],
  ['인사', '고마워', 'text'], ['인사', '고마웡', 'text'], ['인사', '고맙습니다', 'text'],
  ['인사', '감사합니다', 'text'], ['인사', '감사행', 'text'], ['인사', '땡큐', 'text'],
  ['인사', '잘가', 'text'], ['인사', '잘가용', 'text'], ['인사', '수고해', 'text'],
  ['인사', '우와 대박', 'text'], ['인사', '최고야', 'text'], ['인사', '똑똑하네', 'text'],
  ['인사', '사랑해', 'text'], ['인사', '맘방사랑해', 'text'], ['인사', '송중기', 'text'],
  ['인사', '핫딜 알려줘', 'text'], ['인사', '도움말', 'text'], ['인사', '사용법', 'text'],
  // ── 없는 것 (글이 정답)
  ['없음', '존재하지않는브랜드zzz', 'text'], ['없음', 'ㅁㄴㅇㄹ', 'text'],
  // 네뷸라이저는 2026-09-01 에 표기를 통일하며 찾을 수 있게 됐다 (표기 변형 6종 포함)
  ['품목', '네뷸라이저', 'card', '네뷸'], ['품목', '네블라이저', 'card', '네뷸'],
  ['품목', '네불라이져', 'card', '네뷸'], ['품목', '메쉬넵', 'card', '네뷸'], ['품목', '휴비딕', 'card', '휴비딕'],
];

const run = async ([grp, say, want, need]) => {
  try {
    const j = await fetch(U, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userRequest: { utterance: say, user: { id: 'BOTPROBE' } } }) }).then((r) => r.json());
    const o = j?.template?.outputs?.[0] || {};
    const got = (o.carousel || o.listCard) ? 'card' : (o.basicCard || o.textCard) ? 'text' : '??';
    const items = o.carousel ? o.carousel.items.flatMap((c) => c.items.map((x) => x.title))
                : o.listCard ? o.listCard.items.map((x) => x.title) : [];
    const head = o.carousel ? o.carousel.items[0].header.title
               : o.listCard ? o.listCard.header.title
               : o.basicCard ? String(o.basicCard.title || '').slice(0, 38)
               : (o.textCard?.text || '').split('\n')[0].slice(0, 38);
    const down = /일시적으로 조회/.test(o.textCard?.text || '');
    const spec = checkSpec(o);   // 📏 카카오 말풍선 규격 (어기면 손님에게 아예 안 나간다)
    // 카드가 나왔는데 기대 낱말이 한 건도 없으면 엉뚱한 답이다
    const off = need && got === 'card' && !items.some((t) => t.replace(/\s/g, '').includes(need));
    return { grp, say, want, got, head, down, off, spec, sample: items.slice(0, 2).join(' / ').slice(0, 46) };
  } catch (e) { return { grp, say, want, got: 'ERR', head: String(e.message || e), down: true }; }
};

const list = CASES.filter((c) => !ONLY || c[0] === ONLY);
const rs = [];
for (const c of list) rs.push(await run(c));

const down = rs.filter((r) => r.down);
const miss = rs.filter((r) => !r.down && r.want !== 'any' && r.got !== r.want);
const offs = rs.filter((r) => !r.down && (r.want === 'any' || r.got === r.want) && r.off);
const bads = rs.filter((r) => r.spec && r.spec.length);
console.log(`총 ${rs.length}건 · 🔴장애 ${down.length} · ⚠기대와다름 ${miss.length} · 🟠엉뚱한답 ${offs.length} · 📏규격위반 ${bads.length}`);
for (const r of bads) console.log(`📏 [${r.grp}] "${r.say}" → ${r.spec.join(' / ')}`);
for (const r of down) console.log(`🔴 장애 [${r.grp}] "${r.say}"`);
for (const r of miss) console.log(`⚠ [${r.grp}] "${r.say}" 기대=${r.want} 실제=${r.got} → ${r.head}`);
for (const r of offs) console.log(`🟠 [${r.grp}] "${r.say}" → ${r.head} · ${r.sample}`);
if (!down.length && !miss.length && !offs.length && !bads.length) console.log('✅ 전건 기대대로');

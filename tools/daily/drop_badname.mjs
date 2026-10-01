/**
 * 🧹 **등록 직전 상품명 위생 검사** — 상품명이 아닌 행을 보류로 뺀다
 *
 * 왜 생겼나 (2026-10-01 검증자 불통과):
 *   사장님 지시로 인스타 채널을 **무인 등록**으로 바꿨는데(ig_feed_pipeline.sh),
 *   게이트(`pending_check.sh`)는 **DB중복·제외셀러·사장님상품·핸들갈림만** 센다 —
 *   **상품명이 상품명인지는 아무도 안 본다.** 그래서 이런 것이 라이브로 나갔다:
 *     「알텐바흐 롯데백화점 최대품목 최대할인 특집전」(행사명)
 *     「엔젤앤비 슈크림 2주년 29cm 입점기념」(행사명)
 *     「아미 빅로고 가디건129000원」(가격이 이름에)
 *     「비트리 9.29」(날짜가 이름에)
 *     「어그 싹 털다 걸린 썰...ㅋㅋㅋㅋㅋ」(문장)
 *   `scratchpad/_q_badname.sql` 이 같은 것을 보지만 **등록 뒤에 보고만** 한다 → 앞으로 옮겼다.
 *
 * 🔑 **새 규칙이 아니다.** 메모리 `product-name-hygiene`(상품명 위생 4종, 사장님 확인)과
 *    `_q_badname.sql` 의 패턴을 그대로 쓴다. 판정 기준을 내가 새로 만들지 않는다.
 * 🔑 **회차를 멈추지 않는다** — 걸린 행만 보류 파일로 빼고 나머지는 등록으로 보낸다
 *    (제외셀러 한 줄이 155행을 막았던 2026-10-01 사고와 같은 모양을 피한다).
 *
 *   node tools/daily/drop_badname.mjs <승인표.md> [보류파일] [--dry]
 * 출력: 걸린 행 수를 stdout 에 `badname: N` 으로 찍는다 (호출처가 읽는다)
 */
import fs from 'node:fs';

const f = process.argv[2];
const hold = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
const DRY = process.argv.includes('--dry');
if (!f || !fs.existsSync(f)) { console.log('badname: -1'); console.error(`없는 파일: ${f}`); process.exit(2); }

// ── 상품명이 아닌 것 (출처: scratchpad/_q_badname.sql + 2026-10-01 라이브 실측)
const BAD = [
  // 문장형 — 종결어미
  [/(하세요|챙기세요|보세요|드세요|해보세요|입니다|이에요|예요|합니다|어때요|드려요|주세요|없어요|있어요|같아요|더라고요|했어요|삽니다|샀어요|먹어요|써요)$/u, '문장형'],
  [/((어|아|해|예|에|세|게|져|와|나|워|려|봐|주|하|이)요|죠|니다|는데|해서|어서|하게|이라면|인데)$/u, '문장형2'],
  // 조사로 끝나 절이 잘린 것 (와·과·랑은 넣지 않는다 — 「감홍사과」·「법랑」이 잡힌다)
  [/(까지|부터|에서|으로|로는|사정으로)$/u, '조사끝'],
  // 상품이 아닌 안내·판촉 문구
  [/(미리보기|공구진행|공구예정|적립|이벤트 참여|프로필 링크|링크는|링크에서|구매 ?링크|순차출고|예고편|준비중|디엠으로|댓글에|써주시면|남겨주시면)/u, '안내문구'],
  // 🔴 2026-10-01 라이브 실측 — 행사·전시·입점 이름이 상품명 칸에 들어왔다
  //   ⚠ `팝업` 을 그냥 넣으면 **「미니 깜찍 팝업북」(진짜 상품)이 죽는다** — 400건 실측에서 6건 오탐.
  //      `팝업스토어` 형태만 본다. 같은 이유로 `기획전` 은 끝에 올 때만(「추석기획전 선물세트」는 살린다).
  [/(특집전|기획전\s*$|할인전\s*$|입점기념|주년\s*기념|오픈기념|페스타|팝업\s*스토어|박람회|플리마켓|백화점)/u, '행사명'],
  // 가격·날짜가 이름에 붙은 것
  [/\d{3,}\s*원\s*$|\d{1,3},\d{3}\s*원/u, '가격붙음'],
  [/(^|\s)\d{1,2}\s*[./]\s*\d{1,2}\s*$/u, '날짜붙음'],
  [/(^|\s)\d{1,2}\s*월\s*\d{1,2}\s*일?\s*$/u, '날짜붙음'],
  // 잔해
  [/#/u, '해시태그잔해'],
  [/^[0-9]{1,4}\s[0-9]/u, '숫자잔해'],
  [/[ㅋㅎㅠㅜ]{2,}|\.\.\./u, '구어체잔해'],
  [/^(자체제작|자체 ?제작|핸드메이드|수제작|주문제작|맞춤제작)/u, '브랜드없음'],
  // 🔴 2026-10-01 라이브 실측 「독일 1위 필수 영양제」 — 고유명사 없이 판촉어만 남은 것.
  //    좁게 잡는다: 나라·순위 자랑이 머리에 오고 상품을 특정하지 못하는 형태만.
  //    (「독일 밀레 청소기」처럼 브랜드가 뒤에 오면 안 걸린다 — 1위·최초·유일이 함께 있어야 한다)
  [/^(국내|국산|독일|미국|일본|유럽|호주|프랑스|이탈리아|스위스)\s*\d*\s*(위|1위|최초|유일|대표)/u, '판촉문구'],
];

const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);

// 🔴🔴 2026-10-01 실측 사고: 상품명 칸을 **고정 번호(cells[2])로 읽었다가 「셀러」 칸을 읽었다.**
//    실제 순서는 `| # | 셀러 | 상품명 | 오픈 | 마감 | 대분류 | 소분류 | 핸들 |` 로 상품명은 3번이다.
//    그래서 검사가 전부 통과하고 「스완핏 전송 '민스' 써주시면 디엠으로」가 라이브로 나갔다.
//    → **헤더를 읽어 칸을 찾는다.** 메모리 `approval-table-header-trap` 이 그대로 적어둔 함정이다.
//    헤더를 못 찾으면 **검사를 통과시키지 않는다**(badname: -1 → 호출처가 등록을 멈춘다).
let NAME_COL = -1;
for (const l of lines) {
  if (!/^\|/.test(l) || !/상품명/.test(l)) continue;
  const cells = l.split('|').map((x) => x.trim());
  NAME_COL = cells.findIndex((c) => c === '상품명' || c === '상품');
  if (NAME_COL > 0) break;
}
if (NAME_COL < 0) {
  console.log('badname: -1');
  console.error(`헤더에서 「상품명」 칸을 못 찾았다: ${f} — 칸 번호를 추측하지 않는다`);
  process.exit(3);
}

const keep = [], dropped = [];
for (const l of lines) {
  // 승인표 행: | 번호 | ... (헤더·구분선·주석은 그대로 둔다)
  if (!/^\|\s*\d+\s*\|/.test(l)) { keep.push(l); continue; }
  const cells = l.split('|').map((x) => x.trim());
  const name = cells[NAME_COL] || '';
  if (!name) { keep.push(l); continue; }
  const hit = BAD.find(([re]) => re.test(name));
  if (hit) dropped.push([hit[1], name, l]);
  else keep.push(l);
}

console.log(`badname: ${dropped.length}`);
for (const [why, name] of dropped.slice(0, 30)) console.log(`   ${why}\t${name}`);
if (dropped.length > 30) console.log(`   … 그 외 ${dropped.length - 30}행`);

if (DRY || !dropped.length) process.exit(0);
fs.writeFileSync(f, keep.join('\n'), 'utf8');
if (hold) {
  const ts = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  fs.appendFileSync(hold, dropped.map(([why, , l]) => `| 상품명아님(${why}) ${ts} ${l.replace(/^\|/, '')}`).join('\n') + '\n', 'utf8');
}

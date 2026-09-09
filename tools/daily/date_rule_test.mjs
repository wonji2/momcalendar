// 날짜 파서 단위시험 — dateFrom 을 고치면 **이걸 먼저 돌린다**.
//   2026-09-09 에 오픈일 오독으로 손님 화면에 잘못된 날짜가 13건 나갔다.
//   사이즈표(110/17) · 배송일(9/15 순차발송) · 규격(10.1인치) · 마감일만 적힌 글 · 다른 상품 예고 날짜.
// 실행: node tools/daily/date_rule_test.mjs   (통과 기준: 8건 전부 ✅)
// 새 오독 유형을 만나면 **여기에 한 줄 추가**하고 고친다.
import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync('tools/daily/ig_feed_to_table.mjs', 'utf8');
const lines = src.split('\n');
const pick = (start, endPred) => {
  const a = lines.findIndex(l => l.startsWith(start)); if (a < 0) throw new Error('못 찾음 ' + start);
  let b = a; while (b < lines.length && !endPred(lines[b])) b++;
  return lines.slice(a, b + 1).join('\n');
};
const head = [
  "const today='2026-09-09';",
  "const ymd=(d)=>d.toISOString().slice(0,10);",
  "const valid=(s)=>{const d=new Date(s+'T00:00:00Z');return !isNaN(d)&&ymd(d)===s;};",
  "const addDays=(s,n)=>{if(!valid(s))return '';const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return ymd(d);};",
  pick('const unfancy =', l => l.trim() === '});'),
  pick('const stripNonDate =', l => l.trim().endsWith("' ');")),
  lines.filter(l => /^const (DATE_RE|TIME_GAP|END_CUE|OPEN_CUE) =/.test(l)).join('\n'),
  pick('const dateFrom =', l => l.trim() === '};'),
  'export { dateFrom, stripNonDate };'
].join('\n');
writeFileSync('scratchpad/_date_probe.mjs', head);
const { dateFrom, stripNonDate } = await import('../../scratchpad/_date_probe.mjs?' + Date.now());
const T = [
  ['배송일', '9/14 (월) 부터 순차출고될 예정 · 공구기간 9/8(화)~10(목) 3일간', '2026-09-08', { open: '2026-09-08', end: '2026-09-10' }],
  ['인치', '10.1인치 디스플레이 · 공구기간 9.7~ 9일까지 진행', '2026-09-07', { open: '2026-09-07', end: '2026-09-09' }],
  ['마감만', 'OPEN 에끌 페이크 반폴라 ~9/14 월요일 23:59까지', '2026-09-07', { open: '2026-09-07', end: '2026-09-14' }],
  ['자정마감+날짜', '공구오픈 디즈니 샤워가운 💟-9.13(일) 자정마감', '2026-09-09', { open: '2026-09-09', end: '2026-09-13' }],
  ['자정마감만', '물디홈 떡갈비 오늘 마감!', '2026-09-06', { open: '2026-09-03', end: '2026-09-06' }],
  ['사이즈표', '이키 상하복 오픈 L : 4~5세 / 110 / 17~20kg', '2026-09-09', { open: '2026-09-09', end: '2026-09-12' }],
  ['정상범위', '공구기간 9/6 (일) ~ 9/9 (수)', '2026-09-06', { open: '2026-09-06', end: '2026-09-09' }],
  ['오픈만', '9월 10일 목요일 오전 10시 OPEN', '2026-09-08', { open: '2026-09-10', end: '2026-09-13' }],
];
let bad = 0;
for (const [name, cap, base, want] of T) {
  const got = dateFrom(cap, base);
  const ok = got.open === want.open && got.end === want.end;
  if (!ok) bad++;
  console.log((ok ? '  ✅ ' : '  🔴 ') + name.padEnd(12) + JSON.stringify(got) + (ok ? '' : '   기대 ' + JSON.stringify(want)));
}
console.log(bad ? '\n🔴 ' + bad + '건 실패' : '\n✅ 8건 전부 통과');

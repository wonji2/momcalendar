// 홈 자동 커밋 가드 (2026-11-18) — 빌드가 index.html·test.html 의 「오늘 공구 목록」 표식 사이만 고쳤는지 확인한다.
//   node tools/seo/home_guard.mjs index.html   → 통과면 0, 아니면 1(자동 커밋이 그 파일을 올리지 않고 되돌린다)
//   보는 것: ① 표식이 정확히 한 쌍 ② 표식 밖은 HEAD 와 바이트까지 같음 ③ 표식 안에는 <div class="seolinks-…">·/gg/ 링크·글자만(스크립트·바깥 주소·이벤트 속성 없음)
//   흐름: seo-daily.yml 「변경 사항 커밋」 단계가 git reset 으로 홈을 내린 뒤 이 검사를 통과한 파일만 다시 add 한다. 상태 파일 없음.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const M1 = '<!--seo-today-->', M2 = '<!--/seo-today-->';
const fail = (m) => { console.error(`home_guard ${file}: ${m}`); process.exit(1); };
if (!file) fail('파일 이름이 없다');
const cut = (t, who) => {
  const a = t.indexOf(M1), b = t.indexOf(M2);
  if (a < 0 || b < a || t.indexOf(M1, a + 1) >= 0 || t.indexOf(M2, b + 1) >= 0) fail(`${who} 에 표식이 한 쌍이 아니다`);
  return { out: t.slice(0, a + M1.length) + t.slice(b), inner: t.slice(a + M1.length, b) };
};
// 윈도우 체크아웃은 CRLF, git show 는 LF 로 준다 — 줄바꿈 꼴은 비교에서 뺀다(깃허브 실행기에서는 둘 다 LF)
const lf = (s) => s.split('\r').join('');
const now = cut(lf(readFileSync(file, 'utf8')), '작업본');
const head = cut(lf(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })), 'HEAD');
if (now.out !== head.out) fail('표식 밖이 바뀌었다 — 자동 커밋하지 않는다');
// 2026-11-20: 핫딜 TOP 5·브랜드 세일 요약이 붙으면서 루트 페이지 링크 두 개(핫딜정보·세일정보)만 더 받는다 — 루트 .html 전체를 열지 않는다
const ROOT_OK = ['핫딜정보', '세일정보'].map((s) => `<a href="/${encodeURIComponent(s)}.html">`);
if (now.inner.includes('\u0000')) fail('표식 안에 NUL 글자가 있다');
let rest = now.inner
  .replace(/<div class="seolinks-(t|row|q)">/g, '').replace(/<\/div>/g, '')
  .replace(/<a href="\/(gg|g)\/[A-Za-z0-9%._~-]+\.html">[^<>]*<\/a>/g, '');
for (const a of ROOT_OK) rest = rest.split(a).join('\u0000').replace(/\u0000[^<>\u0000]*<\/a>/g, '');
if (rest.includes('\u0000')) fail('핫딜정보·세일정보 링크가 닫히지 않았다');
if (/[<>]/.test(rest)) fail('표식 안에 허용하지 않는 태그가 있다: ' + rest.trim().slice(0, 120));
if (now.inner.length > 400000) fail('표식 안이 너무 크다');
console.log(`home_guard ${file}: 통과 (표식 안 ${now.inner.length}자)`);

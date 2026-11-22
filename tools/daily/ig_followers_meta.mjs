// 인스타 계정 → 팔로워 수 (사장님 2026-09-09). 로그인·브라우저 없이 크롤러 UA 로 og 메타만 읽는다.
//   ⚠ node fetch 로는 빈 껍데기가 온다. 반드시 curl + facebookexternalhit/1.1 이어야 "5,537 Followers, …" 가 온다.
//   실행: node tools/daily/ig_followers_meta.mjs <handles.json> → scratchpad/ig_followers.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const OUT = path.join(ROOT, 'scratchpad', 'ig_followers.json');
const handles = JSON.parse(readFileSync(process.argv[2], 'utf8')).map((x) => (typeof x === 'string' ? x : x.handle));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const dec = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"');
// "15K" "1.2만" 처럼 줄여 쓴 값도 받는다 (정확한 수는 og 에 안 온다 — 근사값으로 저장)
const num = (s) => {
  const t = String(s).replace(/,/g, '').trim();
  let m = t.match(/^([\d.]+)\s*만$/); if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = t.match(/^([\d.]+)\s*천$/); if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = t.match(/^([\d.]+)\s*[Kk]$/); if (m) return Math.round(parseFloat(m[1]) * 1000);
  m = t.match(/^([\d.]+)\s*[Mm]$/); if (m) return Math.round(parseFloat(m[1]) * 1000000);
  return Number(t);
};
const out = [];
for (const [i, h] of handles.entries()) {
  let row = { handle: h };
  try {
    const html = execFileSync('curl', ['-s', '--max-time', '25', '-A', 'facebookexternalhit/1.1', '-H', 'accept-language: ko-KR,ko;q=0.9', `https://www.instagram.com/${h}/`], { encoding: 'utf8', maxBuffer: 20e6 });
    const d = dec((html.match(/property="og:description" content="([^"]*)"/) || [])[1] || '');
    const t = dec((html.match(/property="og:title" content="([^"]*)"/) || [])[1] || '');
    // 응답 언어가 그때그때 바뀐다 — 영어("5,537 Followers")·한국어("팔로워 5,537명") 둘 다 받는다
    let m = d.match(/([\d,]+)\s*Followers,\s*([\d,]+)\s*Following,\s*([\d,]+)\s*Posts/i);
    if (!m) m = d.match(/팔로워\s*([\d,.]+[KMkm만천]?)명?[,\s]*팔로잉\s*([\d,.]+[KMkm만천]?)명?[,\s]*게시물\s*([\d,.]+[KMkm만천]?)/);
    if (!m) m = d.match(/([\d,.]+[KMkm만천]?)\s*Followers,\s*([\d,.]+[KMkm만천]?)\s*Following,\s*([\d,.]+[KMkm만천]?)\s*Posts/i);
    if (m) row = { handle: h, followers: num(m[1]), following: num(m[2]), posts: num(m[3]), title: t.split('(')[0].trim().slice(0, 50) };
    else row = { handle: h, err: html.length < 2000 ? '빈 응답' : '메타 없음', head: d.slice(0, 60) };
  } catch (e) { row = { handle: h, err: String(e.message).slice(0, 60) }; }
  out.push(row);
  console.log(`${i + 1}/${handles.length} ${h} → ${row.followers ?? row.err}`);
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  sleep(4000);
}
console.log(`끝 — 성공 ${out.filter((x) => x.followers != null).length}/${handles.length}`);

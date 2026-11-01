// 인스타 계정 목록 → 팔로워 수 읽기 (사장님 2026-09-09 "계정있는사람 다 열어서 팔로워 채워")
//   로그인된 크롬 프로필(C:\Users\FAMILY\ig-profile)로 프로필 페이지를 하나씩 열어
//   화면의 "팔로워 N" 또는 og:description 에서 숫자를 뽑는다. 프로필 API 는 429 라 안 쓴다.
//   ⚠ 계정 보호: 한 건마다 5~9초 쉬고, 실패해도 다음으로 넘어간다. 429/체크포인트가 뜨면 그 자리에서 멈춘다.
// 실행: node tools/daily/ig_followers.mjs <handles.json>   (["gold__ce", ...] 또는 [{handle,name}])
//   결과: scratchpad/ig_followers.json  [{handle, followers, name, err}]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const PROFILE = 'C:\\Users\\FAMILY\\ig-profile';
const OUT = path.join(ROOT, 'scratchpad', 'ig_followers.json');
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const list = input.map((x) => (typeof x === 'string' ? { handle: x } : x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "1.2만" "12.3k" "1,234" → 숫자 */
function toNum(s) {
  if (!s) return null;
  const t = String(s).replace(/\s/g, '');
  let m = t.match(/([\d.,]+)\s*만/); if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 10000);
  m = t.match(/([\d.,]+)\s*천/); if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1000);
  m = t.match(/([\d.,]+)\s*[kK]/); if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1000);
  m = t.match(/([\d.,]+)\s*[mM]/); if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1000000);
  m = t.match(/([\d,]+)/); return m ? Number(m[1].replace(/,/g, '')) : null;
}

const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false, viewport: { width: 1200, height: 900 }, locale: 'ko-KR' });
const page = await ctx.newPage();
const out = [];
let blocked = false;
for (const [i, it] of list.entries()) {
  if (blocked) { out.push({ ...it, err: '중단(차단 감지)' }); continue; }
  try {
    await page.goto(`https://www.instagram.com/${it.handle}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);
    const r = await page.evaluate(() => {
      const og = (document.querySelector('meta[property="og:description"]') || {}).content || '';
      const txt = document.body.innerText.slice(0, 3000);
      const a = [...document.querySelectorAll('a[href$="/followers/"], a[href*="followers"]')].map((e) => e.innerText).join(' | ');
      const title = (document.querySelector('meta[property="og:title"]') || {}).content || '';
      const notFound = /페이지를 사용할 수 없습니다|Sorry, this page/.test(txt);
      const wall = /로그인|Log in|challenge|잠시 후 다시 시도/.test(txt) && !/팔로워|followers/i.test(txt + og);
      return { og, a, title, notFound, wall, head: txt.replace(/\s+/g, ' ').slice(0, 200) };
    });
    if (r.notFound) { out.push({ ...it, err: '계정 없음' }); }
    else if (r.wall) { out.push({ ...it, err: '로그인/차단 화면' }); blocked = true; }
    else {
      let n = null;
      let m = r.og.match(/([\d.,]+[만천kKmM]?)\s*(?:Followers|팔로워)/i) || r.og.match(/(?:팔로워|Followers)\s*([\d.,]+[만천kKmM]?)/i);
      if (m) n = toNum(m[1]);
      if (n === null && r.a) { const am = r.a.match(/([\d.,]+[만천kKmM]?)/); if (am) n = toNum(am[1]); }
      out.push({ ...it, followers: n, title: r.title.slice(0, 60), raw: r.og.slice(0, 90) });
    }
  } catch (e) { out.push({ ...it, err: String(e.message).slice(0, 60) }); }
  console.log(`${i + 1}/${list.length} ${it.handle} → ${JSON.stringify(out[out.length - 1].followers ?? out[out.length - 1].err)}`);
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  await sleep(5000 + Math.floor(Math.random() * 4000));
}
await ctx.close();
console.log(`끝 — 성공 ${out.filter((x) => x.followers != null).length} / ${list.length} → ${OUT}`);

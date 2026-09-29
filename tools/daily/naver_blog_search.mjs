/**
 * 📝 네이버 블로그 검색 — **MCP 없이** 돌아가는 대체 경로 (2026-09-28 신설)
 *
 * 왜 만들었나: 파싱 채널 8번(네이버 블로그)은 PlayMCP 의 `NaverSearch-search_blog` 를 쓰는데
 *   2026-09-28 그 서비스가 죽었다(서버는 connected 인데 네이버 계열 호출만 전부 거부 · 카카오맵은 정상).
 *   채널 하나가 MCP 하나에 매달려 있으면 그게 죽는 순간 채널도 죽는다 → **직접 치는 길**을 만들어 둔다.
 *
 * 흐름
 *   ① m.search.naver.com 모바일 블로그 검색(최근 1주) → 블로그 글 주소 수집
 *   ② 각 글 본문(m.blog.naver.com)에서 **인스타 핸들·인포크 슬러그**를 뽑는다
 *      → 블로그형 셀러가 달력을 통째로 올리므로 **신규 셀러 발굴**에 좋다(플레이북 채널 8)
 *   ③ DB 에 없는 셀러만 수확 대상으로 남긴다
 *
 *   node tools/daily/naver_blog_search.mjs [검색어...]
 *   기본 검색어는 이번 달·다음 달로 자동 생성된다(달이 바뀌어도 손댈 필요 없다).
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..');
const OUT = path.join(REPO, 'scratchpad', '_blog_sellers.txt');
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const kst = new Date(Date.now() + 9 * 3600e3);
const m1 = kst.getUTCMonth() + 1;
const m2 = m1 === 12 ? 1 : m1 + 1;
const queries = process.argv.slice(2).length ? process.argv.slice(2)
  : [`${m2}월 공구일정`, `${m2}월 공동구매 일정`, `${m1}월 공구일정`];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① 검색 → 글 주소
const posts = new Set();
for (const q of queries) {
  const u = `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(q)}&nso=so:dd,p:1w`;
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA_M } });
    const h = await r.text();
    for (const m of h.matchAll(/blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{9,})/g)) posts.add(m[1] + '/' + m[2]);
    console.log(`"${q}" → 누적 글 ${posts.size}개 (HTTP ${r.status})`);
  } catch (e) { console.log(`"${q}" 실패: ${e.message}`); }
  await sleep(1500);
}

// ② 본문에서 셀러 단서
const handles = new Map();   // insta → 근거 글
const slugs = new Map();     // 인포크 슬러그 → 근거 글
let read = 0;
for (const p of [...posts].slice(0, 40)) {
  try {
    const r = await fetch(`https://m.blog.naver.com/${p}`, { headers: { 'user-agent': UA_M } });
    if (!r.ok) continue;
    const h = await r.text();
    read++;
    for (const m of h.matchAll(/instagram\.com\/([A-Za-z0-9._]{3,30})/g)) {
      const v = m[1].toLowerCase();
      if (!/^(p|reel|reels|explore|stories|accounts)$/.test(v) && !handles.has(v)) handles.set(v, p);
    }
    for (const m of h.matchAll(/(?:link\.inpock\.co\.kr|inpk\.link)\/([A-Za-z0-9._@-]{2,40})/g)) {
      if (!slugs.has(m[1])) slugs.set(m[1], p);
    }
  } catch {}
  await sleep(700);
}
console.log(`본문 ${read}개 읽음 · 인스타 핸들 ${handles.size} · 인포크 슬러그 ${slugs.size}`);

// ③ DB 에 없는 셀러만
const q = async (pth) => {
  const r = await fetch(`${SB}/rest/v1/${pth}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? r.json() : [];
};
const fresh = [];
for (const [h, src] of handles) {
  const have = await q(`gonggu?select=id&insta=eq.${encodeURIComponent(h)}&limit=1`);
  if (!have.length) fresh.push({ h, src });
  await sleep(120);
}
fs.writeFileSync(OUT, fresh.map((x) => x.h).join('\n') + '\n', 'utf8');
console.log(`\n🆕 DB 에 없는 셀러 후보 ${fresh.length}명 → ${OUT}`);
fresh.slice(0, 20).forEach((x) => console.log(`  ${x.h.padEnd(24)} ← blog.naver.com/${x.src}`));
if (slugs.size) {
  console.log('\n본문에서 나온 인포크 슬러그:');
  [...slugs.entries()].slice(0, 15).forEach(([s, src]) => console.log(`  ${s.padEnd(24)} ← ${src}`));
}

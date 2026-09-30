/**
 * 📝 네이버 블로그 검색 — **MCP 없이** 돌아가는 대체 경로 (2026-09-28 신설)
 *
 * 왜 만들었나: 파싱 채널 8번(네이버 블로그)은 PlayMCP 의 `NaverSearch-search_blog` 를 쓰는데
 *   2026-09-28 그 서비스가 죽었다(서버는 connected 인데 네이버 계열 호출만 전부 거부 · 카카오맵은 정상).
 *   채널 하나가 MCP 하나에 매달려 있으면 그게 죽는 순간 채널도 죽는다 → **직접 치는 길**을 만들어 둔다.
 *
 * 흐름
 *   ① m.search.naver.com 모바일 블로그 검색 → 블로그 글 주소 수집
 *   ② 각 글 본문(m.blog.naver.com)에서 **인스타 핸들·인포크 슬러그**를 뽑는다
 *      → 블로그형 셀러가 달력을 통째로 올리므로 **신규 셀러 발굴**에 좋다(플레이북 채널 8)
 *   ③ DB·기존 명단에 없는 셀러만 수확 대상으로 남긴다 (핸들 → _blog_sellers.txt · 슬러그 → _blog_slugs.txt)
 *
 *   node tools/daily/naver_blog_search.mjs [검색어...]
 *   기본 검색어는 이번 달·다음 달로 자동 생성된다(달이 바뀌어도 손댈 필요 없다).
 *
 * 🔴 2026-09-30 실측 — 이 채널은 신설(09-28) 이후 사흘간 **수확 0** 이었다. 원인 두 겹:
 *   ① **검색어에 "공구" 를 단독으로 썼다.** 네이버는 그걸 工具·단지번호로 읽는다
 *      (메모리 seo-keyword-facts 에 이미 적혀 있던 함정). `10월 공구일정` 결과는
 *      아기 이름 짓기·새만금 박람회·"8공구수학" 학원 스케줄이었고 인스타 링크가 0개였다.
 *      → **검색어에 항상 "인스타"를 동반시킨다.** 실측(본문 14~19개):
 *         `10월 공구일정`      → 핸들 0 · 슬러그 0   (옛 검색어, 정렬 무관 무력)
 *         `10월 공동구매 일정`  → 핸들 0 · 슬러그 0   (옛 검색어)
 *         `인스타 공구 일정`    → 핸들 6(신규 4) · 슬러그 2  ← 최고
 *         `공구예고 인스타`     → 핸들 5(신규 1)
 *         `10월 공구 달력`     → 슬러그 1(신규 1)
 *   ② **정렬이 `so:dd,p:1w`(최신 1주)였다.** 공구 글은 최신순 상위에 안 온다.
 *      관련도순(`so:r`)으로 바꾸니 같은 검색어가 셀러 글을 준다. 창은 1개월과 무제한을 둘 다 돈다
 *      (무제한 쪽이 수확 4배 — 옛 글이어도 **셀러 발굴**엔 유효하다. 일정 자체는 작업원칙 8 대로
 *       그 셀러 인포크·피드에서 직접 확인하므로 옛 달력이 그대로 등록되는 길은 없다).
 *   🔑 0건이 나오면 "일정 없음"이 아니라 **내 도구·검색어를 먼저 의심한다**(규칙 0-P, 누적 11번째).
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..');
const OUT = path.join(REPO, 'scratchpad', '_blog_sellers.txt');
const OUT_SLUG = path.join(REPO, 'scratchpad', '_blog_slugs.txt');   // 인포크 수확기가 먹는 명단
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const kst = new Date(Date.now() + 9 * 3600e3);
const m1 = kst.getUTCMonth() + 1;
const m2 = m1 === 12 ? 1 : m1 + 1;
// 🔴 "공구" 를 단독으로 쓰지 말 것 — 위 헤더의 2026-09-30 실측 참조. 항상 "인스타"를 동반시킨다.
const queries = process.argv.slice(2).length ? process.argv.slice(2)
  : ['인스타 공구 일정', '공구예고 인스타', `인스타 ${m2}월 공구 달력`, `인스타 ${m1}월 공구 달력`, '인스타 공동구매 일정'];
// 관련도순만 쓴다(최신순은 공구 글을 상위에 안 올린다). 창은 1개월·무제한 둘 다.
const SORTS = ['&nso=so:r,p:1m', ''];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ① 검색 → 글 주소
const posts = new Set();
for (const q of queries) {
  for (const nso of SORTS) {
    const u = `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(q)}${nso}`;
    try {
      const r = await fetch(u, { headers: { 'user-agent': UA_M } });
      const h = await r.text();
      let n = 0;
      for (const m of h.matchAll(/blog\.naver\.com\/([A-Za-z0-9_-]+)\/(\d{9,})/g)) { if (!posts.has(m[1] + '/' + m[2])) n++; posts.add(m[1] + '/' + m[2]); }
      console.log(`"${q}"${nso ? ' 1개월' : ' 전체'} → 새 글 ${n} (누적 ${posts.size}, HTTP ${r.status})`);
    } catch (e) { console.log(`"${q}" 실패: ${e.message}`); }
    await sleep(1200);
  }
}

// ② 본문에서 셀러 단서
const handles = new Map();   // insta → 근거 글
const slugs = new Map();     // 인포크 슬러그 → 근거 글
let read = 0;
for (const p of [...posts].slice(0, 70)) {
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
// 우리 것·집계계정은 후보가 아니다 (2026-09-30: 슬러그 momcal = 맘캘린더 자신이 잡혔다)
const OURS = new Set(['momcal', 'momcal_', 'momcalendar', 'wantsbe', 'gonggu_jupjup', 'we09.lab', 'we09lab', 'inpock', 'inpocklink']);
// 이미 명단에 있는 슬러그·핸들은 새 것이 아니다. seller_inpock 은 anon 으로 못 읽는다
// (2026-09-28 보안 잠금 · 메모리 supabase-security-baseline) → 레포 안 명단 파일로 대조한다.
const known = new Set();
for (const f of fs.readdirSync(path.join(REPO, 'scratchpad'))) {
  if (!/^_inpock_(todo|seen)|^_blog_slugs\.txt$|^_blog_sellers\.txt$/.test(f)) continue;
  try {
    for (const l of fs.readFileSync(path.join(REPO, 'scratchpad', f), 'utf8').split('\n')) {
      const v = l.trim().toLowerCase(); if (v) known.add(v);
    }
  } catch {}
}
console.log(`기존 명단 ${known.size}개와 대조 (인포크 todo/seen + 지난 회차 산출물)`);

const fresh = [];
for (const [h, src] of handles) {
  if (OURS.has(h) || known.has(h)) continue;
  const have = await q(`gonggu?select=id&insta=eq.${encodeURIComponent(h)}&limit=1`);
  if (!have.length) fresh.push({ h, src });
  await sleep(120);
}
const freshSlugs = [];
for (const [s, src] of slugs) {
  const v = s.toLowerCase();
  if (OURS.has(v) || known.has(v)) continue;
  // 슬러그가 그대로 핸들인 셀러도 많다 → DB 에 그 핸들이 있으면 새 셀러가 아니다
  const have = await q(`gonggu?select=id&insta=eq.${encodeURIComponent(v)}&limit=1`);
  if (!have.length) freshSlugs.push({ s: v, src });
  await sleep(120);
}
// append 로 쌓는다(덮으면 지난 회차 명단이 사라진다 — 메모리 tool-first-arg-is-output 과 같은 뿌리)
if (fresh.length) fs.appendFileSync(OUT, fresh.map((x) => x.h).join('\n') + '\n', 'utf8');
if (freshSlugs.length) fs.appendFileSync(OUT_SLUG, freshSlugs.map((x) => x.s).join('\n') + '\n', 'utf8');
console.log(`\n🆕 새 셀러 핸들 ${fresh.length}명 → ${OUT}`);
fresh.slice(0, 20).forEach((x) => console.log(`  ${x.h.padEnd(24)} ← blog.naver.com/${x.src}`));
console.log(`🆕 새 인포크 슬러그 ${freshSlugs.length}개 → ${OUT_SLUG} (인포크 수확기가 다음 회차에 먹는다)`);
freshSlugs.slice(0, 20).forEach((x) => console.log(`  ${x.s.padEnd(24)} ← blog.naver.com/${x.src}`));
if (!fresh.length && !freshSlugs.length) {
  console.log('\n⚠ 수확 0 — "일정 없음"이 아니다. 검색 HTML 구조·검색어를 먼저 의심할 것 (규칙 0-P, 헤더 주석의 2026-09-30 실측 참조)');
}

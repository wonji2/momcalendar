// 이웃셀러 배너 자동 갱신 — 사장님 지시 2026-08-20
//
// > "니가 인포크링크에 매일 들어가서 그날그날 새로 올라온 상품 있으면 갈아끼우고
// >  하루에 매일 오전 11시에 한번씩 확인해서 배너 업데이트 자동으로 되게 해봐
// >  상품명은 셀러가 인포크링크에 써놓은거 그대로 쓰면 되고 상품명 - 셀러명 이렇게 제목에"
//
// 흐름
//   ① 지금 노출중인 이웃셀러를 읽는다 (is_partner AND active — active 를 빼면 인원을 잘못 센다)
//   ② 각자 인포크에서 **맨 위 상품 블록**을 고른다 (셀러가 위에 올린 게 지금 미는 상품)
//   ③ 대표사진이 실제로 뜨는지 확인한다 (죽은 주소면 빈 배너가 된다)
//   ④ 지금 배너와 같으면 **손대지 않는다**. 바뀐 게 있을 때만 갈아끼운다.
//
// 🔑 상품 페이지에 들어갈 필요가 없다 — 인포크 블록이 대표사진을 이미 들고 있다(block.image).
// 🔑 링크는 **인포크로** 보낸다(사장님 지시). 인스타를 거치지 않는다.
// 🔑 DB 접근은 Supabase CLI 로 한다 — service_role 키를 파일·환경변수에 두지 않기 위해서다.
//
//   node tools/daily/seller_banner.mjs          실제 반영
//   node tools/daily/seller_banner.mjs --dry    미리보기만
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DRY = process.argv.includes('--dry');
// 셀러당 배너 상한 (사장님 지시 2026-08-20) — 한 셀러가 배너존을 독차지하지 않게
const PER_SELLER = 2;
const TMP = (process.env.TEMP || process.env.TMP || '/tmp').replace(/\\/g, '/');

const SB = [
  `${process.env.USERPROFILE}/supabase-cli/supabase.exe`,
  `${process.env.HOME}/supabase-cli/supabase.exe`,
  'supabase',
].find((p) => p === 'supabase' || existsSync(p));

const REPO = [
  `${process.env.USERPROFILE}/Desktop/MOMCALENDAR`,
  `${process.env.USERPROFILE}/MOMCALENDAR`,
].find((p) => existsSync(p)) || process.cwd();

function sql(text, wantJson = true) {
  const f = `${TMP}/_sb_${Date.now()}.sql`;
  writeFileSync(f, text, 'utf8');
  const args = ['db', 'query', '--linked', '-f', f];
  if (wantJson) args.push('--output', 'json');
  const out = execFileSync(SB, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!wantJson) return out;
  const m = out.match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// 상품이 아닌 블록 — 걸면 손님이 A/S·채널 페이지로 간다
// ⚠ 실측으로 걸린 것: "힝버미네 youtube" · "이벤트 당첨되신분들 여기로🙋🏻‍♀️" (2026-08-20)
//   셀러 인포크 맨 위엔 상품이 아니라 이벤트·공지가 올라와 있는 날이 많다.
const NOT_PRODUCT = /(CS|C\s*\/\s*S|고객\s*센터|문의|바로가기|리뷰\s*이벤트|리뷰폼|네이버톡톡|카카오|인스타|블로그|유튜브|공지|안내|채널|youtube|instagram|blog|naver|kakao|link|당첨|이벤트|응모|참여|신청|추첨|여기로|폼\s*작성|후기|체험단|모집)/i;
// ⚠ "힝버미네 youtube" 가 상품으로 잡혔다(2026-08-20). 한글 품목명 + 두 낱말 이상을 요구한다.
const looksLikeProduct = (n) =>
  n.length >= 4 && n.length <= 44 && /[가-힣]{2}/.test(n) && n.split(/\s+/).length >= 2;

const clean = (s) => String(s)
  .replace(/\[[^\]]*\]\s*/g, '')          // "[키도러블x이현맘] " 같은 앞머리
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim();

async function fetchBlocks(slug) {
  for (const base of ['https://link.inpock.co.kr', 'https://inpk.link']) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 15000);
      const r = await fetch(base + '/' + slug, { headers: { 'user-agent': UA }, signal: c.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const h = await r.text();
      if (h.length < 8000) continue;
      const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const pp = JSON.parse(m[1])?.props?.pageProps;
      if (pp?.blocks?.length) return { base, blocks: pp.blocks };
    } catch (e) { /* 다음 도메인 */ }
  }
  return null;
}

// 🔴 인포크 이미지 주소는 두 가지다 (2026-08-20 실측)
//    ① 절대주소 — 셀러가 쇼핑몰 사진을 그대로 쓴 경우 (이현맘: ecimg.cafe24img.com/...)
//    ② 상대경로 — 인포크에 올린 사진 (크레용맘: "images/2026/8/19/xxx.webp")
//   ②를 그대로 fetch 하면 "Failed to parse URL" 로 터져 **상품이 하나도 없다고 오판**했다.
//   CDN 은 d13k46lqgoj3d6.cloudfront.net 이고 경로에서 앞의 `images/` 를 뺀다.
//     images/2026/8/19/a.webp → https://d13k46lqgoj3d6.cloudfront.net/2026/8/19/a.webp  (200 확인)
const INPOCK_CDN = 'https://d13k46lqgoj3d6.cloudfront.net';
function absImage(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  return INPOCK_CDN + '/' + s.replace(/^images\//, '').replace(/^\/+/, '');
}

async function imageOk(u) {
  // 🔴 2026-08-24 사고: 셀러가 블록 사진을 안 올리면 인포크가 **네이버 로그인 애플 아이콘 SVG**
  //    (ssl.pstatic.net/static/nid/login/icon-apple.svg)를 넣어 준다. 200 image/* 라 통과해서
  //    라이브 배너에 아이콘이 걸렸다(로이첸). 아이콘·SVG·초소형 이미지는 상품 사진이 아니다.
  if (/\.svg(\?|$)|\/static\/nid\/|icon-|favicon|\/logo/i.test(u)) return false;
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(u, { headers: { 'user-agent': UA }, signal: c.signal });
    clearTimeout(t);
    const ct = String(r.headers.get('content-type') || '');
    const len = Number(r.headers.get('content-length') || 0);
    if (!r.ok || !ct.startsWith('image/') || ct.includes('svg')) return false;
    if (len > 0 && len < 5000) return false;   // 5KB 미만 = 아이콘/플레이스홀더
    return true;
  } catch (e) { return false; }
}

// ── ① 이웃셀러 ─────────────────────────────────────────────
// 🔴 계약기간 필터 필수 (2026-09-01 사고 예방): 젤리또리 계약이 8/28 에 끝났는데
//    is_partner·active 플래그만 보고 제안에 2건이 들어갔다. 기간 지난 셀러는 배너 후보에서 뺀다.
const sellers = sql(`select id, name, insta, coalesce(inpock_slug,'') as slug
                     from public.sellers where is_partner and active
                       and (start_date is null or start_date <= (now() at time zone 'Asia/Seoul')::date)
                       and (end_date   is null or end_date   >= (now() at time zone 'Asia/Seoul')::date)
                     order by id;`);
console.log(`이웃셀러 ${sellers.length}명 (계약기간 내)`);

const cur = sql(`select title, link, img_url from public.banners
                 where type='seller' and active order by sort_order;`);
const curKey = cur.map((b) => `${b.title}|${b.link}|${b.img_url}`).join('\n');

const wanted = [];
for (const s of sellers) {
  const slug = s.slug || s.insta;
  const got = await fetchBlocks(slug);
  if (!got) { console.log(`⛔ ${s.name} — 인포크 없음 (${slug})`); continue; }

  // 🔴 셀러당 최대 2개 (사장님 지시 2026-08-20)
  //   한 셀러가 배너존을 독차지하면 다른 이웃셀러가 묻힌다.
  //   인포크 **위에서부터** 고른다 — 셀러가 위에 올린 게 지금 미는 상품이다.
  const picked = [];
  for (const b of got.blocks) {
    if (picked.length >= PER_SELLER) break;
    if (b.block_type !== 'link' || !b.image || !b.title) continue;
    const name = clean(b.title);
    if (!name || NOT_PRODUCT.test(name) || !looksLikeProduct(name)) continue;
    let img = absImage(b.image);
    if (!img || !(await imageOk(img))) {
      // 블록 사진이 없거나 아이콘이면(로이첸 사고) **블록이 가리키는 상품 페이지의 og:image** 로 폴백
      img = null;
      if (b.url) {
        try {
          const target = b.url.startsWith('http') ? b.url : 'https://link.inpock.co.kr' + b.url;
          const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000);
          const r = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'follow', signal: c.signal });
          clearTimeout(t);
          const html = await r.text();
          const m = html.match(/og:image"[^>]*content="([^"]+)"/) || html.match(/content="([^"]+)"[^>]*property="og:image"/);
          if (m && (await imageOk(m[1]))) img = m[1];
        } catch (e) { /* 폴백 실패 시 이 블록은 건너뛴다 */ }
      }
      if (!img) continue;
    }
    picked.push({ name, img });
  }
  if (!picked.length) { console.log(`⛔ ${s.name} — 걸 상품 없음`); continue; }

  // 제목 형식은 사장님 지정: "상품명 - 셀러명". 두 줄까지 보이므로 40자로 자른다.
  picked.forEach((p) => {
    wanted.push({
      title: `${p.name} - ${s.name}`.slice(0, 40),
      link: `${got.base}/${slug}`,
      img_url: p.img,
      seller: s.name,
    });
    console.log(`✅ ${s.name} → ${p.name.slice(0, 30)}`);
  });
  await new Promise((r) => setTimeout(r, 2000));
}

if (!wanted.length) {
  console.log('걸 배너가 없다 — 기존 배너를 그대로 둔다');
  process.exit(0);
}

const newKey = wanted.map((b) => `${b.title}|${b.link}|${b.img_url}`).join('\n');
if (newKey === curKey) { console.log('\n바뀐 게 없다 — 손대지 않는다'); process.exit(0); }

console.log(`\n제안: ${cur.length}건 → ${wanted.length}건`);
wanted.forEach((w) => console.log('  ' + w.title));

// 🔴 사장님 지시 2026-08-20 — **라이브에 자동으로 넣지 않는다.**
//   > "배너 바꿀때마다 나한테 그날 아침 승인받아봐
//   >  일단은 안정될때까지 라이브에 이상한거 올려놓으면 안되니까"
//
//   실제로 「시골촌놈 프롬프트」·「힝버미네 youtube」·「이벤트 당첨되신분들 여기로」가
//   상품으로 잡힌 적이 있다. 필터를 계속 보강하고 있지만 셀러가 뭘 올릴지는 알 수 없다.
//   → 제안만 파일로 남기고, 사장님이 보고 승인하면 그때 넣는다.
//
//   승인 뒤 반영:  node tools/daily/seller_banner.mjs --apply
const OUT = `${REPO}/scratchpad/_banner_proposal.json`;
const APPLY = process.argv.includes('--apply');

if (!APPLY) {
  const payload = { made_at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '), banners: wanted };
  writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n⏸ 승인 대기 — 라이브에 넣지 않았다.`);
  console.log(`   제안 파일: scratchpad/_banner_proposal.json`);
  console.log(`   승인되면: node tools/daily/seller_banner.mjs --apply`);
  process.exit(0);
}

// --apply : 저장해 둔 제안을 그대로 넣는다 (사장님이 본 것과 같은 내용이어야 하므로 파일을 쓴다)
let approved = wanted;
try {
  const saved = JSON.parse(readFileSync(OUT, 'utf8'));
  if (saved?.banners?.length) approved = saved.banners;
  console.log(`저장된 제안(${saved.made_at})으로 반영한다`);
} catch (e) { console.log('제안 파일이 없어 방금 뽑은 것으로 반영한다'); }

sql(`update public.banners set active=false where type='seller';
insert into public.banners (type,title,link,img_url,img_size,img_position,sort_order,active)
values
${approved.map((w, i) => `  ('seller', ${q(w.title)}, ${q(w.link)}, ${q(w.img_url)}, 'cover', 'center', ${i + 1}, true)`).join(',\n')};`, false);
console.log(`반영 완료 (${approved.length}건)`);

// 이웃셀러 배너 자동 연동 — 서버판 (사장님 2026-11-19)
//   > "이웃셀러들 인스타 피드 들어가고 인포크링크 같은 거 꼭 들어가서 걔가 오늘 공동구매하고 있고
//   >  인포크링크에 결제창 열려있는 거 네가 자동으로 가져와서 정말 배너 연동을 잘 바꿔줘야 돼, 계속."
//   > (결제 완료 팝업) "배너를 따로 설정하지 않으면 등록된 일정 기준으로 거기에 등록된 결제 링크로 배너가 할당"
//
// 흐름 (셀러마다, 이웃셀러 노출 중 · 셀러가 「내 배너」를 직접 꾸미지 않은 셀러만 — banners.seller_id 행이 있으면 건드리지 않는다)
//   ① gonggu: 이 셀러(insta)의 오늘 진행 중 공구 중 결제 링크(pay_link)가 있는 것 — 오늘 오픈한 것 먼저, 그다음 최근 오픈
//      (인스타 피드 글은 PC 의 ig_feed_pipeline·인포크 수확기가 gonggu 로 넣는다 → 여기선 표만 읽는다)
//   ② 인포크 실시간: 슬러그(seller_inpock 표 → sellers.inpock_slug → 인스타 아이디, 규칙 0-I)의 블록 중
//      오늘이 기간 안에 드는 달력 항목·링크 블록(결제 주소가 있는 것) → 없으면 맨 위 상품 링크 블록
//   ③ 고른 결제 주소를 실제로 연다: 200 · 품절/판매종료 문구 없음 · 사진(og:image 또는 블록 사진) → 저장소 banners/seller/auto<id>_… 에 복사
//   ④ 지금 배너와 링크가 같으면 손대지 않는다. 다르면 이 셀러의 옛 자동 배너를 내리고 새 배너 한 장(1구좌)을 건다.
//   ⑤ 아무것도 못 고르면 지금 배너를 그대로 둔다(빈 자리·엉뚱한 블록으로 바꾸지 않는다). 6시간 넘게 걸 게 없으면 health_alerts.
//   이웃셀러가 끝난 셀러의 자동 배너는 내린다.
//
// 호출  POST /functions/v1/seller-banner-auto   헤더 x-cron-secret (PUSH_CRON_SECRET)
//        ?dry=1                 쓰지 않고 고른 결과만
//        ?dry=1&insta=<아이디>  이웃셀러가 아니어도 그 셀러로 고르기만 해 본다(시험용 — 쓰기는 절대 안 함)
// 크론  seller-banner-auto (supabase/sql/seller_banner_auto_173.sql) · 심박 ops_status 'seller-banner-auto'
// 남의 제휴 링크(link.coupang·linkprice·adpick 등)는 배너 링크로 쓰지 않는다(규칙 8).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CRON_SECRET = Deno.env.get('PUSH_CRON_SECRET') || '';
const INPOCK_CDN = 'https://d13k46lqgoj3d6.cloudfront.net';
const OTHERS_AFF = /(link\.coupang\.com|coupa\.ng|linkprice|adpick|click\.linkprice|lpinfo|shoplinker|bit\.ly|han\.gl|me2\.do|vo\.la)/i;
const NOT_PRODUCT = /(CS|C\s*\/\s*S|고객\s*센터|문의|바로가기|리뷰\s*이벤트|리뷰폼|네이버톡톡|카카오|인스타|블로그|유튜브|공지|안내|채널|youtube|instagram|blog|kakao|당첨|이벤트|응모|참여|신청|추첨|여기로|폼\s*작성|후기|체험단|모집|예약|쿠폰|적립|작성|비밀번호|password|로그인|관리자|셀러\s*센터)/i;
// 「판매 종료 시까지 노출」(스룩 상품 페이지 고정 문구)처럼 「…시·시까지」가 붙은 안내는 품절이 아니다(2026-11-19 스룩 결제창 전부가 품절로 떨어졌다)
const SOLD = /(일시\s*품절|품절되었|품절된\s*상품입|전\s*상품\s*품절|판매\s*종료(?!\s*(시|일|까지|후))|판매가\s*종료|판매\s*중지(?!\s*(시|후))|판매가\s*중지|구매하실\s*수\s*없|SOLD\s*OUT)/i;
const glen = (t: string) => [...t].length;
const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
function fit(t: string, n: number): string {
  t = t.replace(/\s+/g, ' ').trim(); if (glen(t) <= n) return t;
  const w = t.split(' '); let o = '';
  for (const x of w) { if (glen((o ? o + ' ' : '') + x) > n) break; o = (o ? o + ' ' : '') + x; }
  return o || [...t].slice(0, n).join('');
}
const stripEmoji = (t: string) => [...String(t)].map((ch) => { const c = ch.codePointAt(0)!; return (c >= 0x1F000 || (c >= 0x2600 && c <= 0x27BF) || c === 0xFE0F) ? ' ' : ch; }).join('');
const cleanName = (s: string) => stripEmoji(String(s).split(/[\n\r]+/)[0]).replace(/\[[^\]]*\]\s*/g, '').replace(/\d{1,2}\s*[./]\s*\d{1,2}[^ ]*/g, ' ').replace(/[~∼]+/g, ' ').replace(/\s*(공동구매|공구|오픈|OPEN)\s*$/gi, '').replace(/\s{2,}/g, ' ').trim();
// ── 남의 주소를 대신 열 때의 안전장치 (코덱스 검사 2026-11-20 — seller-banner·seller-banner-auto 같은 코드) ──
//   ① 사설·예약 IP 는 어떤 표기든 거절: new URL 이 10진(2130706433)·16진(0x7f000001)·8진 IPv4 를 점 표기로 바꿔 주므로 점 표기로 판정한다
//      끝에 점이 붙은 이름(localhost.)·IPv6 표기·80/443 밖 포트도 거절
//   ② 이름이 사설 IP 로 풀리면 거절(Deno.resolveDns — 못 쓰는 환경이면 건너뛰고 fetch 가 판단)
//   ③ 리다이렉트는 자동으로 따라가지 않는다 — 한 단계씩 ①② 를 다시 보고 최대 5번
//   ④ 본문은 흘려 읽으며 상한에서 끊는다(통째로 받은 뒤 자르지 않는다)
function privV4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function privV6(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::' || h === '::1' || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h)) return true;
  const v4 = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (v4) return privV4(v4[1]);
  return /^::ffff:/.test(h) || /^64:ff9b:/.test(h);
}
function safeUrl(u: string): URL | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    if (x.username || x.password) return null;
    if (x.port && x.port !== '80' && x.port !== '443') return null;
    const h = x.hostname.toLowerCase().replace(/\.+$/, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
    if (h.includes(':') || h.startsWith('[')) return null;
    if (/^[\d.]+$/.test(h) && (!/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || privV4(h))) return null;
    return x;
  } catch { return null; }
}
async function hostOk(u: URL): Promise<boolean> {
  const h = u.hostname.replace(/\.+$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return !privV4(h);
  try {
    const rd = (Deno as any).resolveDns; if (typeof rd !== 'function') return true;
    const [a, aaaa] = await Promise.all([rd(h, 'A').catch(() => []), rd(h, 'AAAA').catch(() => [])]);
    return !(a as string[]).some(privV4) && !(aaaa as string[]).some(privV6);
  } catch { return true; }
}
// 한 단계씩 따라가며 열기. 실패·내부 주소면 null. 돌려준 응답의 본문은 부른 쪽이 읽거나 cancel 한다
async function safeFetch(u0: URL, init: RequestInit): Promise<{ r: Response; url: string } | null> {
  let u: URL | null = u0;
  for (let hop = 0; hop <= 5 && u; hop++) {
    if (!safeUrl(u.toString()) || !(await hostOk(u))) return null;
    const r = await fetch(u, { ...init, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const loc = r.headers.get('location')!; try { await r.body?.cancel(); } catch { /* */ }
      try { u = safeUrl(new URL(loc, u).toString()); } catch { u = null; }
      continue;
    }
    return { r, url: u.toString() };
  }
  return null;
}
// 본문을 max 바이트까지만 읽는다. hard=true 면 넘는 순간 null(사진), false 면 앞 max 바이트만(HTML)
async function readCapped(r: Response, max: number, hard: boolean): Promise<Uint8Array | null> {
  const len = Number(r.headers.get('content-length') || 0);
  if (hard && len > max) { try { await r.body?.cancel(); } catch { /* */ } return null; }
  if (!r.body) return new Uint8Array(0);
  const rd = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
  try {
    while (true) {
      const { done, value } = await rd.read(); if (done) break;
      if (n + value.byteLength > max) {
        if (hard) { try { await rd.cancel(); } catch { /* */ } return null; }
        parts.push(value.subarray(0, max - n)); n = max; try { await rd.cancel(); } catch { /* */ } break;
      }
      parts.push(value); n += value.byteLength;
    }
  } catch { if (hard) return null; }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}
const meta = (html: string, keys: string[]): string => {
  for (const k of keys) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i'));
    if (m?.[1]) return m[1].replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  }
  return '';
};
async function getText(u: URL): Promise<{ html: string; url: string; status: number } | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const got = await safeFetch(u, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
    if (!got) return null;   // 내부 주소·리다이렉트 너무 많음
    const { r, url } = got;
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return { html: '', url, status: r.status }; }
    const raw = await readCapped(r, 600000, false);
    return { html: new TextDecoder().decode(raw || new Uint8Array(0)), url, status: r.status };
  } catch { return null; } finally { clearTimeout(t); }
}
// 스마트스토어는 서버 요청을 429 로 막는다 → 상품번호로 네이버 쇼핑 검색에서 같은 상품을 찾아 사진을 쓴다(검색에 있으면 판매 중)
const NID = Deno.env.get('NAVER_CLIENT_ID') || '', NSEC = Deno.env.get('NAVER_CLIENT_SECRET') || '';
async function naverShop(url: string, name: string): Promise<string> {
  const pid = url.match(/(?:smartstore|brand)\.naver\.com\/[^/]+\/products\/(\d+)/)?.[1];
  if (!pid || !NID || !NSEC) return '';
  const kw = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  for (const k of [kw, kw.split(' ').slice(0, 3).join(' ')]) {
    try {
      const r = await fetch('https://openapi.naver.com/v1/search/shop.json?display=100&query=' + encodeURIComponent(k), { headers: { 'X-Naver-Client-Id': NID, 'X-Naver-Client-Secret': NSEC }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      const it = (j.items || []).find((x: any) => String(x.productId) === pid || String(x.link || '').includes(pid));
      if (it?.image) return String(it.image);
    } catch { /* 다음 */ }
  }
  return '';
}
async function getImage(u: URL, referer: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  if (/\.svg(\?|$)|\/static\/nid\/|icon-|favicon|\/logo/i.test(u.toString())) return null;   // 인포크 기본 아이콘(로이첸 사고)
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const got = await safeFetch(u, { headers: { 'User-Agent': UA, Referer: referer }, signal: ctl.signal });
    if (!got) return null;
    const r = got.r;
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return null; }
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(ct)) { try { await r.body?.cancel(); } catch { /* */ } return null; }
    const buf = await readCapped(r, 6 * 1024 * 1024, true);
    if (!buf || buf.byteLength < 5000) return null;
    return { buf, ct };
  } catch { return null; } finally { clearTimeout(t); }
}
const absImg = (s: string) => { s = String(s || '').trim(); if (!s) return ''; if (/^https?:\/\//i.test(s)) return s; if (s.startsWith('//')) return 'https:' + s; return INPOCK_CDN + '/' + s.replace(/^images\//, '').replace(/^\/+/, ''); };

type Cand = { from: string; name: string; link: string; end?: string; img?: string; imgFb?: string; gid?: number };
type Pick = Cand & { image: { buf: Uint8Array; ct: string }; checked: string };
// 결제창이 아닌 주소: 인스타 글·릴스·프로필, 카페 글(로그인 벽), 인포크·리틀리 등 링크인바이오 프로필, 블로그·유튜브 (검증 2026-11-19: 오늘 공구 pay_link 의 카페 182·인스타 42·인포크 3)
const NOT_PAY = /(^|\.)(instagram\.com|instagr\.am|cafe\.naver\.com|blog\.naver\.com|m\.blog\.naver\.com|inpock\.co\.kr|inpk\.link|litt\.ly|linktr\.ee|linkon\.me|wiredy\.com|youtube\.com|youtu\.be|threads\.net|threads\.com|band\.us|pf\.kakao\.com|open\.kakao\.com|momcalendar\.com)$/i;
function notPay(link: string): boolean { const u = safeUrl(link); return !u || NOT_PAY.test(u.hostname); }

// 결제 주소를 실제로 열어 본다: 열림 · 품절 아님 · 사진
async function check(c: Cand): Promise<Pick | { fail: string }> {
  if (OTHERS_AFF.test(c.link)) return { fail: '남의 제휴 링크' };
  if (notPay(c.link)) return { fail: '결제창 아님(인스타·카페·프로필)' };
  const u = safeUrl(c.link); if (!u) return { fail: '주소 이상' };
  const page = await getText(u);
  if (!page) return { fail: '안 열림' };
  if (!safeUrl(page.url)) return { fail: '주소 이상' };
  if (notPay(page.url)) return { fail: '결제창 아님(따라가 보니 인스타·카페·프로필)' };
  if (!page.html) {
    // 막힌 스마트스토어: 네이버 쇼핑 검색에 같은 상품번호가 있으면 판매 중으로 보고 그 사진(또는 인포크 블록 사진)을 쓴다
    if ((page.status === 429 || page.status === 403 || page.status === 490) && /(^|\.)(smartstore|brand)\.naver\.com$/.test(new URL(page.url).hostname)) {
      const ns = await naverShop(page.url, c.name);
      if (!ns) return { fail: `스마트스토어 막힘·검색에 없음(${page.status})` };
      let image: { buf: Uint8Array; ct: string } | null = null;
      if (c.img) { const iu = safeUrl(absImg(c.img)); if (iu) image = await getImage(iu, 'https://link.inpock.co.kr/'); }
      if (!image) { const iu = safeUrl(ns); if (iu) image = await getImage(iu, 'https://search.shopping.naver.com/'); }
      if (!image) return { fail: '사진 없음' };
      return { ...c, image, checked: page.url + ' (네이버 쇼핑 검색 확인)' };
    }
    return { fail: `안 열림(${page.status})` };
  }
  const title = meta(page.html, ['og:title', 'twitter:title']) || (page.html.match(/<title[^>]*>([^<]{2,120})<\/title>/i)?.[1] || '');
  const head = title + ' ' + page.html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').slice(0, 40000);
  if (SOLD.test(head)) return { fail: '품절·판매종료 문구' };
  let image: { buf: Uint8Array; ct: string } | null = null;
  if (c.img) { const iu = safeUrl(absImg(c.img)); if (iu) image = await getImage(iu, 'https://link.inpock.co.kr/'); }
  if (!image) {
    const raw = meta(page.html, ['og:image:secure_url', 'og:image', 'twitter:image']);
    let iu: URL | null = null; try { iu = raw ? safeUrl(new URL(raw, page.url).toString()) : null; } catch { iu = null; }
    if (iu) image = await getImage(iu, page.url);
  }
  // 결제 페이지 사진이 없을 때만 상품명이 겹치는 인포크 블록 사진(같은 주소가 아니라 다른 상품일 수 있어 맨 뒤)
  if (!image && c.imgFb) { const iu = safeUrl(absImg(c.imgFb)); if (iu) image = await getImage(iu, 'https://link.inpock.co.kr/'); }
  if (!image) return { fail: '사진 없음' };
  return { ...c, image, checked: page.url };
}

async function inpockBlocks(slug: string): Promise<{ base: string; blocks: any[] } | null> {
  for (const base of ['https://link.inpock.co.kr', 'https://inpk.link']) {
    const p = await getText(new URL(base + '/' + encodeURIComponent(slug)));
    if (!p || p.html.length < 8000) continue;
    const m = p.html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (!m) continue;
    try { const pp = JSON.parse(m[1])?.props?.pageProps; if (pp?.blocks?.length) return { base, blocks: pp.blocks }; } catch { /* 다음 */ }
  }
  return null;
}
// 인포크: 오늘 기간 안의 결제 블록 먼저, 그다음 맨 위 상품 링크 블록
function inpockCands(blocks: any[], base: string, today: string): Cand[] {
  const flat: any[] = [];
  for (const b of blocks) { flat.push(b); for (const k of ['schedule_list', 'items', 'links', 'blocks', 'children']) if (Array.isArray(b?.[k])) for (const c of b[k]) flat.push(c); }
  const live: Cand[] = [], top: Cand[] = [];
  for (const b of flat) {
    const bt = b?.block_type; if (bt && !['link', 'collection_link', 'calendar', 'calendar_item'].includes(bt)) continue;
    const name = cleanName(b?.title || ''); const url = String(b?.url || '');
    if (!name || glen(name) < 2 || !url || NOT_PRODUCT.test(name)) continue;
    const link = url.startsWith('http') ? url : base + url;
    const lu = safeUrl(link);
    if (!lu || notPay(link)) continue;   // 인포크 안쪽·인스타·카페 등은 결제창이 아니다
    const s = String(b.open_at || b.start_at || '').slice(0, 10), e = String(b.open_until || b.end_at || '').slice(0, 10);
    const c: Cand = { from: '인포크', name, link, img: b.image ? String(b.image) : '' };
    // 오늘이 기간 안: 끝이 있으면 오픈+14 안의 끝, 끝이 없으면 오픈 7일 안(오픈+7 상한 · 몇 달 전 블록을 「오늘」로 보지 않게)
    const plus = (n: number) => kstDate(new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5 - 9 * 3600e3));
    if (live.length < 4 && s && s <= today && (e ? (e >= today && e <= plus(14)) : today <= plus(7))) live.push({ ...c, from: '인포크 오늘', end: e || '' });
    else if (!s && !e && bt === 'link' && /[가-힣]{2}/.test(name) && name.split(/\s+/).length >= 2 && glen(name) >= 4 && glen(name) <= 44 && top.length < 3) top.push({ ...c, from: '인포크 맨 위' });
  }
  return [...live, ...top];
}
// 사진 맞추기용: 사진이 있는 상품 블록 전부(날짜 상관없이)
function inpockAll(blocks: any[], base: string): Cand[] {
  const o: Cand[] = [];
  const walk = (b: any) => {
    if (!b) return;
    const name = cleanName(b.title || ''), url = String(b.url || '');
    if (name && url && b.image) o.push({ from: '인포크', name, link: url.startsWith('http') ? url : base + url, img: String(b.image) });
    for (const k of ['schedule_list', 'items', 'links', 'blocks', 'children']) if (Array.isArray(b[k])) b[k].forEach(walk);
  };
  blocks.forEach(walk); return o;
}

Deno.serve(async (req) => {
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return J({ ok: false, msg: 'unauthorized' }, 401);
  const q = new URL(req.url).searchParams;
  // selftest=1&insta=<아이디>: 쓰기 길을 끝까지 시험 — 사진을 올리고 배너를 꺼진 채(active=false) 넣었다가 바로 지운다(손님 화면에 안 뜬다)
  const selftest = q.get('selftest') === '1';
  const dry = q.get('dry') === '1' && !selftest, only = (q.get('insta') || '').replace(/^@/, '').toLowerCase();
  if (only && !dry && !selftest) return J({ ok: false, msg: 'insta 는 dry·selftest 에서만' }, 400);
  if (selftest && !only) return J({ ok: false, msg: 'selftest 는 insta 가 필요' }, 400);
  const sb: SupabaseClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = kstDate();
  const pub = (name: string) => sb.storage.from('banners').getPublicUrl('seller/' + name).data.publicUrl;

  // 대상 셀러
  let sq = sb.from('sellers').select('id,name,seller_influencer,insta,inpock_slug,is_partner,active,start_date,end_date');
  if (only) sq = sq.eq('insta', only); else sq = sq.eq('is_partner', true).eq('active', true);
  const { data: sel, error: se } = await sq;
  if (se) return J({ ok: false, msg: 'sellers ' + se.message }, 500);
  const sellers = (sel || []).filter((s: any) => only || ((!s.start_date || s.start_date <= today) && (!s.end_date || s.end_date >= today)));
  // 🔴 이 두 조회가 실패하면 회차 전체를 멈춘다(아무것도 쓰지 않는다) — 실패를 빈 목록으로 삼키면 같은 셀러 배너가 2장이 되거나 켜진 배너 사진을 지운다(검증 2026-11-19)
  //    직접 꾸민 배너는 **켜진 것만** 센다 — 이웃셀러가 끝나 꺼진 행이 남아 있어도 재결제하면 다시 자동 연동(seller_banner_tidy 는 끄기만 한다)
  const { data: own, error: oe } = await sb.from('banners').select('seller_id').not('seller_id', 'is', null).eq('active', true);
  if (oe) return J({ ok: false, msg: 'banners(own) ' + oe.message }, 500);
  const managed = new Set((own || []).map((r: any) => Number(r.seller_id)));
  const { data: curRows, error: ce } = await sb.from('banners').select('id,title,link,img_url,active').eq('type', 'seller').is('seller_id', null).eq('active', true);
  if (ce || !curRows) return J({ ok: false, msg: 'banners(cur) ' + (ce?.message || 'null') }, 500);
  const cur = curRows;
  const out: any[] = []; let changed = 0;
  const T0 = Date.now();   // 함수 시간 한도 150초 — 100초가 넘으면 남은 셀러는 다음 회차로(반쯤 쓴 상태를 만들지 않게 셀러 단위로 끊는다)
  const sellerName = (s: any) => String(s.seller_influencer || s.name || s.insta || '').trim();   // 셀러 「내 배너」(seller_banner_can)와 같은 순서

  const handle = async (s: any) => {
    const nm = sellerName(s);
    if (Date.now() - T0 > 100e3) { out.push({ seller: nm, skip: '시간 한도 — 다음 회차' }); return; }
    const mine = cur.filter((b: any) => String(b.title).endsWith(' - ' + nm));
    if (!only && managed.has(Number(s.id))) { out.push({ seller: nm, skip: '셀러가 직접 꾸민 배너' }); return; }
    const tried: any[] = [];
    // ① gonggu 오늘 진행 중 + 결제 링크
    const { data: gs, error: ge } = await sb.from('gonggu').select('id,name,pay_link,open_date,end_date').eq('insta', s.insta).eq('approved', true)
      .lte('open_date', today).gte('end_date', today).neq('pay_link', '').not('pay_link', 'is', null)
      .order('open_date', { ascending: false }).order('id', { ascending: false }).limit(6);
    // 🔴 조회가 실패하면 이 셀러는 이번 회차를 건너뛴다(지금 배너 유지) — 실패한 보류 조회를 「보류 없음」으로 읽으면 내린 공구가 배너로 나간다(코덱스 검사 2026-11-20)
    if (ge) { out.push({ seller: nm, skip: 'gonggu 조회 실패 — 다음 회차 ' + ge.message }); return; }
    const { data: holds, error: he } = await sb.from('gonggu_hold').select('id').in('id', (gs || []).map((g: any) => g.id).concat([-1]));
    if (he) { out.push({ seller: nm, skip: 'gonggu_hold 조회 실패 — 다음 회차 ' + he.message }); return; }
    const held = new Set((holds || []).map((h: any) => Number(h.id)));
    const cands: Cand[] = (gs || []).filter((g: any) => !held.has(Number(g.id))).map((g: any) => ({ from: '공구 일정', name: String(g.name || ''), link: String(g.pay_link || ''), end: g.end_date, gid: g.id }));
    // ② 인포크 실시간
    const { data: si, error: sie } = await sb.from('seller_inpock').select('slug').eq('insta', String(s.insta || '').toLowerCase()).maybeSingle();
    if (sie) { out.push({ seller: nm, skip: 'seller_inpock 조회 실패 — 다음 회차 ' + sie.message }); return; }   // 슬러그 대신 인스타 아이디로 부르면 조용히 0건(규칙 0-I)
    const slug = String(si?.slug || s.inpock_slug || s.insta || '');
    const ip = slug ? await inpockBlocks(slug) : null;
    if (ip) {
      const ic = inpockCands(ip.blocks, ip.base, today);
      // 결제 페이지에 사진이 없을 때를 위해: 같은 주소(또는 상품명 낱말 2개 이상 겹치는) 인포크 블록 사진을 붙여 둔다
      const norm = (x: string) => x.replace(/^https?:\/\/(www\.|m\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '');
      const words = (x: string) => new Set(cleanName(x).split(/\s+/).filter((w) => glen(w) >= 2));
      const all = inpockAll(ip.blocks, ip.base);
      for (const c of cands) {
        const w = words(c.name);
        const same = all.find((b) => norm(b.link) === norm(c.link));
        if (same) { c.img = same.img; continue; }
        const near = all.find((b) => [...words(b.name)].filter((x) => w.has(x)).length >= 2);
        if (near) c.imgFb = near.img;
      }
      cands.push(...ic);
    }
    let pick: Pick | null = null;
    for (const c of cands.slice(0, 8)) {
      if (Date.now() - T0 > 110e3) { tried.push({ from: c.from, name: c.name, link: c.link, fail: '시간 한도' }); break; }
      const r = await check(c);
      if ('fail' in r) { tried.push({ from: c.from, name: c.name, link: c.link, fail: r.fail }); continue; }
      pick = r; break;
    }
    if (!pick) {
      out.push({ seller: nm, slug, inpock: !!ip, tried, keep: mine.map((b: any) => b.title) });
      // 6시간 넘게 걸 게 없으면 경보(12시간에 한 번)
      if (!dry && !selftest) {
        const st = await sb.from('ops_status').select('payload,updated_at').eq('id', 'seller-banner-miss-' + s.id).maybeSingle();
        const since = st.data?.payload?.since ? Date.parse(String(st.data.payload.since)) : NaN;
        if (!st.data) await sb.from('ops_status').upsert({ id: 'seller-banner-miss-' + s.id, payload: { since: new Date().toISOString(), seller: nm }, updated_at: new Date().toISOString() });
        else if (!isNaN(since) && Date.now() - since > 6 * 3600e3) {
          const { data: rec } = await sb.from('health_alerts').select('id').eq('kind', '이웃셀러배너:걸것없음').gte('created_at', new Date(Date.now() - 12 * 3600e3).toISOString()).ilike('detail', `%${nm}%`).limit(1);
          if (!rec?.length) await sb.from('health_alerts').insert({ kind: '이웃셀러배너:걸것없음', detail: `🔴 이웃셀러 ${nm}(@${s.insta}) — 6시간 넘게 오늘 공구·인포크 결제 링크를 못 찾음(인포크 ${ip ? '읽힘' : '못 읽음'} · 시도 ${tried.length}건). 배너는 이전 것 유지` });
        }
      }
      return;
    }
    if (!dry && !selftest) await sb.from('ops_status').delete().eq('id', 'seller-banner-miss-' + s.id);
    // 「크레용맘x세이펜 …」처럼 셀러 이름을 앞에 붙인 상품명은 셀러 이름을 뗀다(제목 끝에 「- 셀러명」이 또 붙는다)
    const esc = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const base0 = (cleanName(pick.name) || pick.name).replace(new RegExp('^' + esc + '\\s*[xX×]\\s*'), '').trim();
    const name = fit(base0 || pick.name, 20);
    const title = `${name} - ${nm}`.slice(0, 60);
    // 멘트는 근거가 있을 때만: 마감을 알면 「M/D까지 공구」, 오늘 기간 블록이면 「지금 공구 중」, 기간 없는 맨 위 블록은 비운다(규칙 0-K)
    const sub = pick.end && pick.end >= today ? `${md(pick.end)}까지 공구` : pick.from === '인포크 맨 위' ? '' : '지금 공구 중';
    const same = mine.length === 1 && mine[0].link === pick.link && mine[0].title === title;
    const row = { seller: nm, from: pick.from, name, sub, link: pick.link, gid: pick.gid || null, tried, same };
    if (dry || (same && !selftest)) { out.push(row); return; }
    // 사진을 우리 저장소로 → 새 배너 → 옛 자동 배너 내림 → 옛 자동 사진 지움
    const ext = pick.image.ct === 'image/png' ? 'png' : pick.image.ct === 'image/webp' ? 'webp' : 'jpg';
    const file = `auto${s.id}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${ext}`;
    const up = await sb.storage.from('banners').upload('seller/' + file, pick.image.buf, { contentType: pick.image.ct, upsert: false, cacheControl: '31536000' });
    if (up.error) { out.push({ ...row, error: '사진 올리기 실패 ' + up.error.message }); return; }
    const ins = await sb.from('banners').insert({ type: 'seller', title, subtitle: sub || null, link: pick.link, img_url: pub(file), img_size: 'cover', img_position: 'center', sort_order: 1, active: !selftest }).select('id').single();
    if (ins.error) { await sb.storage.from('banners').remove(['seller/' + file]); out.push({ ...row, error: '배너 넣기 실패 ' + ins.error.message }); return; }
    if (selftest) { await sb.from('banners').delete().eq('id', ins.data.id); await sb.storage.from('banners').remove(['seller/' + file]); const gone = await sb.from('banners').select('id').eq('id', ins.data.id); out.push({ ...row, selftest: { inserted: ins.data.id, img: pub(file), removed: !(gone.data || []).length } }); return; }
    if (mine.length) {
      const offr = await sb.from('banners').update({ active: false }).in('id', mine.map((b: any) => b.id));
      if (offr.error) {   // 옛 배너를 못 내렸으면 새 배너를 되돌린다 — 2장이 되지 않게, 옛 사진도 안 지운다
        await sb.from('banners').delete().eq('id', ins.data.id); await sb.storage.from('banners').remove(['seller/' + file]);
        out.push({ ...row, error: '옛 배너 내리기 실패 — 새 배너 되돌림 ' + offr.error.message }); return;
      }
    }
    // 옛 자동 사진 청소: 새 것과 바로 앞 것(손님 화면·Worker 캐시가 아직 들고 있을 수 있다)은 남기고 그보다 오래된 것만
    try {
      const ls = await sb.storage.from('banners').list('seller', { limit: 100, search: `auto${s.id}_`, sortBy: { column: 'created_at', order: 'desc' } });
      const names = (ls.data || []).map((f: any) => f.name).filter((n: string) => n.startsWith(`auto${s.id}_`) && n !== file);
      const del = names.slice(1);
      if (del.length) await sb.storage.from('banners').remove(del.map((n: string) => 'seller/' + n));
    } catch { /* 청소 실패는 넘어간다 */ }
    await sb.from('health_alerts').insert({ kind: '이웃셀러배너교체', detail: `${nm}: ${mine.map((b: any) => b.title).join(' / ') || '없음'} → ${title} (${pick.from} · ${pick.link})`.slice(0, 380) });
    changed++; out.push({ ...row, id: ins.data.id });
  };
  // 4명씩 나란히(함수 시간 한도 150초 안에 끝나게)
  const list = sellers as any[];
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map((s) => handle(s).catch((e) => { out.push({ seller: s.name, error: String(e).slice(0, 120) }); })));

  // 이웃셀러가 끝난(또는 직접 꾸미기로 바꾼) 셀러의 자동 배너는 내린다
  let off = 0;
  if (!dry && !only) {
    // 내리는 것은 「이웃셀러였던 셀러 이름」으로 끝나는 자동 배너뿐 — 관리자가 손으로 건 다른 배너는 건드리지 않는다
    const { data: ever, error: ee } = await sb.from('sellers').select('id,name,seller_influencer,insta').eq('is_partner', true);
    // 🔴 실패하면 심박을 쓰지 않고 실패로 끝낸다 — 끝난 셀러 배너를 못 내린 채 「정상」으로 남으면 멈춤 감시가 못 잡는다(코덱스 검사 2026-11-20)
    if (ee) return J({ ok: false, msg: 'sellers(ever) ' + ee.message, changed, out }, 500);
    const liveIds = new Set((sellers as any[]).filter((s) => !managed.has(Number(s.id))).map((s) => Number(s.id)));
    const live = new Set((sellers as any[]).filter((s) => liveIds.has(Number(s.id))).map((s) => ' - ' + sellerName(s)));
    const gone = (ever || []).filter((s: any) => !liveIds.has(Number(s.id))).flatMap((s: any) => [s.seller_influencer, s.name].filter(Boolean).map((n: string) => ' - ' + String(n).trim()));
    const stale = cur.filter((b: any) => ![...live].some((t) => String(b.title).endsWith(t)) && gone.some((t) => String(b.title).endsWith(t)));
    if (stale.length) {
      const so = await sb.from('banners').update({ active: false }).in('id', stale.map((b: any) => b.id));
      if (so.error) return J({ ok: false, msg: '끝난 셀러 배너 내리기 실패 ' + so.error.message, changed, out }, 500);
      off = stale.length;
    }
    await sb.from('ops_status').upsert({ id: 'seller-banner-auto', payload: { sellers: sellers.length, changed, off, out: out.map((o) => ({ seller: o.seller, from: o.from || null, link: o.link || null, skip: o.skip || null })) }, updated_at: new Date().toISOString() });
  }
  return J({ ok: true, dry, today, sellers: sellers.length, changed, off, out });
});

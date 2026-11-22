// 이웃셀러 「내 배너」 사진 — 링크에서 가져오기 · 폰에서 고른 사진 올리기 (사장님 2026-11-19)
//
//   POST { token, op: 'probe', link }   → 그 페이지의 대표 사진·제목·설명을 찾아 돌려준다. 사진은 저장소(banners/seller/tmp_…)에 받아 둔 주소로
//                                         (다른 사이트 사진은 화면에서 자르기(canvas)가 막혀서, 우리 저장소를 거쳐야 편집할 수 있다)
//   POST { token, op: 'upload', data }  → 화면이 800×800 으로 잘라 만든 JPEG(base64)를 banners/seller/<셀러id>_<무작위>.jpg 에 올린다 → { image }
//                                         이 주소를 DB 함수 seller_banner_save 가 받는다(그 셀러 폴더의 사진만 받는다)
// 누가: 셀러 로그인 토큰이 이웃셀러(노출 중)일 때만 — DB seller_banner_can 이 확인한다. 관리자용 link-image 와는 따로 둔다.
// 저장소가 차지 않게: 올릴 때마다 그 셀러의 옛 사진·임시 사진을 지운다(지금 배너가 쓰는 한 장만 남긴다). 한 장 700KB 이하.
// 남의 서버를 대신 찌르지 않게: http(s) 만 · 내부 주소(localhost·사설 IP)는 거절 · 받는 크기 제한.
// 표·함수: supabase/sql/seller_banner_170.sql.   배포: supabase functions deploy seller-banner --no-verify-jwt
// PC 가 꺼져도 돈다(서버).
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOW = ['https://momcalendar.com', 'https://www.momcalendar.com'];
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0], 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// ── 상품명 20자 · 멘트 24자로 줄이기 (사장님 2026-11-19 「링크 읽고 글자수에 맞게 니가 나름 해석해서 줄여야지」) ──
//   ① AI(Haiku, 챗봇·name-clean 과 같은 ANTHROPIC_API_KEY): 상품명 = 원문 낱말에서 브랜드+품목만(지어내기·순서 바꾸기 금지) · 멘트 = 원문 사실로 짧게
//   ② 검사에 걸리거나 AI 가 안 되면 낱말 단위로 끊는다(글자 중간에서 자르지 않는다)
//   하루 상한 BANNER_AI_PER_DAY(기본 300) — 셈은 app_private_config 'banner_ai_day' = 'YYYY-MM-DD:N'
const AI_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const AI_MODEL = Deno.env.get('BOT_AI_MODEL') || 'claude-haiku-4-5';
const AI_PER_DAY = Number(Deno.env.get('BANNER_AI_PER_DAY') || 300);
const glen = (t: string) => [...t].length;
const toks = (t: string) => t.split(/\s+/).filter(Boolean);
function fitWords(t: string, n: number): string {
  let out = '';
  for (const w of toks(String(t || '').replace(/[\[\]【】()（）]/g, ' ').replace(/\s+/g, ' '))) {
    const next = out ? out + ' ' + w : w;
    if (glen(next) > n) break;
    out = next;
  }
  return out.replace(/[,·/&+\-]+$/g, '').trim();
}
// 상품명: 원문 낱말을 원문 순서대로만 썼는가
function nameOk(orig: string, name: string): boolean {
  const a = toks(orig.replace(/[,()\[\]]/g, ' ')), b = toks(name.replace(/[,()\[\]]/g, ' '));
  if (!b.length || glen(name) > 20 || glen(name.replace(/\s/g, '')) < 2) return false;
  if (/(와|과|및|의|을|를|은|는|이|가|에|로|도|랑|하고|공동구매|공구|오픈|특가)$/.test(name.trim())) return false;   // 조사·행사 말로 끝나면 안 된다
  if (/(한|운|던|된|하는|마시는|먹는|쓰는)$/.test(toks(name).pop() || '')) return false;   // 꾸밈말로 끝나면 안 된다(「…유기농 진한」)
  const base = (w: string) => w.replace(/(와|과|및|의|을|를|은|는|이|가)$/, '');   // 원문 낱말에서 조사를 뗀 꼴도 같은 낱말로 본다(「보리차와」→「보리차」)
  let i = 0; for (const w of a) if (i < b.length && (w === b[i] || (glen(base(w)) >= 2 && base(w) === b[i]))) i++;
  return i === b.length;
}
// 멘트: 24자 안 · 원문에 없는 숫자(가격·날짜·%)를 넣지 않았는가
function descOk(src: string, d: string): boolean {
  if (!d) return true;
  if (glen(d) > 24) return false;
  for (const m of d.match(/\d+/g) || []) if (!src.includes(m)) return false;
  return !/https?:|[<>]/.test(d);
}
async function dayBudget(sb: SupabaseClient, key: string, cap: number): Promise<boolean> {
  try {
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const r = await sb.from('app_private_config').select('value').eq('key', key).maybeSingle();
    const [d, n] = String(r.data?.value || '').split(':');
    const used = d === day ? Number(n) || 0 : 0;
    if (used >= cap) return false;
    await sb.from('app_private_config').upsert({ key, value: `${day}:${used + 1}`, updated_at: new Date().toISOString() });
    return true;
  } catch { return false; }
}
const aiBudget = (sb: SupabaseClient) => dayBudget(sb, 'banner_ai_day', AI_PER_DAY);
// 테스트 페이지 「화면만 보기」(token='demo')는 로그인 없이 부를 수 있다 → 하루 상한을 따로 둔다(남의 사이트를 대신 여는 통로·AI 한도 소진 방지 · 코덱스 검사 2026-11-20)
const DEMO_PER_DAY = Number(Deno.env.get('BANNER_DEMO_PER_DAY') || 60);
// 「셀러명 x 브랜드」 꼴의 앞부분(판매처 이름)과 끝의 행사 말은 뗀다
const dropSeller = (t: string) => t.replace(/^\S+(\s+\S+)?\s+[xX×]\s+/, '');
function cleanTitle(t: string): string { return dropSeller(t).replace(/\s*(공동구매|공구|오픈|특가)\s*$/g, '').trim(); }
// 실패했을 때: 조사로 끝나는 낱말은 빼고 낱말 단위로 끊는다
function fbNameOf(title: string): string {
  const w = toks(cleanTitle(title)).map((x) => x.replace(/(와|과|및)$/, ''));
  let out = fitWords(w.join(' '), 20).split(' ');
  while (out.length > 1 && /(한|운|던|된|하는|마시는|먹는|쓰는)$/.test(out[out.length - 1])) out.pop();   // 꾸밈말로 끝나지 않게
  return out.join(' ');
}
async function shorten(sb: SupabaseClient, title: string, desc: string, body = ''): Promise<{ name: string; desc: string; by: string }> {
  const fbName = fbNameOf(title), fbDesc = fitWords(desc, 24);
  const plain = cleanTitle(title);
  if (!AI_KEY || (!title && !desc) || (glen(plain) <= 20 && glen(desc) <= 24 && !body)) return { name: glen(plain) <= 20 && nameOk(title, plain) ? plain : fbName, desc: glen(desc) <= 24 ? desc : fbDesc, by: 'cut' };
  if (!(await aiBudget(sb))) return { name: fbName, desc: fbDesc, by: 'cut' };
  const system = [
    '맘캘린더 이웃셀러 배너 문구 만들기. 상품 판매 페이지의 제목과 설명을 받아 배너 카드에 들어갈 두 줄을 만든다.',
    'name: 20자 이하(공백 포함). 제목에 있는 낱말만 원래 순서대로 골라 「브랜드 + 품목」으로. 낱말을 깎거나 바꾸거나 새 말을 넣지 않는다. 자랑·수식어·행사 문구는 뺀다.',
    'name 에는 「셀러명 x 브랜드」의 앞 「셀러명 x」(판매처 이름)를 넣지 않는다. 괄호 속 옵션(크기·구성)은 name 대신 desc 재료로 쓴다.',
    'name 은 조사(와·과·의·을·를 등)나 「공동구매·공구·특가」로 끝나면 안 된다. 예: 「로지오가닉 처음마시는 유기농 보리차와 진한 배도라지즙 공동구매」 → 「로지오가닉 유기농 보리차」.',
    '설명이 이 상품이 아니라 가게 전체 소개일 수 있다. 본문(상품 정보·옵션)을 우선해 이 상품에 대한 사실만 쓴다.',
    'desc: 반드시 24자 이하(공백 포함, 15~22자가 좋다). 본문·설명·제목에 있는 이 상품의 사실(구성·용량·대상·특징)만으로 한 줄로. 쓸 재료가 조금이라도 있으면 빈칸으로 두지 않는다. 가격·할인율·날짜·기간·「최저가」 같은 말은 넣지 않는다. 문장 중간에서 끊지 말고 자연스럽게 끝맺는다(명사형이나 「~요」). 줄표(—)·느낌표·이모지 금지. 쓸 말이 없으면 빈 문자열.',
    '출력: JSON 한 개만 {"name":"…","desc":"…"}. 다른 말 금지.',
  ].join('\n');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 200, system, messages: [{ role: 'user', content: JSON.stringify({ 제목: title, 설명: desc, 본문: body.slice(0, 700) }) }] }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    const m = String(j?.content?.[0]?.text || '').match(/\{[\s\S]*\}/);
    const o = m ? JSON.parse(m[0]) : {};
    const n = typeof o.name === 'string' ? dropSeller(o.name.trim()) : '', d = typeof o.desc === 'string' ? o.desc.trim().replace(/[—!]+/g, '').replace(/[.。]+$/, '').trim() : '';
    const src = title + ' ' + desc + ' ' + body;
    // 멘트가 24자를 넘으면 버리지 않고 낱말 단위로 줄여 다시 본다(끝이 꾸밈말·조사면 한 낱말씩 더 뺀다)
    let d2 = d;
    if (glen(d2) > 24) { const w = fitWords(d2, 24).split(' '); while (w.length > 1 && /(와|과|및|의|을|를|은|는|이|가|에|로|한|운|던|된|하는|있는|좋은)$/.test(w[w.length - 1])) w.pop(); d2 = w.join(' '); }
    return { name: nameOk(title, n) ? n : fbName, desc: descOk(src, d2) ? d2 : fbDesc, by: 'ai' };
  } catch { return { name: fbName, desc: fbDesc, by: 'cut' }; }
}

const rnd = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

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
    if (m?.[1]) return m[1].replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
};
async function getImage(u: URL, referer: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const got = await safeFetch(u, { headers: { 'User-Agent': UA, Referer: referer }, signal: ctl.signal });
    if (!got) return null;
    const r = got.r;
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return null; }
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(ct)) { try { await r.body?.cancel(); } catch { /* */ } return null; }
    const buf = await readCapped(r, 6 * 1024 * 1024, true);
    if (!buf || buf.byteLength < 1024) return null;
    return { buf, ct };
  } catch { return null; } finally { clearTimeout(t); }
}
// 이 셀러의 사진 중 keep 에 없는 것을 지운다(임시 사진 포함)
async function tidy(sb: SupabaseClient, sid: number, keep: string[]) {
  try {
    const ls = await sb.storage.from('banners').list('seller', { limit: 200, search: `${sid}_` });
    const cur = await sb.from('banners').select('img_url').eq('seller_id', sid).maybeSingle();
    const curName = (cur.data?.img_url || '').split('/').pop() || '';
    const del = (ls.data || []).map((f) => f.name).filter((n) => (n.startsWith(`${sid}_`) || n.startsWith(`tmp${sid}_`)) && n !== curName && !keep.includes(n));
    const ls2 = await sb.storage.from('banners').list('seller', { limit: 200, search: `tmp${sid}_` });
    for (const f of ls2.data || []) if (!keep.includes(f.name) && !del.includes(f.name)) del.push(f.name);
    if (del.length) await sb.storage.from('banners').remove(del.map((n) => 'seller/' + n));
  } catch { /* 청소 실패는 넘어간다 */ }
}

Deno.serve(async (req) => {
  const H = { ...cors(req), 'Content-Type': 'application/json' };
  const J = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return J({ ok: false, msg: 'method' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return J({ ok: false, msg: 'bad' }, 400); }
  const token = typeof b.token === 'string' ? b.token : '';
  if (!token || token.length > 400) return J({ ok: false, msg: 'bad' }, 400);
  // 테스트 페이지 「화면만 보기」(token='demo'): 링크를 실제로 읽어 보여만 준다 — 저장소에 올리지 않고 사진은 data 주소로(800KB 이하만)
  //   (사장님 2026-11-19 「이 링크를 직접 읽어서 맞게 나와야지」 — 화면만 보기에서 가짜 예시가 채워지던 것)
  const demo = token === 'demo' && b.op === 'probe';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const can = demo ? { error: null, data: { ok: true, seller_id: 0 } } : await sb.rpc('seller_banner_can', { p_token: token });
  if (can.error) return J({ ok: false, msg: 'server' }, 500);
  if (demo && !(await dayBudget(sb, 'banner_demo_day', DEMO_PER_DAY))) return J({ ok: false, msg: 'demo_limit' }, 429);
  if (!can.data?.ok) return J({ ok: false, msg: can.data?.msg || 'not_partner' }, can.data?.msg === 'unauthorized' ? 401 : 403);
  const sid = Number(can.data.seller_id);
  const pub = (name: string) => sb.storage.from('banners').getPublicUrl('seller/' + name).data.publicUrl;

  if (b.op === 'upload') {
    const data = typeof b.data === 'string' ? b.data.replace(/^data:image\/jpeg;base64,/, '') : '';
    if (!data || data.length > 950000) return J({ ok: false, msg: 'too_big' }, 400);          // base64 95만 자 ≈ 700KB
    let buf: Uint8Array;
    try { buf = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)); } catch { return J({ ok: false, msg: 'bad' }, 400); }
    if (buf.byteLength < 2000 || buf[0] !== 0xff || buf[1] !== 0xd8) return J({ ok: false, msg: 'bad' }, 400);   // JPEG 만
    const name = `${sid}_${rnd()}.jpg`;
    const up = await sb.storage.from('banners').upload('seller/' + name, buf, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (up.error) return J({ ok: false, msg: 'server' }, 500);
    await tidy(sb, sid, [name]);
    return J({ ok: true, image: pub(name) });
  }

  if (b.op === 'probe') {
    const u = safeUrl(typeof b.link === 'string' ? b.link.trim() : '');
    if (!u) return J({ ok: false, msg: 'bad_link' }, 400);
    let html = '', finalUrl = u.toString();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
    try {
      // 리다이렉트는 한 단계씩 내부 주소인지 보고 따라간다 · 본문은 600KB 에서 끊는다(코덱스 검사 2026-11-20)
      const got = await safeFetch(u, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
      if (!got) return J({ ok: false, msg: 'bad_link' }, 400);
      const r = got.r;
      if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return J({ ok: false, msg: 'blocked', status: r.status }); }
      finalUrl = got.url;
      html = new TextDecoder().decode((await readCapped(r, 600000, false)) || new Uint8Array(0));
    } catch { return J({ ok: false, msg: 'blocked' }); } finally { clearTimeout(t); }
    const title = (meta(html, ['og:title', 'twitter:title']) || (html.match(/<title[^>]*>([^<]{2,120})<\/title>/i)?.[1] || '')).replace(/\s+/g, ' ').trim().slice(0, 120);
    let desc = meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 300);
    if (desc.replace(/\s+/g, '') === title.replace(/\s+/g, '') || /^(스룩페이|셀럽샵|네이버 스마트스토어|쿠팡)$/.test(desc)) desc = '';   // 제목 되풀이·사이트 이름뿐이면 비운다
    const raw = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
    let image = '';
    if (raw) {
      let iu: URL | null = null;
      try { iu = safeUrl(new URL(raw, finalUrl).toString()); } catch { iu = null; }
      const got = iu ? await getImage(iu, finalUrl) : null;
      if (got && demo) {
        if (got.buf.byteLength <= 800 * 1024) { let bin = ''; for (let i = 0; i < got.buf.length; i += 32768) bin += String.fromCharCode(...got.buf.subarray(i, i + 32768)); image = `data:${got.ct};base64,` + btoa(bin); }
      } else if (got) {
        const ext = got.ct === 'image/png' ? 'png' : got.ct === 'image/webp' ? 'webp' : 'jpg';
        const name = `tmp${sid}_${rnd()}.${ext}`;
        const up = await sb.storage.from('banners').upload('seller/' + name, got.buf, { contentType: got.ct, upsert: false });
        if (!up.error) { image = pub(name); await tidy(sb, sid, [name]); }
      }
    }
    const t0 = /^(스룩페이|셀럽샵|스마트스토어|쿠팡|instagram)$/i.test(title) ? '' : title;
    // 설명 태그가 제목과 겹치는 낱말(2자 이상)이 하나도 없으면 가게 전체 소개로 보고 버린다(2026-11-19 로지오가닉: 「아기 퓨레」 가게 소개)
    const tw = new Set(toks(t0).map((w) => w.replace(/(와|과|의|을|를)$/, '')).filter((w) => glen(w) >= 2));
    if (desc && tw.size && !toks(desc).some((w) => [...tw].some((x) => w.includes(x) || x.includes(w.replace(/[,.]/g, ''))))) desc = '';
    // 본문에서 상품 이름 주변 글(옵션·용량 등)을 조금 떼어 함께 읽힌다
    let body = '';
    try {
      const txt = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
      const key = [...tw].sort((a, b) => glen(b) - glen(a))[0] || '';
      const at = key ? txt.indexOf(key) : -1;
      if (at >= 0) body = txt.slice(Math.max(0, at - 80), at + 700).trim();
    } catch { body = ''; }
    const sh = await shorten(sb, t0, desc, body);
    return J({ ok: true, title: sh.name, desc: sh.desc, image, full_title: t0, by: sh.by });
  }
  return J({ ok: false, msg: 'bad' }, 400);
});

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
const rnd = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

function safeUrl(u: string): URL | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    const h = x.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':')) return null;
    return x;
  } catch { return null; }
}
const meta = (html: string, keys: string[]): string => {
  for (const k of keys) {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${k}["']`, 'i'));
    if (m?.[1]) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  }
  return '';
};
async function getImage(u: URL, referer: string): Promise<{ buf: Uint8Array; ct: string } | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Referer: referer }, signal: ctl.signal });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(ct)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 1024 || buf.byteLength > 6 * 1024 * 1024) return null;
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
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const can = await sb.rpc('seller_banner_can', { p_token: token });
  if (can.error) return J({ ok: false, msg: 'server' }, 500);
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
      const r = await fetch(u, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
      if (!r.ok) return J({ ok: false, msg: 'blocked', status: r.status });
      finalUrl = r.url || finalUrl;
      if (!safeUrl(finalUrl)) return J({ ok: false, msg: 'bad_link' }, 400);
      html = (await r.text()).slice(0, 600000);
    } catch { return J({ ok: false, msg: 'blocked' }); } finally { clearTimeout(t); }
    const title = (meta(html, ['og:title', 'twitter:title']) || (html.match(/<title[^>]*>([^<]{2,120})<\/title>/i)?.[1] || '')).replace(/\s+/g, ' ').trim().slice(0, 80);
    const desc = meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 120);
    const raw = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
    let image = '';
    if (raw) {
      let iu: URL | null = null;
      try { iu = safeUrl(new URL(raw, finalUrl).toString()); } catch { iu = null; }
      const got = iu ? await getImage(iu, finalUrl) : null;
      if (got) {
        const ext = got.ct === 'image/png' ? 'png' : got.ct === 'image/webp' ? 'webp' : 'jpg';
        const name = `tmp${sid}_${rnd()}.${ext}`;
        const up = await sb.storage.from('banners').upload('seller/' + name, got.buf, { contentType: got.ct, upsert: false });
        if (!up.error) { image = pub(name); await tidy(sb, sid, [name]); }
      }
    }
    return J({ ok: true, title, desc, image });
  }
  return J({ ok: false, msg: 'bad' }, 400);
});

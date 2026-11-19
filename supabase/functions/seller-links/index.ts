// 셀러 「내 링크」 확인·저장 — 인스타 아이디 · 인포크/리틀리 주소 (사장님 2026-11-19)
//   「인스타 핸들만 적으면 instagram.com 뒤에 붙여 그 사람 계정으로 바로 연결되는지 확인해서 자동으로 넣어줘」
//
//   POST { token, insta, bio }
//     · insta: 아이디만(@·주소 전체를 넣어도 아이디만 뽑는다) → https://www.instagram.com/<아이디>/ 를 열어 그 계정 화면인지 본다
//         제목에 「(@아이디)」가 있으면 있는 계정 · 「Instagram」뿐이면 없는 계정 · 로그인 화면으로 밀리면 「지금은 확인 못 함」
//     · bio: 인포크(link.inpock.co.kr/슬러그 · inpk.link/슬러그) · 리틀리(litt.ly/…) · 그 밖 주소 → 열리는지 보고, 그 페이지에 인스타 아이디가 적혀 있는지 본다
//     · 확인한 값은 DB seller_links_apply 가 적는다(supabase/sql/seller_links_171.sql). 아이디를 바꾸는 건 인스타에서 계정을 확인했을 때만.
//   돌려주는 것: { ok, insta, insta_state: 'same'|'ok'|'none'|'unknown', bio_state: 'ok'|'none'|'skip', bio_has_insta, saved }
// 누가: 로그인한 셀러 누구나(이웃셀러 신청 전에 채운다). 토큰은 DB 가 확인한다.
// 남의 서버를 대신 찌르지 않게: 인스타·링크 한 번씩만, http(s)·바깥 주소만, 받는 크기 제한.
// 배포: supabase functions deploy seller-links --no-verify-jwt     PC 가 꺼져도 돈다(서버).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOW = ['https://momcalendar.com', 'https://www.momcalendar.com'];
const cors = (req: Request) => {
  const o = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0], 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function get(url: string): Promise<{ status: number; url: string; html: string } | null> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ko-KR,ko;q=0.9' } });
    const html = r.ok ? (await r.text()).slice(0, 900000) : '';
    if (!r.ok) await r.body?.cancel();
    return { status: r.status, url: r.url || url, html };
  } catch { return null; } finally { clearTimeout(t); }
}
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
// 입력에서 인스타 아이디만 뽑는다: 「@abc」 「instagram.com/abc/」 「https://www.instagram.com/abc?igsh=…」 → abc
export function handleOf(v: string): string {
  let s = String(v || '').trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (m) s = m[1];
  return s.replace(/^@+/, '').replace(/[/?#].*$/, '').toLowerCase();
}
async function checkInsta(h: string): Promise<'ok' | 'none' | 'unknown'> {
  const r = await get(`https://www.instagram.com/${h}/`);
  if (!r || r.status !== 200) return r && r.status === 404 ? 'none' : 'unknown';
  if (/\/accounts\/login|\/challenge\//.test(r.url)) return 'unknown';
  const title = (r.html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/&#0?64;|&commat;/gi, '@').toLowerCase();
  const og = (r.html.match(/<meta[^>]+property=["']og:(?:url|title)["'][^>]+content=["']([^"']+)["']/i)?.[1] || '').replace(/&#0?64;/gi, '@').toLowerCase();
  if (title.includes(`(@${h})`) || og.includes(`(@${h})`) || og.includes(`instagram.com/${h}`)) return 'ok';
  if (title.trim() === 'instagram' || title.trim() === '') return r.html.length > 200000 ? 'none' : 'unknown';   // 없는 계정은 제목이 「Instagram」뿐인 온전한 페이지로 온다
  return 'unknown';
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
  const cur = await sb.rpc('seller_links_get', { p_token: token });
  if (cur.error) { const un = cur.error.code === '28000' || /unauthorized/i.test(cur.error.message || ''); return J({ ok: false, msg: un ? 'unauthorized' : 'server' }, un ? 401 : 500); }
  const curInsta = String(cur.data?.insta || '').toLowerCase();

  const h = handleOf(typeof b.insta === 'string' ? b.insta : '');
  if (!/^[a-z0-9._]{1,30}$/.test(h)) return J({ ok: false, msg: 'bad_insta' });
  // 아이디가 그대로면 인스타를 다시 찌르지 않는다
  // 🔴 실측(2026-11-19): 이 서버(해외 데이터센터)에서 인스타를 열면 로그인 화면으로 밀려 있는 계정·없는 계정을 못 가른다.
  //    그래서 여기서 못 봤다고 거절하지 않는다 — 아래에서 셀러의 링크 페이지에 그 아이디가 적혀 있으면 확정하고,
  //    아니면 DB 가 「확인 중」으로 적어 두고 PC 확인기(tools/daily/seller_insta_verify.mjs)가 인스타를 열어 반영한다.
  const instaState: 'same' | 'ok' | 'none' | 'unknown' = h === curInsta ? 'same' : await checkInsta(h);

  let bio = typeof b.bio === 'string' ? b.bio.trim() : '';
  let kind = '', slug = '', bioState: 'ok' | 'none' | 'skip' = 'skip', has = false;
  if (bio) {
    if (!/^https?:\/\//i.test(bio)) bio = 'https://' + bio;
    const u = safeUrl(bio);
    if (!u || bio.length > 300) return J({ ok: false, msg: 'bad_bio', insta: h, insta_state: instaState });
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'link.inpock.co.kr' || host === 'inpk.link') { kind = 'inpock'; slug = seg; bio = 'https://link.inpock.co.kr/' + seg; }
    else if (host === 'litt.ly') kind = 'littly';
    else kind = 'other';
    if (kind === 'inpock' && !/^[A-Za-z0-9._-]{1,60}$/.test(slug)) return J({ ok: false, msg: 'bad_bio', insta: h, insta_state: instaState });
    const r = await get(bio);
    if (!r || r.status === 404 || r.status === 410) return J({ ok: false, msg: 'bio_none', insta: h, insta_state: instaState, bio_state: 'none' });
    if (r.status === 200) { bioState = 'ok'; has = new RegExp(`instagram\\.com/${h.replace(/\./g, '\\.')}(?![A-Za-z0-9._])`, 'i').test(r.html); }
    else bioState = 'ok';     // 막혀서 내용을 못 봤다(403 등) — 저장은 하되 페이지에 아이디가 있는지는 모른다 → 관리자에게 한 줄 간다
  }
  const ap = await sb.rpc('seller_links_apply', { p_token: token, p_insta: h, p_insta_ok: instaState === 'ok' || instaState === 'same' || has, p_bio: bio, p_bio_kind: kind, p_slug: slug, p_bio_has_insta: has });
  if (ap.error) return J({ ok: false, msg: 'server' }, 500);
  if (!ap.data?.ok) return J({ ok: false, msg: ap.data?.msg || 'server', insta: h, insta_state: instaState });
  return J({ ok: true, insta: ap.data.insta || h, insta_state: instaState, insta_pending: ap.data.insta_pending || null, bio, bio_state: bioState, bio_has_insta: has, insta_changed: !!ap.data.insta_changed });
});

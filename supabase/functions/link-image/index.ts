// 판매링크 → 상품 대표이미지 자동 추출 (사장님 지시 2026-08-15)
//   "판매링크 내가 올리면 거기 상품대표이미지 받아서 알아서 배너사진 올라가게"
//
// 브라우저에서 직접 상품 페이지를 fetch 하면 CORS 로 막힌다 → 서버(Edge)에서 대신 받아온다.
// 하는 일: 링크 열기(단축주소 추적) → og:image 등에서 대표사진 주소 찾기 → 사진 받아서
//          Supabase Storage(banners 버킷)에 올리고 공개주소를 돌려준다.
//
//   POST { link: "https://..." }  →  { ok, image, from, title }
//   POST { link, probe: true }    →  올리지 않고 찾기만 (미리보기용)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const J = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// og:image → twitter:image → link rel=image_src → 본문 첫 큰 이미지 순으로 찾는다.
// ⚠ 스마트스토어·쿠팡은 og:image 를 잘 준다. 자사몰(카페24·식스샵)도 대부분 준다.
function pickImage(html: string, base: string): { url: string; from: string } | null {
  const metas: [RegExp, string][] = [
    [/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i, 'og:image'],
    [/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i, 'og:image'],
    [/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i, 'twitter:image'],
    [/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i, 'image_src'],
  ];
  for (const [re, from] of metas) {
    const m = html.match(re);
    if (m?.[1]) {
      try { return { url: new URL(m[1].replace(/&amp;/g, '&'), base).toString(), from }; } catch { /* 무시 */ }
    }
  }
  // 마지막 수단: 본문에서 상품사진처럼 보이는 큰 이미지
  const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/gi)]
    .map((m) => m[1])
    .filter((u) => !/logo|icon|sprite|blank|1x1|banner_bg/i.test(u));
  if (imgs.length) {
    try { return { url: new URL(imgs[0].replace(/&amp;/g, '&'), base).toString(), from: 'img' }; } catch { /* 무시 */ }
  }
  return null;
}

function pickTitle(html: string): string {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  return m?.[1]?.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { link, probe } = await req.json().catch(() => ({}));
    if (!link || !/^https?:\/\//i.test(String(link))) return J({ ok: false, error: '주소가 http 로 시작해야 해요' }, 400);

    // 1) 상품 페이지 받기 (단축주소는 자동으로 따라간다)
    // ⚠ 네이버·쿠팡은 데이터센터 IP + 밋밋한 헤더를 봇으로 보고 429/403 을 준다(실측 2026-08-15).
    //   진짜 브라우저처럼 보이는 헤더로 한 번, 안 되면 모바일 UA 로 한 번 더 시도한다.
    const tries: Record<string, string>[] = [
      {
        'User-Agent': UA_DESKTOP,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1', 'Cache-Control': 'no-cache',
      },
      {
        'User-Agent': UA_MOBILE,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://search.naver.com/',
      },
    ];
    let page: Response | null = null;
    let lastStatus = 0;
    for (const headers of tries) {
      const r = await fetch(String(link), { redirect: 'follow', headers });
      lastStatus = r.status;
      if (r.ok) { page = r; break; }
      await r.body?.cancel();
    }
    if (!page) {
      const host = (() => { try { return new URL(String(link)).hostname.replace(/^www\.|^m\./, ''); } catch { return ''; } })();
      return J({ ok: false, status: lastStatus, blocked: true,
        error: `${host || '이 판매처'}가 자동 수집을 막고 있어요 (${lastStatus}). 사진은 직접 올려 주세요` }, 200);
    }
    const finalUrl = page.url || String(link);
    const html = await page.text();

    const found = pickImage(html, finalUrl);
    const title = pickTitle(html);
    if (!found) return J({ ok: false, error: '이 페이지에서 대표사진을 못 찾았어요. 사진을 직접 올려 주세요', title }, 200);
    if (probe) return J({ ok: true, image: found.url, from: found.from, title, probe: true });

    // 2) 사진 내려받기
    const imgRes = await fetch(found.url, { headers: { 'User-Agent': UA_DESKTOP, Referer: finalUrl } });
    if (!imgRes.ok) return J({ ok: false, error: `사진을 못 받았어요 (${imgRes.status})`, image: found.url, title }, 200);
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!/^image\//.test(ct)) return J({ ok: false, error: '사진 형식이 아니에요', image: found.url, title }, 200);
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    if (buf.byteLength < 1024) return J({ ok: false, error: '사진이 너무 작아요', image: found.url, title }, 200);
    if (buf.byteLength > 8 * 1024 * 1024) return J({ ok: false, error: '사진이 8MB를 넘어요', image: found.url, title }, 200);

    // 3) 스토리지에 올리기 (기존 배너와 같은 버킷·이름 규칙)
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
    const path = `banner_link_${Date.now()}.${ext}`;
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const up = await sb.storage.from('banners').upload(path, buf, { contentType: ct, upsert: false });
    if (up.error) return J({ ok: false, error: '올리기 실패: ' + up.error.message, image: found.url, title }, 200);
    const pub = sb.storage.from('banners').getPublicUrl(path).data.publicUrl;

    return J({ ok: true, image: pub, source_image: found.url, from: found.from, title, bytes: buf.byteLength });
  } catch (e) {
    return J({ ok: false, error: String(e).slice(0, 200) }, 200);
  }
});

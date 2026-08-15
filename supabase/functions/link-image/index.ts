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

// 사진 주소 → 내려받아 스토리지에 올리고 공개주소 반환 (두 경로가 같이 쓴다)
async function saveImage(imgUrl: string, referer: string):
  Promise<{ ok: true; url: string; bytes: number } | { ok: false; error: string }> {
  const res = await fetch(imgUrl, { headers: { 'User-Agent': UA_DESKTOP, Referer: referer } });
  if (!res.ok) return { ok: false, error: `사진을 못 받았어요 (${res.status})` };
  const ct = res.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//.test(ct)) return { ok: false, error: '사진 형식이 아니에요 (이미지 주소가 맞는지 확인해 주세요)' };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 1024) return { ok: false, error: '사진이 너무 작아요' };
  if (buf.byteLength > 8 * 1024 * 1024) return { ok: false, error: '사진이 8MB를 넘어요' };
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
  const path = `banner_link_${Date.now()}.${ext}`;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const up = await sb.storage.from('banners').upload(path, buf, { contentType: ct, upsert: false });
  if (up.error) return { ok: false, error: '올리기 실패: ' + up.error.message };
  return { ok: true, url: sb.storage.from('banners').getPublicUrl(path).data.publicUrl, bytes: buf.byteLength };
}

function pickTitle(html: string): string {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<title[^>]*>([^<]{2,120})<\/title>/i);
  return m?.[1]?.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { link, probe, image } = await req.json().catch(() => ({}));

    // ── 사진 주소를 직접 받은 경우 (네이버·쿠팡처럼 상품 페이지가 막힌 곳의 우회로) ──
    // 상품 페이지는 봇을 막아도 이미지 CDN(pstatic.net 등)은 대부분 열려 있다(실측 2026-08-15).
    // 사장님이 상품 사진 우클릭 → '이미지 주소 복사' 한 값을 그대로 넣으면 된다.
    if (image && /^https?:\/\//i.test(String(image))) {
      const up = await saveImage(String(image), String(image));
      return J(up.ok ? { ok: true, image: up.url, from: 'direct', bytes: up.bytes } : { ok: false, error: up.error });
    }

    if (!link || !/^https?:\/\//i.test(String(link))) return J({ ok: false, error: '주소가 http 로 시작해야 해요' }, 400);

    // 판매링크 자리에 사진 주소를 넣은 경우도 알아서 처리한다
    if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(String(link))) {
      const up = await saveImage(String(link), String(link));
      if (up.ok) return J({ ok: true, image: up.url, from: 'direct', bytes: up.bytes });
    }

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

    // 2) 사진 내려받아 스토리지에 올리기
    const saved = await saveImage(found.url, finalUrl);
    if (!saved.ok) return J({ ok: false, error: saved.error, image: found.url, title }, 200);
    return J({ ok: true, image: saved.url, source_image: found.url, from: found.from, title, bytes: saved.bytes });
  } catch (e) {
    return J({ ok: false, error: String(e).slice(0, 200) }, 200);
  }
});

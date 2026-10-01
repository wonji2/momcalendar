/**
 * 🔎 gongtok-search — 네이버 **카페글 검색 API** 대리 호출 (비용 0원)
 *
 * 왜 필요한가 (사장님 지시 2026-10-01 "이전 채팅에서는 스스로 방법 찾아내서 돈 안들이고 원문 링크 읽었어 기록 뒤져"):
 *   공구톡톡 카페(clubid 31368521) 글은 **본문이 회원인증에 막혀** 못 읽는다.
 *   그런데 **네이버 카페글 검색 API 의 `description` 에 본문 앞부분이 그대로 실려 오고,
 *   거기에 셀러 인스타 핸들과 인포크 슬러그가 둘 다 있다**(2026-09-04 발견 · 사장님 2026-10-01
 *   "공구톡톡이 본문에 셀러 인스타도 같이 올리자나").
 *   → AI 도 로그인도 필요 없다. 네이버 검색 API 는 **무료**(하루 2.5만 건)다.
 *
 * 🔴 왜 Edge Function 인가: 검색 키(NAVER_CLIENT_ID/SECRET)는 **Supabase 시크릿에만** 둔다.
 *    로컬 .env 에 복사하지 않는다(메모리 chatbot-ai-live-setup 과 같은 기준).
 *    그동안 이 경로는 세션에서 MCP 로만 돌아서 **사람이 없으면 안 돌았다** —
 *    메모리 gongtok-cafe-search-standing 에 "두 번 지적받았다"고 적혀 있다. 그래서 무인화한다.
 *
 * 호출: POST { query, start?, display? }  헤더 x-caption-token (caption-extract 와 같은 토큰)
 * 응답: { total, items: [{title, link, description, cafename}] }
 */
const NAVER_ID = Deno.env.get("NAVER_CLIENT_ID");
const NAVER_SECRET = Deno.env.get("NAVER_CLIENT_SECRET");

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // 인증 — 아무나 우리 검색 쿼터를 쓰지 못하게 (caption-extract 와 같은 토큰, 시크릿에만 둔다)
  const want = Deno.env.get("CAPTION_AI_TOKEN");
  if (!want) return json({ error: "CAPTION_AI_TOKEN 미설정 — 함수를 닫는다" }, 503);
  const got = req.headers.get("x-caption-token") || "";
  let diff = got.length === want.length ? 0 : 1;
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  if (diff !== 0) return json({ error: "unauthorized" }, 401);

  if (!NAVER_ID || !NAVER_SECRET) return json({ error: "NAVER_CLIENT_ID/SECRET 미설정" }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const query = String(body?.query || "").trim();
  if (!query) return json({ error: "query 가 비었다" }, 400);
  const start = Math.min(Math.max(+(body?.start || 1), 1), 1000);
  const display = Math.min(Math.max(+(body?.display || 100), 1), 100);

  const url = `https://openapi.naver.com/v1/search/cafearticle.json?query=${encodeURIComponent(query)}`
    + `&display=${display}&start=${start}&sort=date`;
  try {
    const r = await fetch(url, { headers: { "X-Naver-Client-Id": NAVER_ID, "X-Naver-Client-Secret": NAVER_SECRET } });
    const t = await r.text();
    if (!r.ok) return json({ error: `네이버 ${r.status}`, detail: t.slice(0, 300) }, 502);
    const j = JSON.parse(t);
    // 🔑 description 에 HTML 태그(<b>)가 섞여 온다 — 벗겨서 준다(슬러그·핸들 추출이 쉬워진다)
    const strip = (s: unknown) => String(s || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d));
    return json({
      total: j.total ?? 0,
      items: (j.items || []).map((x: any) => ({
        title: strip(x.title), link: String(x.link || ""),
        description: strip(x.description), cafename: strip(x.cafename),
      })),
    });
  } catch (e) {
    return json({ error: String((e as any)?.message || e).slice(0, 200) }, 502);
  }
});

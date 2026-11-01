// 네이버 쇼핑 최저가 조회 — 핫딜 등록 전 "정말 싼가"를 검증하는 근거
//
//   ?kw=상품명            → 최저가·상위 5건
//   ?kw=상품명&price=9900 → 우리 가격과 대조해 판정까지
//
// 왜 만들었나 (사장님 지시 2026-08-19):
//   "금액 상한은 의미없지 니가 네이버나 쿠팡 검색해보고 그거보다 싼것만 올려봐"
//   지마켓·오늘의집은 페이지가 막혀 현재가 대조가 불가능했다. 네이버 검색이 그 구멍을 메운다.
//
// 시크릿: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, PUSH_CRON_SECRET
const NID = Deno.env.get("NAVER_CLIENT_ID") ?? "";
const NSEC = Deno.env.get("NAVER_CLIENT_SECRET") ?? "";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";

// 검색 정확도를 위해 상품명을 다듬는다.
//   네이버는 긴 문장을 넣으면 결과가 0건이 되기 쉽다 → 꾸밈말·괄호·용량표기를 걷어낸다.
function cleanKw(s: string): string {
  return String(s)
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")                    // [단독] (2col) 등
    .replace(/\d+\s*(개입|개|입|팩|매|병|포|캔|봉|박스|세트|장|롤|통)/g, " ") // 수량
    .replace(/\d+(\.\d+)?\s*(ml|g|kg|L|리터|미리)/gi, " ")      // 용량
    .replace(/(무료배송|무배|당일발송|최저가|특가|핫딜|초특가|증정|사은품|단독|기획전|모음전)/g, " ")
    .replace(/[+&·,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ").slice(0, 6).join(" ");                        // 6낱말까지만
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!NID || !NSEC) return Response.json({ error: "네이버 키가 없다" }, { status: 500 });

  const raw = (u.searchParams.get("kw") ?? "").trim();
  if (!raw) return Response.json({ error: "kw 가 필요하다" }, { status: 400 });
  const kw = u.searchParams.get("raw") === "1" ? raw : cleanKw(raw);
  const ourPrice = Number(u.searchParams.get("price") ?? 0);

  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(kw)}&display=20&sort=asc`;
  const r = await fetch(url, {
    headers: { "X-Naver-Client-Id": NID, "X-Naver-Client-Secret": NSEC },
  });
  const txt = await r.text();
  if (!r.ok) return Response.json({ error: "naver " + r.status, body: txt.slice(0, 300) }, { status: 502 });

  let j: any = null;
  try { j = JSON.parse(txt); } catch { return Response.json({ error: "파싱 실패" }, { status: 502 }); }

  const items = (j.items ?? []).map((x: any) => ({
    title: String(x.title ?? "").replace(/<[^>]*>/g, ""),
    price: Number(x.lprice) || 0,
    mall: x.mallName ?? "",
    link: x.link ?? "",
  })).filter((x: any) => x.price > 0);

  const lowest = items.length ? Math.min(...items.map((x: any) => x.price)) : 0;
  const out: any = {
    원본: raw, 검색어: kw, 결과수: items.length,
    네이버최저가: lowest || null,
    상위: items.slice(0, 5),
  };

  if (ourPrice > 0) {
    if (!lowest) {
      out.판정 = "확인불가";
      out.사유 = "네이버 검색 결과가 없다 — 근거를 만들 수 없으므로 등록하지 않는 편이 안전하다";
    } else {
      const diff = lowest - ourPrice;
      out.차액 = diff;
      out.판정 = diff > 0 ? "✅ 우리가 싸다" : (diff === 0 ? "= 같다" : "❌ 네이버가 싸다");
      out.할인율 = diff > 0 ? Math.round((diff / lowest) * 100) : 0;
    }
  }
  return Response.json(out);
});

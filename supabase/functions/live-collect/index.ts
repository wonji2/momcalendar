// ══════════════════════════════════════════════════════════
//  live-collect  —  네이버 쇼핑라이브 편성표(라방 일정)를 live_shows 에 쌓는다 (2026-10-24 사장님
//                   「세일/라방 … 토글에 라방 일정도 따로 보게 · 라방 내용도 우리도 수집해서 그대로 다 넣어」)
//
//  원천  shoppinglive.naver.com/calendar 화면이 부르는 공개 편성표 API (로그인 없음)
//        GET https://apis.naver.com/selectiveweb/live_commerce_web/v1/calendar/broadcast/timeline/current?timestamp=<그날 0시 ms>&categoryId=dc:N&size=10
//            → currentBroadcast · prevBroadcasts.list · nextBroadcasts.{list,next}   (next 가 있으면 …/timeline/next?timestamp=<next>)
//        헤더 apigw-routing-key: real-home-api (화면의 LIVE_API_GW_ROUTING_KEY) · Referer/Origin shoppinglive
//        분류 9개(dc:1 뷰티 … dc:9 문화생활) × 오늘부터 7일. 경쟁사 공구베이비(09baby)도 같은 원천(키즈) — 2026-10-24 대조
//  규칙  제목·상품명은 원본 그대로(0-S-원본). 방송 번호로 덮어쓴다(제목·시각이 바뀌면 따라간다). 30일 지난 방송은 지운다.
//        네이버를 세게 두드리지 않는다 — 요청 사이 350ms, 한 회차 요청 상한 MAX_REQ. 막히면(4xx/5xx 연속 3번) 그 회차는 멈춘다.
//  호출  POST /functions/v1/live-collect  헤더 x-cron-secret   ?dry=1 저장 없이 건수만  ?days=7  ?cats=dc:6
//  주기  pg_cron `live-collect` KST 02:10·08:10·14:10·20:10 — supabase/sql/live_shows_101.sql
//  ⚠ 0건 = 원천 구조가 바뀐 것일 수 있다(수확 0건 ≠ 방송 없음). 응답의 errors·pages 를 본다.
// ══════════════════════════════════════════════════════════
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const API = "https://apis.naver.com/selectiveweb/live_commerce_web/v1/calendar/broadcast/timeline";
const H = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
  "apigw-routing-key": "real-home-api",
  Referer: "https://shoppinglive.naver.com/calendar",
  Origin: "https://shoppinglive.naver.com",
  Accept: "application/json",
};
const CATS: [string, string][] = [["dc:1", "뷰티"], ["dc:2", "푸드"], ["dc:3", "패션"], ["dc:4", "라이프"], ["dc:5", "여행/체험"], ["dc:6", "키즈"], ["dc:7", "테크"], ["dc:8", "취미레저"], ["dc:9", "문화생활"]];
const MAX_REQ = 400, GAP = 300;   // 9분류×7일×(현재 1 + 다음·이전 쪽) ≈ 130~200회 · 350ms 간격 ≈ 70초(Edge 150초 안)
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// expectedStartDate 는 「2026-10-24T14:00:00」 꼴의 한국 시각(시간대 표기 없음) → +09:00 으로 읽는다
const kst = (s: string | null | undefined) => (s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "+09:00") : null);

function row(x: any, cat: string) {
  const b = x?.broadcast; if (!b?.id || !b.expectedStartDate || !b.title) return null;
  const prods = (x.shoppingProducts || []).slice(0, 3).map((p: any) => ({ name: p.name, price: p.price ?? null, discountRate: p.discountRate ?? null, image: p.image ?? null, mall: p.mallName ?? null }));
  const bens = (x.benefits || []).slice(0, 3).map((e: any) => ({ message: e.message ?? null, detail: e.detailMessage ?? null }));
  return {
    id: b.id, title: String(b.title).trim(), description: b.description ?? null,
    channel_name: x.owner?.name ?? null, channel_id: x.owner?.id ?? null, category: cat,
    start_at: kst(b.expectedStartDate), status: b.status ?? null,
    image_url: x.bridge?.backgroundImageUrl || b.standByImageUrl || b.standByThumbnailImageUrl || null,
    link_url: `https://shoppinglive.naver.com/livebridge/${b.id}`,
    products: prods, benefits: bens,
    // 화면용 가벼운 칸 — 사이트는 이것만 읽는다(무료 플랜 전송량. products·benefits 전체는 144KB/회였다)
    prod_name: prods[0]?.name ?? null, prod_price: prods[0]?.price ?? null, prod_rate: prods[0]?.discountRate ?? null,
    benefit: bens[0]?.message ? String(bens[0].message).replace(/^[\s📢🎁👉]+/u, "").slice(0, 60) : null,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);
  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const days = Math.min(10, Math.max(1, Number(u.searchParams.get("days") || 7)));
  const only = (u.searchParams.get("cats") || "").split(",").filter(Boolean);
  const cats = only.length ? CATS.filter(([id]) => only.includes(id)) : CATS;
  const today0 = Date.parse(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + "T00:00:00+09:00");
  const rows = new Map<number, any>(); const errors: string[] = []; let reqN = 0, fails = 0, pages = 0;
  const get = async (path: string) => {
    if (reqN >= MAX_REQ || fails >= 3) return null;
    reqN++; await sleep(GAP);
    try { const r = await fetch(API + path, { headers: H }); if (!r.ok) { fails++; errors.push(`${r.status} ${path.slice(0, 90)}`); return null; } fails = 0; return await r.json(); }
    catch (e) { fails++; errors.push(`err ${String(e).slice(0, 60)}`); return null; }
  };
  // 🔴 2026-10-24 검증: 다음 쪽 인자는 `next=<커서>`, 이전 쪽은 `/previous?prev=<커서>` 다(화면 번들 그대로). 처음에 `timestamp=` 로 불러
  //    분류×날짜마다 11건에서 끊겼다(10-27 편성표 137건 중 69건). 쪽 크기는 30까지 된다(31↑ 는 400)
  const SIZE = 30;
  const add = (list: any[], cname: string) => { for (const x of list || []) { const r = row(x, cname); if (r && !rows.has(r.id)) rows.set(r.id, r); } };
  outer: for (const [cid, cname] of cats) {
    for (let d = 0; d < days; d++) {
      const t0 = today0 + d * 864e5, cq = `categoryId=${encodeURIComponent(cid)}&size=${SIZE}`;
      const j: any = await get(`/current?timestamp=${t0}&${cq}`);
      if (fails >= 3 || reqN >= MAX_REQ) break outer;
      if (!j) continue;
      pages++;
      add([j.currentBroadcast, ...(j.prevBroadcasts?.list || []), ...(j.nextBroadcasts?.list || [])], cname);
      for (const [path, key, start] of [["/next", "next", j.nextBroadcasts?.next], ["/previous", "prev", j.prevBroadcasts?.prev]] as [string, string, string][]) {
        let cur = start, k = 0;
        while (cur && k < 10) {
          const n: any = await get(`${path}?${key}=${encodeURIComponent(cur)}&${cq}`);
          if (!n) break; pages++; k++;
          add(n.list, cname);
          cur = n[key];
        }
      }
    }
  }
  if (reqN >= MAX_REQ) errors.push(`요청 상한 ${MAX_REQ} 에 닿아 뒤쪽 분류·날짜를 못 받았다`);
  const list = [...rows.values()];
  const byCat: Record<string, number> = {}; for (const r of list) byCat[r.category] = (byCat[r.category] || 0) + 1;
  if (dry) return json({ ok: true, dry: true, total: list.length, byCat, reqN, pages, errors: errors.slice(0, 10), sample: list.slice(0, 3) });
  let saved = 0;
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const r = await fetch(`${SB_URL}/rest/v1/live_shows?on_conflict=id`, {
      method: "POST", headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(part),
    });
    if (r.ok) saved += part.length; else errors.push(`save ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  // 30일 지난 방송 정리
  const cut = new Date(Date.now() - 30 * 864e5).toISOString();
  await fetch(`${SB_URL}/rest/v1/live_shows?start_at=lt.${encodeURIComponent(cut)}`, { method: "DELETE", headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, Prefer: "return=minimal" } });
  return json({ ok: errors.length === 0 || saved > 0, total: list.length, saved, byCat, reqN, pages, errors: errors.slice(0, 10) });
});

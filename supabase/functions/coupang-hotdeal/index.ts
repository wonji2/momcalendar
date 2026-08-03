// 쿠팡 파트너스 → 가격 추적 → 역대최저가 판정 → hotdeals 자동 등록
//
//   ?test=1&kw=기저귀   → 검색 API 원본 응답 확인 (판정/등록 안 함)
//   ?test=goldbox       → 골드박스 원본 응답 확인
//   ?dry=1              → 수집·판정만 하고 등록은 안 함 (미리보기)
//   (헤더 x-cron-secret 필요, 단 test/dry 도 동일)
//
// 시크릿: COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY, PUSH_CRON_SECRET
//         SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (플랫폼 기본 제공)

const HOST = "https://api-gateway.coupang.com";
const BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1";

const ACCESS = Deno.env.get("COUPANG_ACCESS_KEY") ?? "";
const SECRET = Deno.env.get("COUPANG_SECRET_KEY") ?? "";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── 핫딜 판정 기준 ──────────────────────────────────────────
const MIN_POINTS = 7;      // 이력이 최소 7일은 쌓여야 판정
const LOOKBACK   = 90;     // 최근 90일 기준
const MIN_DROP   = 0.10;   // 역대최저 + 평균 대비 최소 10% 저렴
const BIG_DROP   = 0.25;   // 역대최저 아니어도 평균 대비 25% 이상이면 핫딜
const MAX_PER_RUN = 12;    // 하루 최대 등록 건수 (도배 방지)

// 골드박스 = 쿠팡이 직접 고른 '오늘의 특가'.
// 우리 가격이력이 없는 초기에도 게시판을 채울 수 있고, 근거는 "쿠팡 선정"으로 정직하게 표기한다.
const MAX_GOLD = 8;
// 사이트 대분류에 맞춰 넓게 받는다(사장님 방침: 대분류는 넓을수록 좋다).
// 여기에 없는 카테고리(자동차용품 등)만 버린다.
const GOLD_CAT: Record<string, [string, string]> = {
  "출산/유아": ["육아", "육아용품"],
  "출산/유아동": ["육아", "육아용품"],
  "유아동": ["육아", "육아용품"],
  "베이비패션": ["육아", "의류잡화"],
  "완구/취미": ["육아", "장난감/놀이"],
  "도서/음반/DVD": ["육아", "책"],
  "식품": ["식품", "가공식품"],
  "생활용품": ["생필품", "생활용품"],
  "주방용품": ["생필품", "주방용품"],
  "문구/오피스": ["생필품", "생활용품"],
  "헬스/건강식품": ["건강", "건강식품"],
  "뷰티": ["뷰티", "화장품"],
  "홈인테리어": ["인테리어", "홈데코"],
  "가전디지털": ["가전", "생활가전"],
  "여성패션": ["패션", "여성의류"],
  "남성패션": ["패션", "남성의류"],
  "스포츠/레저": ["리빙", "레저"],
  "반려동물용품": ["반려동물", "반려용품"],
};

// ── 쿠팡 HMAC 서명 ─────────────────────────────────────────
function signedDate(): string {
  // yyMMddTHHmmssZ (GMT)
  const d = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return d.substring(2); // 250803T091500Z
}
async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function cpFetch(path: string, query = ""): Promise<any> {
  const dt = signedDate();
  const sig = await hmacHex(SECRET, dt + "GET" + path + query);
  const auth =
    `CEA algorithm=HmacSHA256, access-key=${ACCESS}, signed-date=${dt}, signature=${sig}`;
  const url = HOST + path + (query ? "?" + query : "");
  const r = await fetch(url, { headers: { Authorization: auth } });
  const txt = await r.text();
  let json: any = null;
  try { json = JSON.parse(txt); } catch { /* ignore */ }
  if (!r.ok) return { _httpStatus: r.status, _raw: txt.slice(0, 800) };
  return json ?? { _raw: txt.slice(0, 800) };
}
const cpSearch  = (kw: string, limit = 10) =>   // ⚠ 쿠팡 검색 API는 limit 20 이상 거부("limit is out of range")
  cpFetch(BASE + "/products/search", `keyword=${encodeURIComponent(kw)}&limit=${limit}`);
const cpGoldbox = () => cpFetch(BASE + "/products/goldbox");

// ── Supabase REST ──────────────────────────────────────────
async function sb(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SB_SRK,
      Authorization: "Bearer " + SB_SRK,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 204) return null;
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
const seoulToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function won(n: number) { return n.toLocaleString("ko-KR") + "원"; }

// ── 메인 ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!ACCESS || !SECRET) {
    return Response.json({ error: "COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY 미설정" }, { status: 500 });
  }

  // ── 진단 모드 ──
  const test = u.searchParams.get("test");
  if (test === "goldbox") return Response.json(await cpGoldbox());
  if (test) return Response.json(await cpSearch(u.searchParams.get("kw") ?? "기저귀", 5));

  const dry = u.searchParams.get("dry") === "1";
  const today = seoulToday();
  const log: any = { today, dry, keywords: 0, scanned: 0, tracked: 0, deals: [], errors: [] };

  // 1) 키워드별 상품 수집
  const kws = await sb("coupang_keywords?select=keyword,major,minor&active=eq.true");
  if (!Array.isArray(kws)) return Response.json({ error: "keywords 조회 실패", detail: kws }, { status: 500 });
  log.keywords = kws.length;

  type Prod = { id: string; name: string; price: number; url: string; img: string;
                major: string; minor: string; keyword: string; rocket: boolean };
  const found = new Map<string, Prod>();

  for (const k of kws) {
    try {
      const res = await cpSearch(k.keyword);
      const list = res?.data?.productData ?? [];
      if (!Array.isArray(list) || !list.length) {
        if (log.errors.length < 3) {                      // 원인 파악용으로 앞 3건만 본문 보관
          log.errors.push({ kw: k.keyword, status: res?._httpStatus, raw: res?._raw ?? res });
        } else {
          log.errors.push({ kw: k.keyword, status: res?._httpStatus ?? res?.rCode ?? "empty" });
        }
        continue;
      }
      for (const p of list) {
        // ⚠ 같은 productId 에 옵션(itemId)이 여러 개 = 가격이 다름 → 둘을 합쳐야 이력이 안 섞임
        const itemId = (String(p.productUrl || "").match(/[?&]itemId=(\d+)/) ?? [])[1] ?? "0";
        const id = `${p.productId}_${itemId}`;
        if (found.has(id)) continue;
        const price = Number(p.productPrice);
        if (!price || price < 1000) continue;
        found.set(id, {
          id, name: String(p.productName || "").slice(0, 200), price,
          url: p.productUrl, img: p.productImage,
          major: k.major, minor: k.minor, keyword: k.keyword,
          rocket: !!p.isRocket,
        });
      }
    } catch (e) { log.errors.push({ kw: k.keyword, err: String(e) }); }
    await new Promise((r) => setTimeout(r, 400));   // 쿠팡 호출 간격 (스로틀 회피)
  }

  // 1-b) 골드박스(쿠팡 오늘의 특가) — 우리 관심 카테고리만
  const goldIds: string[] = [];
  try {
    const g = await cpGoldbox();
    const glist = Array.isArray(g?.data) ? g.data : [];
    log.goldboxTotal = glist.length;
    for (const p of glist) {
      const cat = GOLD_CAT[String(p.categoryName || "")];
      if (!cat) continue;                                  // 로봇청소기·전자기기 등은 제외
      const itemId = (String(p.productUrl || "").match(/[?&]itemId=(\d+)/) ?? [])[1] ?? "0";
      const id = `${p.productId}_${itemId}`;
      const price = Number(p.productPrice);
      if (!price || price < 1000) continue;
      goldIds.push(id);
      if (!found.has(id)) {
        found.set(id, {
          id, name: String(p.productName || "").slice(0, 200), price,
          url: p.productUrl, img: p.productImage,
          major: cat[0], minor: cat[1], keyword: "골드박스", rocket: !!p.isRocket,
        });
      } else {
        const f = found.get(id)!; f.major = cat[0]; f.minor = cat[1];
      }
    }
  } catch (e) { log.errors.push({ kw: "goldbox", err: String(e) }); }
  log.goldbox = goldIds.length;

  log.scanned = found.size;
  if (!found.size) return Response.json({ ...log, note: "수집 0건 — 쿠팡 API 응답 확인 필요(?test=1)" });

  // 2) 오늘 가격 기록 + 감시목록 갱신
  const prods = [...found.values()];
  await sb("price_history?on_conflict=product_id,day", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(prods.map((p) => ({ product_id: p.id, day: today, price: p.price }))),
  });
  await sb("coupang_watch?on_conflict=product_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(prods.map((p) => ({
      product_id: p.id, name: p.name, keyword: p.keyword, major: p.major, minor: p.minor,
    }))),
  });
  log.tracked = prods.length;

  // 3) 이력 조회 → 판정
  const since = new Date(Date.now() + 9 * 3600e3 - LOOKBACK * 864e5).toISOString().slice(0, 10);
  const ids = prods.map((p) => p.id);
  const hist: Record<string, { day: string; price: number }[]> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200).map((x) => `"${x}"`).join(",");
    const rows = await sb(
      `price_history?select=product_id,day,price&day=gte.${since}&product_id=in.(${chunk})`,
    );
    if (Array.isArray(rows)) {
      for (const r of rows) (hist[r.product_id] ??= []).push({ day: r.day, price: r.price });
    }
  }

  const cands: any[] = [];
  for (const p of prods) {
    const h = (hist[p.id] ?? []).filter((x) => x.day < today);
    if (h.length < MIN_POINTS) continue;                 // 이력 부족 → 아직 판정 안 함
    const prices = h.map((x) => x.price);
    const lowest = Math.min(...prices);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const dropVsAvg = (avg - p.price) / avg;
    const isLowest = p.price <= lowest;

    let reason = "";
    if (isLowest && dropVsAvg >= MIN_DROP) {
      reason = `추적 ${h.length}일 중 최저가 · 평소(${won(avg)})보다 ${Math.round(dropVsAvg * 100)}% 저렴`;
    } else if (dropVsAvg >= BIG_DROP) {
      reason = `평소(${won(avg)})보다 ${Math.round(dropVsAvg * 100)}% 저렴`;
    } else continue;

    cands.push({
      ...p, avg, lowest, isLowest, reason,
      discount: Math.round(dropVsAvg * 100), points: h.length,
    });
  }
  cands.sort((a, b) => b.discount - a.discount);
  const picks: any[] = cands.slice(0, MAX_PER_RUN).map((p) => ({ ...p, src: "coupang" }));
  log.candidates = cands.length;

  // 이력 판정에 걸리지 않은 골드박스 건은 '쿠팡 선정 특가'로 채운다
  // (우리 할인율 주장은 안 하고, 가격이력이 쌓이면 같은 카드에 그래프가 붙는다)
  const already = new Set(picks.map((p) => p.id));
  const golds = goldIds
    .filter((id) => !already.has(id))
    .map((id) => found.get(id)!)
    .filter(Boolean)
    .slice(0, MAX_GOLD)
    .map((p) => ({ ...p, avg: null, isLowest: false, discount: null, src: "goldbox" }));
  picks.push(...golds);
  log.goldPicked = golds.length;

  log.deals = picks.map((p) => ({
    name: p.name, price: p.price, avg: p.avg, discount: p.discount,
    lowest: p.isLowest, src: p.src,
  }));

  if (dry || !picks.length) return Response.json(log);

  // 4) hotdeals 등록 (같은 상품 같은 날 중복은 유니크 인덱스가 막음)
  const ins = await sb("hotdeals?on_conflict=product_id,deal_day", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(picks.map((p) => ({
      title: p.name,
      link: p.url,
      major: p.major,
      minor: p.minor,
      price: p.price,
      price_before: p.avg,
      discount_rate: p.discount,
      img_url: p.img,
      source: p.src,
      product_id: p.id,
      is_lowest: p.isLowest,
      deal_day: today,
      expires_at: new Date(Date.now() + 3 * 864e5).toISOString(),
    }))),
  });
  log.inserted = Array.isArray(ins) ? ins.length : 0;
  if (!Array.isArray(ins)) log.insertError = ins;   // 조용히 0건 되는 것 방지
  return Response.json(log);
});

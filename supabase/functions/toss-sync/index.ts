// 토스쇼핑 쉐어링크 연동 (사장님 지시 2026-08-06)
//
// ⚠ 토스는 등록된 출발지 IP(3.39.214.69 = DB 서버)에서만 호출을 받는다.
//   Edge Function 은 나갈 때마다 IP 가 바뀌므로, 바깥 통신은 전부 DB(toss_http)에 맡긴다.
//   여기서는 로직만 짠다.
const SB   = Deno.env.get("SUPABASE_URL")!;
const KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AK   = Deno.env.get("TOSS_ACCESS_KEY") ?? "";
const SK   = Deno.env.get("TOSS_SECRET_KEY") ?? "";
const PUB  = Deno.env.get("TOSS_PUBLISHER_ID") ?? "";
const BASE = "https://sharelink.toss.im/openapi";
const OAUTH = "https://oauth2.cert.toss.im/token";

async function rpc(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn} ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { return t; }
}
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
               ...(init.headers ?? {}) },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

// DB 가 보낸 요청의 응답이 올 때까지 기다렸다 읽는다
async function wait(reqId: number, maxMs = 22000) {
  const step = 700;
  for (let i = 0; i * step < maxMs; i++) {
    await new Promise((r) => setTimeout(r, step));
    const rows = await rpc("toss_http_result", { p_id: reqId });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row?.content != null) {
      let body: any = null;
      try { body = JSON.parse(row.content); } catch { body = row.content; }
      return { status: row.status as number, body };
    }
  }
  throw new Error(`응답 없음 (reqId=${reqId})`);
}

async function call(method: string, path: string, token: string, body?: unknown, waitMs?: number) {
  const id = await rpc("toss_http", {
    p_method: method,
    p_url: BASE + path,
    p_headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    p_body: body ? JSON.stringify(body) : null,
  });
  // ⚠ pg_net 은 커밋 뒤 백그라운드 워커가 보내서 지연이 있다.
  //   상세조회를 여러 건 묶으면 22초를 넘긴다(실측 25초) → 필요한 곳은 넉넉히 준다.
  return wait(Number(id), waitMs ?? 22000);
}

// 토큰을 저장해 두고 재사용한다(문서: 매번 재발급하지 말 것 — 과도하면 이용 제한).
// ⚠ 문서 예시에는 expires_in 이 31535999(약 1년)로 적혀 있지만 실제로는 **1시간**이 온다(실측 2026-08-06).
//   여유를 1시간으로 두면 항상 '곧 만료'로 판정돼 매 호출마다 재발급하게 된다 → 5분으로 좁힌다.
async function getToken(force = false): Promise<string> {
  if (!force) {
    const rows = await sb("toss_token?select=access_token,expires_at&id=eq.1");
    const t = Array.isArray(rows) ? rows[0] : null;
    if (t?.access_token && new Date(t.expires_at).getTime() > Date.now() + 300e3) return t.access_token;
  }
  const form = `grant_type=client_credentials&client_id=${encodeURIComponent(AK)}` +
               `&client_secret=${encodeURIComponent(SK)}` +
               `&scope=${encodeURIComponent("sharelink:read sharelink:write")}`;
  // 인증 서버(oauth2.cert.toss.im)는 pg_net 이 form 본문을 못 보내서 여기서 직접 부른다.
  // IP 제한은 sharelink API 쪽에만 걸려 있는지 여기서 확인된다.
  const tr = await fetch(OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const ttxt = await tr.text();
  let tbody: any = null;
  try { tbody = JSON.parse(ttxt); } catch { tbody = ttxt; }
  const res = { status: tr.status, body: tbody };
  const tok = res.body?.access_token;
  if (!tok) throw new Error(`토큰 발급 실패 ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  const exp = new Date(Date.now() + (Number(res.body.expires_in ?? 86400) - 600) * 1000).toISOString();
  await sb("toss_token?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ id: 1, access_token: tok, expires_at: exp, updated_at: new Date().toISOString() }]),
  });
  return tok;
}


// ─────────── 하루특가 수집 → 핫딜 등록 ───────────
// 토스는 할인율을 주므로 가격이력 없이도 그날 바로 판정할 수 있다.
// 동시에 매일 같은 상품을 다시 조회할 수 있어 이력도 쌓인다(쿠팡은 둘 다 안 된다).
const T_MIN_DROP = 30;      // 사장님 지시(2026-08-06): 찐핫딜만. 30% 미만은 안 올린다
const T_MAX_DROP = 70;      // 이 이상은 정가 뻥튀기 의심
const T_MAX_PRICE = 150000;
const T_MAX_PER_RUN = 12;   // 하루 상한(도배 방지)

const T_CAT: [RegExp, string, string][] = [
  [/기저귀|분유|이유식|아기|유아|젖병|유모차|카시트|아동|키즈|어린이|장난감|물티슈/, "육아", "육아용품"],
  [/유산균|오메가|비타민|홍삼|루테인|콜라겐|영양제|프로바이오|밀크씨슬|단백질|프로틴/, "건강", "건강식품"],
  [/라면|과자|음료|커피|생수|한우|삼겹|쌀|즉석|간편식|반찬|견과|과일|우유|만두|김치|닭가슴살|베이글|치즈|두유|볶음밥|돼지|소고기/, "식품", "가공식품"],
  [/휴지|세제|섬유유연제|샴푸|치약|칫솔|세정|위생|마스크팩?|락스|수세미|지퍼백|비닐장갑/, "생필품", "생활용품"],
  [/스킨케어|스킨토너|로션|크림|앰플|에센스|선크림|쿠션|틴트|립스틱|향수|클렌징|토너/, "뷰티", "화장품"],
  [/청소기|밥솥|에어프라이어|냉장고|세탁기|건조기|이어폰|노트북|모니터|선풍기|가습기|정수기/, "가전", "생활가전"],
  [/강아지|고양이|사료|반려|펫/, "반려동물", "반려용품"],
  [/수납|매트|이불|베개|커튼|블라인드|행거|정리함|러그/, "리빙", "홈리빙"],
];
const T_BLOCK = /브라(자|렛)?[\s\-(]|팬티|속옷|보정속옷|성인|담배|전자담배|주류|와인|위스키|상품권|기프티콘/;
const T_LUXURY = /루이비통|샤넬|구찌|프라다|디올|에르메스|버버리|보테가|셀린느|생로랑|발렌시아가|몽클레어|명품/;
function tCat(name: string): [string, string] | null {
  if (T_BLOCK.test(name) || T_LUXURY.test(name)) return null;
  for (const [re, a, b] of T_CAT) if (re.test(name)) return [a, b];
  return ["리빙", "생활용품"];
}
// 같은 상품이 이름만 조금 달라 두 번 올라가는 걸 막는다(콜라가 여기저기서 올라오면 안 된다)
function baseKey(name: string): string {
  return String(name)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+\s*(개입|개|입|매|팩|박스|세트|종|ml|ML|g|G|kg|KG|L)\b/g, " ")
    .replace(/[^가-힣A-Za-z0-9]/g, "")
    .toLowerCase().slice(0, 12);
}

async function collectDeals(token: string, dry: boolean) {
  const log: any = { fetched: 0, passed: 0, picked: 0, skipped: [] as string[], deals: [] as any[] };
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  const r = await call("GET", "/products/today-deals?size=50", token);
  const items: any[] = r.body?.success?.items ?? [];
  log.fetched = items.length;

  // 1) 필터 + 중복 제거
  const seen = new Set<string>();
  const cands: any[] = [];
  for (const p of items) {
    const name = String(p.displayName ?? "");
    const price = Number(p.displayPrice ?? 0);
    const org = Number(p.originalPrice ?? 0);
    const drop = Number(p.discountRate ?? 0);
    if (!name || !price || p.isSoldOut) continue;
    if (drop < T_MIN_DROP || drop > T_MAX_DROP) continue;
    if (price > T_MAX_PRICE) continue;
    const cat = tCat(name);
    if (!cat) continue;
    const k = baseKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push({ id: String(p.tacaItemId), name, price, org, drop, cat,
                 img: p.thumbnailUrl ?? "", endAt: p.endAt ?? null });
  }
  log.passed = cands.length;
  cands.sort((a, b) => b.drop - a.drop);

  // 2) 공구로 파는 상품은 핫딜에서 뺀다 (사장님 지시)
  const gg = await sb(`gonggu?select=name&approved=eq.true&open_date=gte.${today}`);
  const ggKeys = new Set((Array.isArray(gg) ? gg : []).map((g: any) => baseKey(g.name)));
  // 3) 최근에 올린 것과 겹치지 않게
  const recent = await sb(`hotdeals?select=product_id,title&deal_day=gte.${
    new Date(Date.now() + 9 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10)}`);
  const recentIds = new Set((Array.isArray(recent) ? recent : []).map((h: any) => h.product_id));
  const recentKeys = new Set((Array.isArray(recent) ? recent : []).map((h: any) => baseKey(h.title)));

  const picks: any[] = [];
  for (const c of cands) {
    if (picks.length >= T_MAX_PER_RUN) break;
    if (ggKeys.has(baseKey(c.name))) { log.skipped.push(`공구중복:${c.name.slice(0, 20)}`); continue; }
    if (recentIds.has(`toss_${c.id}`) || recentKeys.has(baseKey(c.name))) {
      log.skipped.push(`최근등록:${c.name.slice(0, 20)}`); continue;
    }
    picks.push(c);
  }

  // 4) 가격 이력은 통과 여부와 무관하게 전부 남긴다(이래야 이력이 쌓인다)
  if (!dry && cands.length) {
    await sb("price_history?on_conflict=product_id,day", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(cands.map((c) => ({ product_id: `toss_${c.id}`, day: today, price: c.price }))),
    });
  }

  // 5) 쉐어링크 발급 후 등록
  for (const c of picks) {
    let link = "";
    if (!dry) {
      const lr = await call("POST", "/links", token, { tacaItemId: Number(c.id), publisherId: PUB });
      link = lr.body?.success?.shortUrl ?? "";
      if (!link) { log.skipped.push(`링크실패:${c.name.slice(0, 20)}`); continue; }
    }
    const row = {
      title: c.name, link, major: c.cat[0], minor: c.cat[1],
      price: c.price, price_before: c.org, discount_rate: c.drop,
      img_url: c.img, source: "toss", product_id: `toss_${c.id}`,
      is_lowest: false, deal_day: today, mall: "토스쇼핑",
      expires_at: c.endAt,
    };
    log.deals.push({ name: c.name, price: c.price, drop: c.drop, link });
    if (!dry) {
      await sb("hotdeals?on_conflict=product_id,deal_day", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([row]),
      });
    }
  }
  log.picked = log.deals.length;
  return log;
}

// ─────────── 링크 붙여넣기 → 우리 수익 링크로 변환 ───────────
// 사장님이 어디서든 받은 핫딜 링크를 넣으면 상품을 알아내 우리 링크로 바꿔 준다.
// (사장님 지시 2026-08-06)
//
// ⚠ 임의 주소를 서버가 따라가면 내부망을 훔쳐볼 수 있는 구멍(SSRF)이 된다.
//   그래서 사설망·로컬 주소는 막고, 따라가는 횟수도 제한한다.
const BAD_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i;
function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (BAD_HOST.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

// 중계 페이지·단축링크를 몇 단계 따라가며 '상품 식별자'를 찾는다
async function resolveOne(raw: string) {
  const first = safeUrl(raw);
  if (!first) return { input: raw, error: "주소 형식이 아니다" };

  let url = first;
  let html = "";
  for (let hop = 0; hop < 3; hop++) {
    // 토스 상품 주소를 만나면 끝
    let m = url.match(/toss\.shopping\/([ti])\/(\d+)/);
    if (m) return { input: raw, kind: "toss", idKind: m[1] === "i" ? "item" : "taca", id: m[2] };
    // 쿠팡 상품 주소를 만나면 끝
    m = url.match(/coupang\.com\/vp\/products\/(\d+)/);
    if (m) {
      const it = url.match(/itemId=(\d+)/);
      return { input: raw, kind: "coupang", productId: m[1], itemId: it ? it[1] : "" };
    }

    let r: Response;
    try { r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" }); }
    catch (e) { return { input: raw, error: "열 수 없다: " + String(e).slice(0, 60) }; }
    if (r.url && r.url !== url) {
      const s = safeUrl(r.url);
      if (s) { url = s; continue; }              // 리다이렉트된 주소로 다시 판단
    }
    html = await r.text();

    // 쿠팡 딥링크 중계 페이지: 스크립트 안에 productId/itemId 가 있다
    let pm = html.match(/productId.{0,6}?(\d{6,})/);
    let im = html.match(/itemId.{0,6}?(\d{6,})/);
    if (pm) return { input: raw, kind: "coupang", productId: pm[1], itemId: im ? im[1] : "" };
    // 토스 주소가 본문에 있는 경우
    const tm = html.match(/toss\.shopping\/([ti])\/(\d+)/);
    if (tm) return { input: raw, kind: "toss", idKind: tm[1] === "i" ? "item" : "taca", id: tm[2] };
    // 커뮤니티 글이면 안에 들어 있는 판매 링크로 한 단계 더 들어간다
    const nx = html.match(/https:\/\/(?:link\.coupang\.com\/a\/[A-Za-z0-9]+|toss\.im\/_m\/[A-Za-z0-9]+)/);
    if (nx) { const s = safeUrl(nx[0]); if (s) { url = s; continue; } }
    break;
  }
  return { input: raw, error: "상품을 못 찾았다(링크 안에 판매 주소가 없음)" };
}

async function convertLinks(token: string, raws: string[]) {
  const found = await Promise.all(raws.slice(0, 15).map(resolveOne));
  const out: any[] = [];

  // ① 토스 — 상세 정보(이름·가격·이미지)까지 한 번에 받아온다
  const tossTaca = found.filter((f: any) => f.kind === "toss" && f.idKind === "taca").map((f: any) => f.id);
  const tossItem = found.filter((f: any) => f.kind === "toss" && f.idKind === "item").map((f: any) => f.id);
  const detail: Record<string, any> = {};
  for (const [ids, key] of [[tossTaca, "tacaIds"], [tossItem, "tacaItemIds"]] as [string[], string][]) {
    if (!ids.length) continue;
    const r = await call("GET", `/products/detail?${key}=${ids.join(",")}`, token);
    for (const it of (r.body?.success?.items ?? [])) {
      detail[String(it.tacaId)] = it;
      detail[String(it.tacaItemId)] = it;
    }
  }

  // ② 쿠팡 — 여러 개를 한 번에 딥링크로 (호출 1회)
  const cpUrls = found.filter((f: any) => f.kind === "coupang")
    .map((f: any) => `https://www.coupang.com/vp/products/${f.productId}` + (f.itemId ? `?itemId=${f.itemId}` : ""));
  const cpMap: Record<string, string> = {};
  if (cpUrls.length) {
    const rr = await fetch(`${SB}/functions/v1/coupang-hotdeal?deeplink=${encodeURIComponent(cpUrls.join("|"))}`, {
      headers: { "x-cron-secret": Deno.env.get("PUSH_CRON_SECRET") ?? "" },
    });
    const jj = await rr.json().catch(() => null);
    for (const d of (jj?.body?.data ?? [])) {
      const pm = String(d.originalUrl).match(/products\/(\d+)/);
      if (pm) cpMap[pm[1]] = d.shortenUrl;
    }
  }

  for (const f of found as any[]) {
    if (f.error) { out.push({ input: f.input, error: f.error }); continue; }
    if (f.kind === "toss") {
      const d = detail[f.id];
      const lr = await call("POST", "/links", token,
        f.idKind === "item" ? { tacaItemId: Number(f.id), publisherId: PUB }
                            : { tacaId: Number(f.id), publisherId: PUB });
      const link = lr.body?.success?.shortUrl ?? "";
      out.push({
        input: f.input, mall: "토스쇼핑", source: "toss",
        product_id: `toss_${d?.tacaItemId ?? f.id}`,
        title: d?.displayName ?? "", price: d?.displayPrice ?? 0,
        price_before: d?.originalPrice ?? null, discount_rate: d?.discountRate ?? null,
        img_url: d?.thumbnailUrl ?? "", sold_out: !!d?.isSoldOut, link,
      });
    } else {
      out.push({
        input: f.input, mall: "쿠팡", source: "coupang",
        product_id: `cp_${f.productId}`,
        title: "", price: 0, price_before: null, discount_rate: null, img_url: "",
        link: cpMap[f.productId] ?? "",
        note: "쿠팡은 상품명·가격을 자동으로 못 받아온다 → 직접 적어 주세요",
      });
    }
  }
  return out;
}
// 관리자 화면(admin.html)에서 브라우저로 부르므로 CORS 를 열어 준다. 우리 도메인만.
const OK_ORIGIN = /^https?:\/\/(momcalendar\.com|www\.momcalendar\.com|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/;
function corsHeaders(origin: string | null) {
  const o = origin && OK_ORIGIN.test(origin) ? origin : "https://momcalendar.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
// 이 함수로 링크를 마구 찍어내지 못하게, 변환은 관리자만 쓸 수 있게 한다.
async function isAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return false;
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/is_app_admin`, {
      method: "POST",
      headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? KEY, Authorization: auth, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return false;
    return (await r.text()).trim() === "true";
  } catch { return false; }
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const mode = u.searchParams.get("mode") ?? "health";
  const isDry = u.searchParams.get("dry") === "1";
  const CORS = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    if (mode === "convert" && !(await isAdmin(req))) {
      return json({ error: "관리자만 쓸 수 있습니다. 관리자 로그인 후 다시 시도해 주세요." }, 401);
    }
    if (!AK || !SK) return json({ error: "TOSS_ACCESS_KEY / TOSS_SECRET_KEY 가 비어 있다" }, 400);

    const token = await getToken(u.searchParams.get("newtoken") === "1");

    if (mode === "health") {
      const r = await call("GET", "/health", token);
      return json({ mode, status: r.status, body: r.body, publisherIdSet: !!PUB });
    }
    // 이미 올린 토스 핫딜의 오늘 가격을 다시 물어 이력에 남긴다. (사장님 지시 2026-08-09)
    //
    // 왜 필요한가: 지금까지는 '오늘의 특가 목록'에 다시 뜬 상품만 이력이 남았다.
    //   목록에서 빠지면 그날로 끊겨서, 30일간 추적한 2,810개 중 7일 이상 쌓인 게 0개였다.
    //   (58% 는 하루 만에 끊김) → 카드의 "며칠 뒤 그래프가 보여요" 가 영영 오지 않았다.
    //   상품ID 로 직접 되물을 수 있는 건 토스뿐이다(쿠팡·애드픽·링크프라이스는 목록만 준다).
    //
    // ⚠ product_id 가 tacaId 인 것과 tacaItemId 인 것이 섞여 있다.
    //   수집 경로(collectDeals)와 변환 경로(convert)가 서로 다른 값을 넣어 왔다.
    //   그래서 tacaIds 로 먼저 묻고, 못 찾은 것만 tacaItemIds 로 다시 묻는다.
    if (mode === "track") {
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const rows = await sb("hotdeals?source=eq.toss&select=id,product_id,price,title,manual&order=id.desc&limit=500");
      const ids = [...new Set((Array.isArray(rows) ? rows : [])
        .map((r: any) => String(r.product_id ?? "").replace(/^toss_/, ""))
        .filter((s: string) => /^\d+$/.test(s)))];
      const log: any = { day, 대상: ids.length, 조회됨: 0, 기록: 0, 품절: 0, 못찾음: [] as string[] };
      if (!ids.length) return json({ mode, ...log });

      // ⚠ 여기서 응답을 기다리면 안 된다.
      //   구조가 [크론(pg_net) → 이 함수 → 다시 pg_net → 토스] 라 이중 대기가 된다.
      //   실측: 상세조회 응답이 25초에 오는데 크론 쪽이 먼저 끊겨 "응답 없음" 만 3번 났다.
      //   → 요청만 넣어 두고(fire) 다음 실행 때 지난 응답을 수거(collect)한다. 대기가 아예 없다.
      const got: Record<string, any> = {};                 // 우리 product_id 숫자 → 상품

      // ① 수거 — 지난 실행이 넣어 둔 요청의 응답을 읽는다
      const pend = await sb("toss_track_pending?select=req_id,created_at,id_kind&order=req_id");
      const pendRows = Array.isArray(pend) ? pend : [];
      const pendIds = pendRows.map((r: any) => Number(r.req_id));
      // ⚠ 기록 날짜는 '수거한 날'이 아니라 '물어본 날'이어야 한다.
      //   밤에 발사한 걸 다음날 아침에 수거하면 어제 가격이 오늘로 찍힌다.
      let askedDay = day;
      for (const r of pendRows) {
        const rid = Number(r.req_id);
        const d = new Date(new Date(r.created_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
        const rows = await rpc("toss_http_result", { p_id: rid });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row?.content == null) continue;
        let b: any = null; try { b = JSON.parse(row.content); } catch { /* 형식이 깨졌으면 버린다 */ }
        // ⚠️ tacaId 와 tacaItemId 를 둘 다 키로 넣으면 안 된다.
        //   번호 체계가 달라 다른 상품의 값과 겹치고, 그러면 엉뚱한 가격이 붙는다.
        //   실측 2026-08-10: 67% 상품이 3% 로 판정돼 멀쩡한 핫딜이 내려갔다.
        //   → 물어본 종류에 맞는 키로만 매핑한다.
        //   우리 product_id 는 대부분 tacaId 다. 그런데 같은 번호를 tacaItemId 로도 물어보기 때문에,
        //   그 번호를 tacaItemId 로 가진 **다른 상품**이 걸려 덮어쓰는 일이 생긴다.
        //   → 먼저 온 것(tacaIds 조회, req_id 가 작다)이 이긴다. 덮어쓰지 않는다.
        const kind = String(r.id_kind || "tacaIds");
        for (const it of (b?.success?.items ?? [])) {
          const k = String(kind === "tacaItemIds" ? it.tacaItemId : it.tacaId);
          if (k && k !== "undefined" && !got[k]) got[k] = it;
        }
        askedDay = d;
      }
      log.기록날짜 = askedDay;
      log.수거한요청 = pendIds.length;
      if (pendIds.length) await sb(`toss_track_pending?req_id=in.(${pendIds.join(",")})`, { method: "DELETE" });

      // ② 발사 — 이번 대상의 상세조회 요청을 넣어만 둔다(응답은 다음 실행에서 읽는다)
      //    ID 체계가 tacaId/tacaItemId 로 섞여 있어 두 벌 다 물어본다. 어차피 안 기다리니 비용이 같다.
      if (!isDry) {
        const newRows: any[] = [];
        for (const key of ["tacaIds", "tacaItemIds"]) {
          for (let i = 0; i < ids.length; i += 20) {        // 한 번에 20건
            const part = ids.slice(i, i + 20);
            const rid = await rpc("toss_http", {
              p_method: "GET",
              p_url: `${BASE}/products/detail?${key}=${part.join(",")}`,
              p_headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              p_body: null,
            });
            newRows.push({ req_id: Number(rid), id_kind: key });   // 어떤 종류로 물었는지 같이 적어 둔다
          }
        }
        if (newRows.length) {
          await sb("toss_track_pending", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(newRows),
          });
        }
        log.보낸요청 = newRows.length;
      }
      log.조회됨 = ids.filter((x) => got[x]).length;
      log.못찾음 = ids.filter((x) => !got[x]).slice(0, 20);

      // 값이 확실한 것만 남긴다. 품절이면 가격이 의미가 없으니 이력에 넣지 않는다
      //   (품절가를 넣으면 나중에 '역대 최저' 판정이 오염된다)
      const hist = ids.filter((x) => got[x] && !got[x].isSoldOut && Number(got[x].displayPrice) > 0)
        .map((x) => ({ product_id: `toss_${x}`, day: askedDay, price: Number(got[x].displayPrice) }));
      log.품절 = ids.filter((x) => got[x]?.isSoldOut).length;
      if (!isDry && hist.length) {
        await sb("price_history?on_conflict=product_id,day", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(hist),
        });
        log.기록 = hist.length;
      }

      // 🔴 이력만 쌓고 정작 카드에 뜨는 가격은 그대로 두고 있었다.
      //   등록 후 값이 바뀌면 손님은 틀린 가격을 본다.
      //   실측 2026-08-10: 다농원 콤부차를 13,800원으로 띄웠는데 실제로는 19,900원이었다.
      //   (사장님 지적 "핫딜 가격 문제없는거 맞아? 이딴식으로 할거면 핫딜 운영 어떻게해")
      //   → 매번 현재가로 맞추고, 조건에서 벗어난 건 내린다.
      const TRACK_MIN_DROP = 25;          // 이보다 덜 깎이면 더는 핫딜이 아니다
      log.가격갱신 = 0; log.내림 = [];
      if (!isDry) {
        for (const r of (Array.isArray(rows) ? rows : [])) {
          const key = String(r.product_id ?? "").replace(/^toss_/, "");
          const it = got[key];
          if (!it) continue;
          const now  = Number(it.displayPrice) || 0;
          const org  = Number(it.originalPrice) || 0;
          const drop = Number(it.discountRate) || (org > now ? Math.round((org - now) / org * 100) : 0);
          const 품절 = !!it.isSoldOut;
          // 사장님이 카톡으로 주신 건 이미 걸러진 '찐 핫딜'이다(지시 2026-08-10).
          //   할인율이 조금 떨어졌다고 우리가 멋대로 내리지 않는다. 가격만 맞춰 둔다.
          //   품절은 명백하니 그때만 내린다.
          const 수동 = r.manual === true;
          if (품절 || !now || (!수동 && drop < TRACK_MIN_DROP)) {
            await sb(`hotdeals?id=eq.${r.id}`, {
              method: "PATCH", headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ expires_at: new Date(Date.now() - 60e3).toISOString() }),
            });
            log.내림.push(`${r.id}:${품절 ? "품절" : drop + "%"}`);
            continue;
          }
          if (now !== Number(r.price)) {
            await sb(`hotdeals?id=eq.${r.id}`, {
              method: "PATCH", headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ price: now, price_before: org || null, discount_rate: drop || null }),
            });
            log.가격갱신++;
          }
        }
      }
      if (isDry) log.미리보기 = hist.slice(0, 10);
      return json({ mode, ...log });
    }
    // 저장해 둔 상품의 최신 가격·이미지·품절 여부를 다시 물어본다 (한 번에 30건까지).
    // 쿠팡에는 없는 기능이다 — 이것 때문에 가격 이력이 끊기지 않는다.
    if (mode === "detail") {           // ?mode=detail&ids=1,2,3  (기본 tacaId, item=1 이면 tacaItemId)
      const ids = (u.searchParams.get("ids") ?? "").trim();
      if (!ids) return json({ error: "ids 가 필요하다" }, 400);
      const key = u.searchParams.get("item") === "1" ? "tacaItemIds" : "tacaIds";
      const r = await call("GET", `/products/detail?${key}=${encodeURIComponent(ids)}`, token);
      return json({ mode, status: r.status, body: r.body });
    }
    // 관리자에서 링크를 붙여넣어 우리 수익 링크로 바꾼다
    if (mode === "convert") {
      let raws: string[] = [];
      if (req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        raws = Array.isArray(b?.urls) ? b.urls : String(b?.text ?? "").split(/\s+/);
      } else {
        raws = String(u.searchParams.get("urls") ?? "").split(/[\s|]+/);
      }
      raws = raws.map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
      if (!raws.length) return json({ error: "링크가 없다" }, 400);
      return json({ mode, items: await convertLinks(token, raws) });
    }
    if (mode === "collect") {
      const dry = u.searchParams.get("dry") === "1";
      return json({ mode, dry, ...(await collectDeals(token, dry)) });
    }
    if (mode === "deals") {
      const r = await call("GET", "/products/today-deals?size=20", token);
      return json({ mode, status: r.status, body: r.body });
    }
    if (mode === "best") {
      const r = await call("GET", "/products/best-selling?size=5", token);
      return json({ mode, status: r.status, body: r.body });
    }
    if (mode === "link") {                       // ?mode=link&tacaItemId=... 또는 &tacaId=...
      const itemId = u.searchParams.get("tacaItemId");
      const tacaId = u.searchParams.get("tacaId");
      if (!itemId && !tacaId) return json({ error: "tacaItemId 나 tacaId 가 필요하다" }, 400);
      const body: Record<string, unknown> = { publisherId: PUB };
      if (itemId) body.tacaItemId = Number(itemId); else body.tacaId = Number(tacaId);
      const r = await call("POST", "/links", token, body);
      return json({ mode, status: r.status, body: r.body });
    }
    return json({ error: "mode 는 health / best / link" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

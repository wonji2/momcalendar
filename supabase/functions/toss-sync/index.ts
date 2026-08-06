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

async function call(method: string, path: string, token: string, body?: unknown) {
  const id = await rpc("toss_http", {
    p_method: method,
    p_url: BASE + path,
    p_headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    p_body: body ? JSON.stringify(body) : null,
  });
  return wait(Number(id));
}

// 토큰은 1년짜리다. 받아서 저장해 두고 재사용한다(문서: 매번 재발급하지 말 것).
async function getToken(force = false): Promise<string> {
  if (!force) {
    const rows = await sb("toss_token?select=access_token,expires_at&id=eq.1");
    const t = Array.isArray(rows) ? rows[0] : null;
    if (t?.access_token && new Date(t.expires_at).getTime() > Date.now() + 3600e3) return t.access_token;
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
Deno.serve(async (req) => {
  const u = new URL(req.url);
  const mode = u.searchParams.get("mode") ?? "health";
  try {
    if (!AK || !SK) return Response.json({ error: "TOSS_ACCESS_KEY / TOSS_SECRET_KEY 가 비어 있다" }, { status: 400 });

    const token = await getToken(u.searchParams.get("newtoken") === "1");

    if (mode === "health") {
      const r = await call("GET", "/health", token);
      return Response.json({ mode, status: r.status, body: r.body, publisherIdSet: !!PUB });
    }
    if (mode === "collect") {
      const dry = u.searchParams.get("dry") === "1";
      return Response.json({ mode, dry, ...(await collectDeals(token, dry)) });
    }
    if (mode === "deals") {
      const r = await call("GET", "/products/today-deals?size=20", token);
      return Response.json({ mode, status: r.status, body: r.body });
    }
    if (mode === "best") {
      const r = await call("GET", "/products/best-selling?size=5", token);
      return Response.json({ mode, status: r.status, body: r.body });
    }
    if (mode === "link") {                       // ?mode=link&tacaItemId=... 또는 &tacaId=...
      const itemId = u.searchParams.get("tacaItemId");
      const tacaId = u.searchParams.get("tacaId");
      if (!itemId && !tacaId) return Response.json({ error: "tacaItemId 나 tacaId 가 필요하다" }, { status: 400 });
      const body: Record<string, unknown> = { publisherId: PUB };
      if (itemId) body.tacaItemId = Number(itemId); else body.tacaId = Number(tacaId);
      const r = await call("POST", "/links", token, body);
      return Response.json({ mode, status: r.status, body: r.body });
    }
    return Response.json({ error: "mode 는 health / best / link" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
});

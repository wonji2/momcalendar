// 🛒 네이버 브랜드커넥트 「지금 할인 중」 인기 상위 상품 → 우리 링크로 hotdeals 등록 (서버판 · PC 꺼져도 돈다)
//   사장님 2026-11-10: 「그날 인기있는 핫딜상품 … 자동으로 몇개 가져오게」 · 「하루 10개까지 · 진짜 핫딜같은거만 · 인기있는 핫딜제품」
//     · 「할인폭 큰건 사기칠수있으니 냅두고 리뷰 많고 인기많은 top상품위주로」 · 「가장 싼 옵션이 대표가로 잡혀도 상관없다」
//     · 「pc예약 작업 아니라고 … 컴터랑 상관없이 돌아가게」 → 그래서 Edge Function + pg_cron(naver-bc-hotdeals 매일 10:20 KST)
//   PC 판(tools/daily/naver_bc_hotdeals.mjs)과 같은 규칙. 고칠 땐 둘 다.
//
// 시크릿: NAVER_BC_COOKIE(사장님 네이버 로그인 쿠키 — 브랜드커넥트 파트너 916463797554784, 2026-11-10 사장님 승인으로 서버에 둠)
//         PUSH_CRON_SECRET · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
//   쿠키가 풀리면(401/403·로그인 화면) 등록하지 않고 health_alerts('브랜드커넥트로그인만료') 를 남긴다 → 사장님이 다시 로그인하면 쿠키를 다시 넣는다
//
// 고르는 법(2026-11-23 사장님 「하루에 20개까지 올려 · 이왕이면 정말 핫딜 · 인기순 판매인기순 추천순 등등」):
//   출처 셋 — ① 분류별 추천(recommend-by-display-category, 네이버 추천순 20건 × 11분류) ② TOP100 기획전 앞 10건(event/tabs 중 이름에 TOP 이 든 것)
//             ③ 쇼핑 프로모션(9개 분류 × 3쪽) — 셋 다 네이버가 내준 순서(추천·인기)를 그대로 점수에 쓴다
//   거름 — 판매중·사진·할인 10%↑·평점 4.5↑·리뷰 100↑·14일 안 같은 이름·사진 없음 (그대로)
//   뺌 — 할인 70%↑(사장님 11-10 「할인폭 큰건 사기칠수있으니 냅두고」)·3,000원 미만·주문 제작/맞춤/수리/호환 부품(가장 싼 옵션 값이 대표가로 잡힌 것들)
//   점수 — 리뷰 수(log) + 출처 안 순위(추천순·판매 인기) + 여러 출처에 겹치면 가산. 할인율은 점수에 넣지 않는다 → 높은 순
//   나눔 — 출산/육아 먼저 6건까지, 그 밖은 분류마다 3건·같은 스토어 2건까지, 하루 PICK(20)
// 링크: POST gw-brandconnect …/affiliate/command/affiliate-urls?affiliateProductId=<id> → naver.me, 되짚어 상품번호 확인
// 기한: 오늘+3일 23:59 KST. 오늘 이미 넣은 네이버 자동 딜 수만큼 PICK 에서 뺀다(하루 20 상한).
// 호출: ?dry=1 미리보기(등록 안 함) · ?pick=N
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const COOKIE = Deno.env.get("NAVER_BC_COOKIE") ?? "";
const SPACE = "916463797554784";
const GW = "https://gw-brandconnect.naver.com/affiliate/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CATS: [string, string][] = [["50000005", "출산/육아"], ["50000006", "식품"], ["50000008", "생활/건강"], ["50000002", "화장품/미용"],
  ["50000004", "가구/인테리어"], ["50000003", "디지털/가전"], ["50000007", "스포츠/레저"], ["50000000", "패션의류"], ["50000001", "패션잡화"]];
// 분류별 추천(전시 분류 → 우리가 쓰는 대분류 번호). 여가/여행·취미/펫·도서는 우리 분류에 맞는 자리가 없어 뺀다
const DISPLAY: [string, string, string][] = [["1120051080", "50000005", "출산/육아"], ["1120051078", "50000006", "식품"], ["1120051077", "50000008", "생활/건강"],
  ["1120051076", "50000002", "화장품/미용"], ["1120051079", "50000004", "가구/인테리어"], ["1120051071", "50000003", "디지털/가전"], ["1120051072", "50000003", "디지털/가전"],
  ["1120051082", "50000007", "스포츠/레저"], ["1120051073", "50000000", "패션의류"], ["1120051074", "50000000", "패션의류"], ["1120051075", "50000001", "패션잡화"]];
const NAME: Record<string, string> = Object.fromEntries(CATS);

async function sb(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(SB_URL + "/rest/v1/" + path, { ...init, headers: { apikey: SB_SRK, Authorization: "Bearer " + SB_SRK, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (r.status === 204) return null;
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
async function gw(path: string, method = "GET"): Promise<{ status: number; body: any }> {
  const r = await fetch(GW + path, { method, headers: { cookie: COOKIE, "x-space-id": SPACE, accept: "application/json", "content-type": "application/json", referer: "https://brandconnect.naver.com/", "user-agent": UA }, body: method === "POST" ? "{}" : undefined });
  const t = await r.text();
  let body: any = t; try { body = JSON.parse(t); } catch { /* */ }
  return { status: r.status, body };
}
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

function ourCat(c1: string, n: string): [string, string] {
  if (/BCAA|아미노산|단백질|프로틴|영양제|비타민|유산균|오메가/.test(n)) return ["건강", /BCAA|아미노산|단백질|프로틴/.test(n) ? "다이어트" : "건강기능성"];
  if (c1 === "50000005") {
    if (/분유|이유식|퓨레|떡뻥|아기과자|유아식/.test(n)) return ["육아", "이유아식"];
    if (/로션|크림|오일|워시|샴푸|밤/.test(n)) return ["육아", "스킨로션"];
    if (/양말|내복|실내복|우주복|옷|모자|신발|장갑/.test(n)) return ["육아", "의류잡화"];
    if (/장난감|블럭|블록|인형|놀이/.test(n)) return ["육아", "장난감/놀이"];
    if (/책|전집|사운드북/.test(n)) return ["육아", "책"];
    return ["육아", "육아용품"];
  }
  if (c1 === "50000006") {
    if (/한우|돼지|소고기|닭|오리|계란|달걀|정육/.test(n)) return ["식품", "정육/계란"];
    if (/새우|굴비|고등어|갈치|전복|김|미역|오징어/.test(n)) return ["식품", "수산물/건해산"];
    if (/사과|배|귤|감귤|딸기|포도|고구마|감자|채소|야채/.test(n)) return ["식품", "과일/야채"];
    if (/우유|치즈|요거트|요구르트|버터/.test(n)) return ["식품", "유제품"];
    if (/커피|차|음료|주스|즙/.test(n)) return ["식품", "음료/차/즙"];
    if (/볶음밥|만두|밀키트|도시락|국|탕|찌개/.test(n)) return ["식품", "간편식/밀키트"];
    return ["식품", "간식/구황작물"];
  }
  if (c1 === "50000002") return /칫솔|치약|가글/.test(n) ? ["뷰티", "구강케어"] : /샴푸|헤어/.test(n) ? ["뷰티", "헤어케어"] : /바디|핸드워시|워시/.test(n) ? ["뷰티", "바디케어"] : ["뷰티", "스킨케어"];
  if (c1 === "50000004") return /베개|이불|매트리스|커버/.test(n) ? ["리빙", "침구/패브릭"] : /수납|정리/.test(n) ? ["인테리어", "수납정리"] : ["인테리어", "데코소품"];
  if (c1 === "50000003") return ["가전", "생활가전"];
  if (c1 === "50000007") return ["패션", "스포츠웨어"];
  if (c1 === "50000000") return ["패션", "의류"];
  if (c1 === "50000001") return ["패션", "액세서리"];
  if (/세제|섬유유연제|청소|락스|행주/.test(n)) return ["리빙", "청소/세제"];
  if (/칫솔|치약|가글|구강/.test(n)) return ["뷰티", "구강케어"];
  return ["리빙", "생활용품"];
}

async function alert(msg: string) {
  await sb("health_alerts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ kind: "브랜드커넥트로그인만료", detail: msg }) }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const today = kstToday();
  if (!COOKIE) { await alert("NAVER_BC_COOKIE 시크릿 없음"); return Response.json({ ok: false, why: "no cookie" }); }

  // 오늘 이미 넣은 자동 네이버 딜 수 → 하루 상한 20
  const doneToday = await sb(`hotdeals?select=id&source=eq.naver&manual=eq.false&deal_day=eq.${today}`);
  const PICK = Math.max(0, Number(u.searchParams.get("pick") || 20) - (Array.isArray(doneToday) ? doneToday.length : 0));
  if (!PICK) return Response.json({ ok: true, picked: 0, why: "오늘 상한 채움" });

  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  const recentRows = await sb(`hotdeals?select=title,img_url&source=eq.naver&created_at=gte.${since}`);
  // 같은 상품 판정은 이름 + 대표사진 주소(스토어가 이름을 살짝 바꿔도 사진 주소는 그대로다 — 2026-11-10 BCAA 재등장)
  const recent = new Set((Array.isArray(recentRows) ? recentRows : []).flatMap((r: any) => [r.title, r.img_url]).filter(Boolean));

  const pool: any[] = [];
  const src: Record<string, number> = { 추천: 0, TOP: 0, 프로모션: 0 };
  // ① 분류별 추천(네이버 추천순) — 첫 호출이 로그인 확인을 겸한다
  for (const [did, c1, cname] of DISPLAY) {
    const r = await gw(`query/affiliate-products/recommend-by-display-category?displayCategoryId=${did}&limit=20`);
    if (r.status === 401 || r.status === 403) {
      await alert(`목록 호출 ${r.status} — 네이버 로그인 쿠키가 풀렸을 수 있음`);
      return Response.json({ ok: false, status: r.status, why: "login" });
    }
    const rows = Array.isArray(r.body?.data) ? r.body.data : [];
    rows.forEach((x: any, i: number) => { pool.push({ ...x, c1, cname, from: "추천", rank: i }); src.추천++; });
  }
  // ② TOP100 기획전 앞 10건(판매 인기) — 분류 값이 없어 다른 출처에 같은 상품이 있으면 그 분류를, 없으면 기획전 이름으로 정한다
  const tabs = await gw("query/event/tabs");
  for (const t of (Array.isArray(tabs.body) ? tabs.body : []).filter((t: any) => /TOP/i.test(String(t.tabName))).slice(0, 6)) {
    const r = await gw(`query/affiliate-events/${t.id}/products/main`);
    const rows = Array.isArray(r.body) ? r.body : (Array.isArray(r.body?.data) ? r.body.data : []);
    // 먹거리 기획전은 식품. 그 밖(크리스마스 등)은 상품 이름에 분명한 낱말이 있을 때만 분류하고, 없으면 싣지 않는다(분류를 지어내지 않는다 — 2026-11-23 노트북이 인테리어로 잡힘)
    const food = /미식|김장|식품|먹거리|간식/.test(t.tabName);
    rows.forEach((x: any, i: number) => {
      const n = String(x.productName);
      const c1 = food ? "50000006"
        : /노트북|컴퓨터|모니터|태블릿|이어폰|헤드폰|충전기|가습기|히터|청소기|전기매트|온열/.test(n) ? "50000003"
        : /트리|전구|오너먼트|장식|리스|캔들|무드등|가랜드/.test(n) ? "50000004"
        : /장난감|블럭|블록|인형|유아|아기|키즈/.test(n) ? "50000005" : "";
      pool.push({ ...x, c1, cname: NAME[c1] ?? "", from: "TOP", rank: i, soft: true, tab: t.tabName }); src.TOP++;
    });
  }
  // ③ 쇼핑 프로모션(기존)
  for (const [c1, cname] of CATS) {
    for (let page = 1; page <= 3; page++) {
      const r = await gw(`query/affiliate-products/recommend-by-shopping-promotions?category1Id=${c1}&limit=10&page=${page}`);
      if (r.status === 401 || r.status === 403 || typeof r.body !== "object") {
        await alert(`목록 호출 ${r.status} — 네이버 로그인 쿠키가 풀렸을 수 있음`);
        return Response.json({ ok: false, status: r.status, why: "login" });
      }
      const rows = r.body?.data ?? [];
      rows.forEach((x: any, i: number) => { pool.push({ ...x, c1, cname, from: "프로모션", rank: (page - 1) * 10 + i }); src.프로모션++; });
      if (rows.length < 10) break;
    }
  }
  // 같은 상품이 여러 출처에 나오면 하나로 합친다(분류는 분류가 확실한 출처 것을 쓴다)
  const byId = new Map<number, any>();
  for (const x of pool) {
    const m = byId.get(x.id);
    if (!m) { byId.set(x.id, { ...x, froms: [[x.from, x.rank]] }); continue; }
    m.froms.push([x.from, x.rank]);
    if (m.soft && !x.soft) { m.c1 = x.c1; m.cname = x.cname; m.soft = false; }
  }
  const score = (x: any) => {
    const rv = x.reviewInfo?.totalReviewCount ?? 0;
    let s = Math.log10(Math.max(rv, 1)) * 10;
    const kinds = new Set<string>();
    for (const [f, rk] of x.froms) {
      if (kinds.has(f)) continue; kinds.add(f);
      s += f === "TOP" ? Math.max(0, 16 - rk) : f === "추천" ? Math.max(0, 12 - rk * 0.5) : Math.max(0, 6 - rk * 0.2);
    }
    if (kinds.size > 1) s += 8;
    return Math.round(s * 10) / 10;
  };
  const cand = [...byId.values()].filter((x) =>
    x.c1 && x.productStatus === "SALE" && x.representativeProductImageUrl && x.discountedRate >= 10 && x.discountedRate < 70 && x.discountedSalePrice >= 3000
      && !/제작|맞춤|수리|호환|리필s*전용|샘플|체험딜|증정용/.test(String(x.productName))
      && (x.reviewInfo?.averageReviewScore ?? 0) >= 4.5 && (x.reviewInfo?.totalReviewCount ?? 0) >= 100 && !recent.has(x.productName) && !recent.has(x.representativeProductImageUrl)
  ).map((x) => ({ ...x, score: score(x) })).sort((a, b) => b.score - a.score);
  // 출산/육아를 먼저 6건까지 채우고(맘캘 손님), 그 밖은 분류마다 3건. 같은 스토어는 2건까지
  const perCat: Record<string, number> = {}, perStore: Record<string, number> = {};
  const picked: any[] = [];
  const take = (x: any, capc: number) => {
    if (picked.length >= PICK || picked.includes(x)) return;
    if ((perCat[x.c1] ?? 0) >= capc || (perStore[x.storeName] ?? 0) >= 2) return;
    perCat[x.c1] = (perCat[x.c1] ?? 0) + 1; perStore[x.storeName] = (perStore[x.storeName] ?? 0) + 1;
    picked.push(x);
  };
  const babyCap = Math.min(6, Math.ceil(PICK * 0.3));
  for (const x of cand) if (x.c1 === "50000005") take(x, babyCap);
  for (const x of cand) if (x.c1 !== "50000005") take(x, 3);
  for (const x of cand) take(x, x.c1 === "50000005" ? babyCap : 5);   // 그래도 모자라면 분류 상한을 5 까지 푼다

  const out: any[] = [];
  const ins: any[] = [];
  const exp = new Date(Date.parse(today + "T23:59:00+09:00") + 3 * 86400e3).toISOString();
  for (const x of picked) {
    const cpn = (String(x.productUrl).match(/products\/(\d+)/) || [])[1] || "";
    const [major, minor] = ourCat(x.c1, x.productName);
    const rec: any = { 분류: x.cname, 이름: x.productName, 가격: x.discountedSalePrice, 정가: x.salePrice, 할인: x.discountedRate, 리뷰: x.reviewInfo.totalReviewCount, 점수: x.score, 출처: x.froms.map((f: any) => f[0] + (f[1] + 1)).join("+") };
    if (!dry) {
      const p = await gw(`command/affiliate-urls?affiliateProductId=${x.id}`, "POST");
      const link = p.body?.url ?? "";
      const back = link ? await fetch(link, { redirect: "follow", headers: { "user-agent": UA } }).then((r) => r.url).catch(() => "") : "";
      if (!link || !back.includes("channelProductNo=" + cpn)) { rec.실패 = `발급·되짚기 ${p.status}`; out.push(rec); continue; }
      rec.링크 = link;
      ins.push({ title: x.productName, link, major, minor, price: x.discountedSalePrice, price_before: x.salePrice, discount_rate: Math.round(x.discountedRate),
        img_url: x.representativeProductImageUrl, source: "naver", product_id: null, mall: "네이버", deal_day: today, manual: false, is_lowest: false, expires_at: exp });
    }
    out.push(rec);
  }
  let added = 0;
  if (ins.length) {
    const r = await sb("hotdeals", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(ins) });
    added = Array.isArray(r) ? r.length : 0;
    if (!Array.isArray(r)) out.push({ insert_error: String(JSON.stringify(r)).slice(0, 300) });
  }
  await sb("ops_status", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: "naver-bc-hotdeals", payload: { at: new Date().toISOString(), pool: pool.length, src, cand: cand.length, picked: picked.length, added, dry }, updated_at: new Date().toISOString() }) }).catch(() => {});
  return Response.json({ ok: true, dry, pool: pool.length, src, cand: cand.length, picked: picked.length, added, items: out });
});

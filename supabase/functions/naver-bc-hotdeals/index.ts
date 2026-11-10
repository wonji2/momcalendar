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
// 고르는 법: 9개 분류 × 3쪽(쪽당 10) → 판매중·사진·할인 10%↑·평점 4.5↑·리뷰 100↑·14일 안 같은 이름 없음 → 리뷰 수 순, 출산/육아 최대 4, 하루 PICK(10)
// 링크: POST gw-brandconnect …/affiliate/command/affiliate-urls?affiliateProductId=<id> → naver.me, 되짚어 상품번호 확인
// 기한: 오늘+3일 23:59 KST. 오늘 이미 넣은 네이버 자동 딜 수만큼 PICK 에서 뺀다(하루 10 상한).
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

  // 오늘 이미 넣은 자동 네이버 딜 수 → 하루 상한 10
  const doneToday = await sb(`hotdeals?select=id&source=eq.naver&manual=eq.false&deal_day=eq.${today}`);
  const PICK = Math.max(0, Number(u.searchParams.get("pick") || 10) - (Array.isArray(doneToday) ? doneToday.length : 0));
  if (!PICK) return Response.json({ ok: true, picked: 0, why: "오늘 상한 채움" });

  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  const recentRows = await sb(`hotdeals?select=title,img_url&source=eq.naver&created_at=gte.${since}`);
  // 같은 상품 판정은 이름 + 대표사진 주소(스토어가 이름을 살짝 바꿔도 사진 주소는 그대로다 — 2026-11-10 BCAA 재등장)
  const recent = new Set((Array.isArray(recentRows) ? recentRows : []).flatMap((r: any) => [r.title, r.img_url]).filter(Boolean));

  const pool: any[] = [];
  for (const [c1, cname] of CATS) {
    for (let page = 1; page <= 3; page++) {
      const r = await gw(`query/affiliate-products/recommend-by-shopping-promotions?category1Id=${c1}&limit=10&page=${page}`);
      if (r.status === 401 || r.status === 403 || typeof r.body !== "object") {
        await alert(`목록 호출 ${r.status} — 네이버 로그인 쿠키가 풀렸을 수 있음`);
        return Response.json({ ok: false, status: r.status, why: "login" });
      }
      const rows = r.body?.data ?? [];
      for (const x of rows) pool.push({ ...x, c1, cname });
      if (rows.length < 10) break;
    }
  }
  const seen = new Set();
  const cand = pool.filter((x) => {
    if (seen.has(x.id)) return false; seen.add(x.id);
    return x.productStatus === "SALE" && x.representativeProductImageUrl && x.discountedRate >= 10
      && (x.reviewInfo?.averageReviewScore ?? 0) >= 4.5 && (x.reviewInfo?.totalReviewCount ?? 0) >= 100 && !recent.has(x.productName) && !recent.has(x.representativeProductImageUrl);
  }).sort((a, b) => b.reviewInfo.totalReviewCount - a.reviewInfo.totalReviewCount);
  const baby = cand.filter((x) => x.c1 === "50000005").slice(0, 4);
  const rest = cand.filter((x) => x.c1 !== "50000005").slice(0, Math.max(0, PICK - baby.length));
  const picked = [...baby, ...rest].slice(0, PICK);

  const out: any[] = [];
  const ins: any[] = [];
  const exp = new Date(Date.parse(today + "T23:59:00+09:00") + 3 * 86400e3).toISOString();
  for (const x of picked) {
    const cpn = (String(x.productUrl).match(/products\/(\d+)/) || [])[1] || "";
    const [major, minor] = ourCat(x.c1, x.productName);
    const rec: any = { 분류: x.cname, 이름: x.productName, 가격: x.discountedSalePrice, 정가: x.salePrice, 할인: x.discountedRate, 리뷰: x.reviewInfo.totalReviewCount };
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
    body: JSON.stringify({ id: "naver-bc-hotdeals", payload: { at: new Date().toISOString(), pool: pool.length, cand: cand.length, picked: picked.length, added, dry }, updated_at: new Date().toISOString() }) }).catch(() => {});
  return Response.json({ ok: true, dry, pool: pool.length, cand: cand.length, picked: picked.length, added, items: out });
});

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
const MAX_PER_RUN = 20;    // 가격근거 기반 핫딜 하루 상한
const REPOST_COOLDOWN = 3; // 같은 상품을 며칠 안에는 다시 안 올림 (매일 같은 상품 도배 방지)
// ⚠️ 쿠팡 검색 API 시간당 호출 제한 방어선. 이 값을 함부로 올리지 말 것
//    (3회 초과하면 파트너스 이용이 제한된다. 2026-08-03에 116개로 돌리다 1회 초과 경고를 받음)
// ═══ 쿠팡 API 한도 (공식 문서 확인, 2026-08-04) ═══
//   /products/search : **1분당 50회**   ·   모든 API 합계 : 1분당 100회
//   일별 총량 제한 : 없음               ·   초과 시 : 24시간 차단, 경고 3회 누적이면 이용 제한
//
//   ⚠️ 2026-08-03 사고의 진짜 원인은 "40개를 호출한 것"이 아니라 **250ms 간격으로 몰아친 것**.
//      40회 ÷ 10초 = 분당 240회 → 한도(50)의 4.8배. 횟수가 아니라 **속도**가 문제였다.
//   → 일별 제한이 없으므로 키워드 수는 넉넉히 두되, **간격을 2초로 고정**해 분당 30회로 억제한다.
//   일별 총량 제한이 없으므로 **속도만 지키면 많이 가져올수록 좋다.**
//   1.5초 간격 = 분당 40회 (한도 50의 80%) · 58개 × 1.5초 ≈ 87초 → Edge Function 실행시간 안쪽
//   크론을 08:00 / 08:20 두 번 돌려 116개 키워드를 **매일 전량** 순회한다.
const KW_PER_RUN  = 58;
const CALL_GAP_MS = 1500;    // ❌ 이 값을 더 줄이지 말 것 — 분당 50회를 넘기면 24시간 차단

// 골드박스 = 쿠팡이 직접 고른 '오늘의 특가'.
// 우리 가격이력이 없는 초기에도 게시판을 채울 수 있고, 근거는 "쿠팡 선정"으로 정직하게 표기한다.
const MAX_GOLD = 15;
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

// ── 애드픽 (쇼핑메이트 핫딜) ────────────────────────────────
// 쿠팡과 달리 price_org(정가)를 주므로, 가격이력 없이도 그날 바로 할인율을 말할 수 있다.
// ⚠ 응답에 카테고리·상품ID가 없다 → 카테고리는 상품명으로 추정, 키는 링크에서 만든다.
const ADPICK_AFFID = "a4cea7";
const AP_MIN_DROP = 15;   // 이 이하 할인은 핫딜이라 부르지 않음
const AP_MAX_DROP = 60;   // 이 이상은 '정가 뻥튀기' 의심 → 거름 (향수·화장품에서 자주 나옴)
const AP_MAX = 20;

// 상품명으로 카테고리 추정. 못 맞히면 등록하지 않는다(엉뚱한 분류보다 누락이 낫다).
const AP_CAT: [RegExp, string, string][] = [
  [/기저귀|분유|이유식|아기|유아|젖병|유모차|카시트|아동|키즈|어린이|장난감|물티슈/, "육아", "육아용품"],
  [/유산균|오메가|비타민|홍삼|루테인|콜라겐|영양제|프로바이오|밀크씨슬/, "건강", "건강식품"],
  [/라면|과자|음료|커피|생수|한우|삼겹|쌀|즉석|간편식|반찬|견과|과일|우유|만두|김치|닭가슴살/, "식품", "가공식품"],
  [/휴지|세제|섬유유연제|샴푸|치약|칫솔|세정|위생|마스크팩?|락스|주방|수세미|지퍼백|비닐장갑/, "생필품", "생활용품"],
  // ⚠ '스킨'만 넣으면 "심리스브라-스킨(L)" 같은 색상표기에 걸린다 → 스킨케어/스킨토너로 좁힘
  [/스킨케어|스킨토너|로션|크림|앰플|에센스|선크림|쿠션|틴트|립스틱|향수|클렌징|토너/, "뷰티", "화장품"],
  [/청소기|밥솥|에어프라이어|냉장고|세탁기|건조기|이어폰|노트북|모니터|선풍기|가습기|정수기/, "가전", "생활가전"],
  [/강아지|고양이|사료|반려|펫/, "반려동물", "반려용품"],
  [/수납|매트|이불|베개|커튼|블라인드|행거|정리함|러그/, "리빙", "홈리빙"],
];
// 맘 사이트에 안 맞는 것은 카테고리 판정 전에 제외
const AP_BLOCK =
  /브라(자|렛)?[\s\-(]|팬티|속옷|보정속옷|성인|담배|전자담배|주류|와인|위스키/;
// 명품·고가 패션은 맘캘린더 방문자와 안 맞음 (애드픽 피드에 자주 섞여 들어옴)
const AP_LUXURY =
  /루이비통|샤넬|구찌|프라다|디올|에르메스|버버리|보테가|셀린느|생로랑|발렌시아가|몽클레어|스톤아일랜드|꼼데가르송|메종키츠네|아미|톰브라운|골든구스|폴로랄프|명품/;
const AP_MAX_PRICE = 150000;   // 이보다 비싼 건 핫딜로 안 올림
function apCat(name: string): [string, string] | null {
  if (AP_BLOCK.test(name) || AP_LUXURY.test(name)) return null;
  for (const [re, a, b] of AP_CAT) if (re.test(name)) return [a, b];
  return ["리빙", "생활용품"];   // 못 맞히면 드롭하지 않고 넓은 분류로 (사장님 방침: 대분류는 넓게)
}
const apNum = (s: unknown) => Number(String(s ?? "").replace(/[^\d]/g, "")) || 0;
// 링크에서 안정적인 키 만들기 (애드픽은 상품ID를 안 준다)
function apKey(buyurl: string): string {
  const m = String(buyurl).match(/[?&]url=([^&]+)/);
  const target = m ? decodeURIComponent(m[1]) : String(buyurl);
  let h = 5381;
  for (let i = 0; i < target.length; i++) h = ((h * 33) ^ target.charCodeAt(i)) >>> 0;
  return "ap_" + h.toString(16);
}
async function apFetch(): Promise<any[]> {
  const r = await fetch(
    `https://adpick.co.kr/apis/sdk_shopping_hotdeal.php?affid=${ADPICK_AFFID}`,
  );
  if (!r.ok) throw new Error("adpick http " + r.status);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return arr.flatMap((x: any) => Array.isArray(x?.list) ? x.list : []);
}

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
  if (test === "adpick") return Response.json((await apFetch()).slice(0, 5));
  if (test === "goldbox") return Response.json(await cpGoldbox());
  if (test) return Response.json(await cpSearch(u.searchParams.get("kw") ?? "기저귀", 5));

  const dry = u.searchParams.get("dry") === "1";
  const today = seoulToday();
  const log: any = { today, dry, keywords: 0, scanned: 0, tracked: 0, deals: [], errors: [] };

  // 1) 키워드별 상품 수집
  // ⚠️ 쿠팡 검색 API는 시간당 호출 제한이 있고, 3회 초과하면 파트너스 이용이 제한된다.
  //    전체 키워드를 매번 돌리지 말고, 가장 오래 안 본 것부터 KW_PER_RUN 개씩 돌아가며 조회한다.
  const kws = await sb(
    `coupang_keywords?select=id,keyword,major,minor&active=eq.true&order=last_seen.asc.nullsfirst&limit=${KW_PER_RUN}`,
  );
  if (!Array.isArray(kws)) return Response.json({ error: "keywords 조회 실패", detail: kws }, { status: 500 });
  log.keywords = kws.length;

  type Prod = { id: string; name: string; price: number; url: string; img: string;
                major: string; minor: string; keyword: string; rocket: boolean };
  const found = new Map<string, Prod>();

  let rateLimited = false;
  for (const k of kws) {
    try {
      const res = await cpSearch(k.keyword);

      // ⚠️ 429/403(시간당 한도 초과)이 오면 즉시 멈춘다.
      //    계속 때리면 "초과 횟수"가 쌓이고 3회면 파트너스 이용이 제한된다.
      const rc = String(res?.rCode ?? res?._httpStatus ?? "");
      const rm = String(res?.rMessage ?? "");
      if (rc === "403" || rc === "429" || rm.includes("초과")) {
        rateLimited = true;
        log.errors.push({ kw: k.keyword, rateLimited: true, msg: rm.slice(0, 160) });
        break;
      }

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
    await new Promise((r) => setTimeout(r, CALL_GAP_MS));  // 분당 50회 한도 방어선
  }
  // 이번에 돌린 키워드는 순번을 뒤로 (다음 실행 땐 아직 안 본 키워드가 먼저 온다)
  if (kws.length) {
    await sb(`coupang_keywords?id=in.(${kws.map((k: any) => k.id).join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen: new Date().toISOString() }),
    });
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
  log.rateLimited = rateLimited;   // true 면 쿠팡이 막은 것 — 키워드 수를 더 줄여야 한다
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

  // ═══ 골드박스는 "가격이력이 부족할 때만" 자리를 메우는 임시 재료 ═══
  //   맘캘린더 핫딜의 근거는 **우리가 쌓은 가격이력**이다(폴센트식). 골드박스는 쿠팡이 정한 특가라
  //   "왜 싼지"를 우리가 설명할 수 없다. 그래서 가격근거 핫딜이 충분해지면 골드박스를 0으로 줄인다.
  //   · 가격근거 핫딜이 GOLD_OFF_AT 건 이상 → 골드박스 아예 안 씀
  //   · 그보다 적으면 모자란 만큼만 채움
  const GOLD_OFF_AT = 8;
  const goldQuota = Math.max(0, Math.min(MAX_GOLD, GOLD_OFF_AT - picks.length));
  const already = new Set(picks.map((p) => p.id));
  const golds = goldQuota === 0 ? [] : goldIds
    .filter((id) => !already.has(id))
    .map((id) => found.get(id)!)
    .filter(Boolean)
    .slice(0, goldQuota)
    .map((p) => ({ ...p, avg: null, isLowest: false, discount: null, src: "goldbox" }));
  picks.push(...golds);
  log.goldPicked = golds.length;
  log.goldQuota  = goldQuota;
  log.mode = picks.length && goldQuota === 0 ? "가격이력만(골드박스 OFF)" : "가격이력 부족 → 골드박스로 보충";

  // 애드픽: 정가가 있으니 그날 바로 할인율 확정
  try {
    const rows = await apFetch();
    log.adpickTotal = rows.length;
    const ap = rows.map((p: any) => {
      const sale = apNum(p.price_sale), org = apNum(p.price_org);
      const name = String(p.product_name || "").slice(0, 200);
      const cat = apCat(name);
      if (!sale || !org || org <= sale || !cat || sale > AP_MAX_PRICE) return null;
      const drop = Math.round((org - sale) / org * 100);
      if (drop < AP_MIN_DROP || drop > AP_MAX_DROP) return null;
      return {
        id: apKey(p.buyurl), name, price: sale, url: p.buyurl, img: p.photo,
        major: cat[0], minor: cat[1], keyword: "애드픽", rocket: false,
        avg: org, isLowest: false, discount: drop, src: "adpick",
        mall: p.mall_name || p.mall || "",
      };
    }).filter(Boolean) as any[];
    ap.sort((a, b) => b.discount - a.discount);
    const apPicks = ap.filter((p) => !picks.some((q) => q.id === p.id)).slice(0, AP_MAX);
    picks.push(...apPicks);
    log.adpickPicked = apPicks.length;
    // 애드픽 건도 가격을 기록해 둬야 나중에 '역대최저' 판정이 붙는다
    if (apPicks.length) {
      await sb("price_history?on_conflict=product_id,day", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(apPicks.map((p) => ({ product_id: p.id, day: today, price: p.price }))),
      });
    }
  } catch (e) { log.errors.push({ kw: "adpick", err: String(e) }); }

  log.deals = picks.map((p) => ({
    name: p.name, price: p.price, avg: p.avg, discount: p.discount,
    lowest: p.isLowest, src: p.src,
  }));

  // 최근 며칠 안에 이미 올린 상품은 제외 (같은 상품이 매일 올라오면 도배로 보임)
  const coolFrom = new Date(Date.now() + 9 * 3600e3 - REPOST_COOLDOWN * 864e5).toISOString().slice(0, 10);
  const recent = await sb(`hotdeals?select=product_id,title&deal_day=gte.${coolFrom}`);
  const recentRows = Array.isArray(recent) ? recent : [];
  const recentIds = new Set(recentRows.map((r: any) => r.product_id).filter(Boolean));
  const before = picks.length;
  const fresh = picks.filter((p) => !recentIds.has(p.id));
  log.skippedRecent = before - fresh.length;
  picks.length = 0; picks.push(...fresh);

  // ── 같은 상품은 하나만 ──────────────────────────────────────
  // 옵션·용량만 다른 같은 상품이 나란히 올라갔다.
  // (사장님 지적 2026-08-05: 펩시 355ml 24개입 / 펩시 엑스트라 피즈 355ml 24입 — 가격까지 16,500 으로 같았다)
  // 용량·수량·괄호를 턴 뒤 앞 두 단어로 묶고, 묶음당 제일 싼(할인율 높은) 것만 남긴다.
  // ⚠️ 단위는 **긴 것부터** 적어야 한다. "개" 를 먼저 두면 "24개입" 에서 "개" 만 잘려 "입" 이 남는다.
  const baseKey = (name: string) => (name || "").toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[0-9]+\s*(개입|개|입|박스|세트|캔|팩|병|매|포|봉|정|구|장|ml|kg|l|g|p|ea)\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^가-힣a-z]/g, " ")
    .split(/\s+/).filter((w) => w.length >= 2).slice(0, 2).join(" ");
  // 브랜드가 붙었냐 띄었냐로 키가 갈린다("펩시콜라" vs "펩시 엑스트라").
  // 앞 두 글자 + 가격이 같으면 사실상 같은 물건으로 본다.
  const brandKey = (name: string, price: number) =>
    (name || "").replace(/^\[[^\]]*\]\s*/, "").trim().slice(0, 2) + "|" + price;

  const usedKeys = new Set(recentRows.map((r: any) => baseKey(r.title || "")).filter(Boolean));
  const usedBrand = new Set(recentRows.map((r: any) => brandKey(r.title || "", (r as any).price)).filter(Boolean));
  picks.sort((a, b) => (b.discount ?? 0) - (a.discount ?? 0));   // 싼 것이 대표가 되게
  const uniq: any[] = [];
  for (const p of picks) {
    const k = baseKey(p.name), bk = brandKey(p.name, p.price);
    if ((k && usedKeys.has(k)) || usedBrand.has(bk)) { log.dedupOption = (log.dedupOption ?? 0) + 1; continue; }
    if (k) usedKeys.add(k);
    usedBrand.add(bk);
    uniq.push(p);
  }
  picks.length = 0; picks.push(...uniq);

  // ── 공구로 파는 상품은 핫딜에 올리지 않는다 ────────────────
  // (사장님 지적 2026-08-05: 뉴케어 마이키즈는 공구 상품인데 핫딜 탭에 올라왔다)
  try {
    const gToday = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const gg = await sb(`gonggu?select=name&approved=eq.true&end_date=gte.${gToday}&limit=1000`);
    const gKeys = new Set((Array.isArray(gg) ? gg : []).map((g: any) => baseKey(g.name || "")).filter(Boolean));
    const beforeG = picks.length;
    const notGonggu = picks.filter((p) => !gKeys.has(baseKey(p.name)));
    log.skippedGonggu = beforeG - notGonggu.length;
    picks.length = 0; picks.push(...notGonggu);
  } catch (e) { log.errors.push({ kw: "gonggu-filter", err: String(e) }); }

  log.deals = picks.map((p) => ({ name: p.name, price: p.price, discount: p.discount, src: p.src }));

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
      mall: p.mall ?? null,
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

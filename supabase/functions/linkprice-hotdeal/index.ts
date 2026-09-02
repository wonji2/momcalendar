// 링크프라이스 → 가격 추적 → 역대최저가 판정 → hotdeals 자동 등록
//
//   ?test=1   → 원본 응답 요약만 (판정/등록 안 함)
//   ?dry=1    → 수집·판정만 하고 등록은 안 함 (미리보기)
//   (헤더 x-cron-secret 필요)
//
// ⚠️ 쿠팡 함수(coupang-hotdeal)는 절대 건드리지 않는다. 계정 잠김 이력이 있어 분리 운영한다.
//
// 링크프라이스 API 특징 (2026-08-05 실측)
//   · 인증키가 없다. 어필 ID만 있으면 GET 으로 끝난다 → 레이트리밋 사고 위험이 낮다
//   · 정가(normal_price)는 있어도 할인가가 0 으로 오는 경우가 대부분 → **정가를 믿지 않는다**
//     폴센트와 같은 방식으로 **우리가 쌓은 가격 이력**으로만 판정한다
//   · 상품 검색 API가 없다 → 피드에 나오는 것만 추적 가능 (핫딜 110건 + 리얼핫딜 18건)
//   · 외식 기프티콘(버거킹·메가커피)이 많아 걸러내야 한다

const AFF_ID = Deno.env.get("LINKPRICE_AFF_ID") ?? "A100706561";  // 공개 식별자(클릭 URL에 그대로 노출됨)
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── 핫딜 판정 기준 ── 쿠팡 함수와 같은 값을 쓴다 (근거의 일관성)
const MIN_POINTS = 7;      // 이력이 최소 7일은 쌓여야 판정
const LOOKBACK   = 90;
const MIN_DROP   = 0.10;   // 역대최저 + 평균 대비 10% 이상
const BIG_DROP   = 0.25;   // 역대최저가 아니어도 평균 대비 25% 이상
const MAX_PER_RUN = 6;     // 링크프라이스발 핫딜 하루 상한 (쿠팡·애드픽과 섞이므로 적게)
const REPOST_COOLDOWN = 3;

// ── 제외 ──
// ⚠️ 상품권·외식 기프티콘은 **빼지 않는다**. 추적해뒀다가 진짜 쌀 때 하나씩만 올린다.
//    (사장님 지시 2026-08-05 "상품권 쉐이크쉑 메가커피 이런건 그냥 추적해뒀다가 진짜 쌀 때 하나씩만")
//    한 상품당 하나만 나가는 건 아래 baseKey 묶음이 보장한다.
const BLOCK = [
  // 성인·고가·우리 카테고리 밖
  "명품", "구찌", "샤넬", "루이비통", "프라다", "롤렉스", "위스키", "와인", "소주", "맥주",
  "담배", "전자담배", "성인", "콘돔", "카지노", "복권",
  // 부품·B2B
  "ddr5", "ddr4", "ssd", "그래픽카드", "메인보드", "cpu", "ram ", "서버",
];
// 쇼핑몰 통째로 제외 — 도서·해외직구는 우리 핫딜에 안 맞는다 (사장님 지시 2026-08-05)
const BLOCK_MALL = [
  "yes24", "kbbook", "aladin", "kyobo", "interpark_book", "ridibooks", "bandinlunis",
  "iherb",
];

// ── 카테고리 추정 ── 애드픽에서 쓰던 규칙과 같은 사상
const CAT_RULES: [string, string, RegExp][] = [
  ["육아", "기저귀·물티슈", /기저귀|물티슈|１회용|배변|아기띠|유모차|카시트|젖병|분유|이유식|쪽쪽이|턱받이/],
  ["육아", "장난감/놀이",  /장난감|블럭|블록|교구|퍼즐|인형|놀이|사운드북|전집|그림책|색칠|보드게임/],
  ["육아", "육아용품",     /아기|유아|신생아|베이비|키즈|어린이|주니어|童|아동/],
  ["식품", "간편식",       /밀키트|간편식|즉석|국|탕|찌개|만두|볶음밥|도시락|반찬|삼계탕|곰탕/],
  ["식품", "신선",         /한우|돼지|삼겹|닭|계란|달걀|우유|치즈|과일|사과|복숭아|토마토|수박|딸기|채소|쌀|김치/],
  ["식품", "간식",         /과자|초코|사탕|젤리|음료|커피|주스|생수|탄산|아이스크림|빵|떡|견과/],
  ["생필품", "세제·위생",  /세제|섬유유연제|주방세제|화장지|휴지|물티슈|비누|샴푸|치약|칫솔|생리대|기름종이/],
  ["생필품", "주방",       /냄비|프라이팬|후라이팬|밀폐용기|도마|칼|수저|그릇|텀블러|보온병|주방/],
  ["리빙", "수납·정리",    /정리함|수납|선반|행거|옷걸이|바구니|트레이|리빙박스/],
  ["리빙", "침구",         /이불|베개|매트|패드|커튼|러그|카페트|침대/],
  ["가전", "생활가전",     /청소기|세탁기|건조기|에어컨|선풍기|공기청정|제습|가습|믹서|블렌더|전기포트|밥솥|에어프라이/],
  ["뷰티", "스킨케어",     /크림|로션|에센스|세럼|앰플|토너|선크림|마스크팩|클렌징/],
];

// 카테고리는 좁히지 않는다 — 못 맞히면 리빙으로 둔다.
// (사장님 2026-08-05 "꼭 그 카테고리여야 하는 건 아닌데 상품권은 뺐으면 해")
function categorize(name: string): [string, string] {
  const s = (name || "").toLowerCase();
  for (const [major, minor, re] of CAT_RULES) if (re.test(s)) return [major, minor];
  return ["리빙", ""];
}
function blocked(name: string, mall: string): boolean {
  const m = (mall || "").toLowerCase();
  if (BLOCK_MALL.some((x) => m.includes(x))) return true;
  const s = (name || "").toLowerCase();
  return BLOCK.some((w) => s.includes(w));
}

// ── 같은 상품의 옵션 묶기 ──
// 코카콜라가 용량·수량만 다르게 5~6개 들어온다. 그대로 두면 핫딜이 콜라로 도배된다.
// (사장님 지시 2026-08-05 "제일 싼 걸로 하나만, 코카콜라만 6개 올라오면 별로잖아")
// 용량·수량·괄호를 턴 뒤 앞 두 단어를 묶음 열쇠로 쓴다.
//   "코카콜라 제로 355ml 24캔"        → "코카콜라 제로"
//   "코카콜라 제로 레몬라임 190ml 30캔" → "코카콜라 제로"
function baseKey(name: string): string {
  return (name || "").toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    // ⚠️ 단위는 긴 것부터. "개" 를 먼저 두면 "24개입" 에서 "개" 만 잘려 "입" 이 남는다.
    .replace(/[0-9]+\s*(개입|개|입|박스|세트|캔|팩|병|매|포|봉|정|구|장|ml|kg|l|g|p|ea)\b/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/[^가-힣a-z]/g, " ")
    .split(/\s+/).filter((w) => w.length >= 2).slice(0, 2).join(" ");
}
const won = (n: number) => n.toLocaleString("ko-KR") + "원";
const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SRK,
      Authorization: `Bearer ${SB_SRK}`,
      "Content-Type": "application/json",
      Prefer: (init as any).prefer ?? "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${t.slice(0, 300)}`);
  try { return t ? JSON.parse(t) : null; } catch { return null; }
}

// ── 수집 ── 두 피드를 합쳐 하나의 상품 목록으로
type Item = { id: string; name: string; price: number; url: string; img: string; mall: string };

async function collect(log: any): Promise<Item[]> {
  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (mall: string, code: string, name: string, price: number, url: string, img: string) => {
    if (!code || !name || !(price > 0) || !url) return;
    if (blocked(name, mall)) { log.blocked = (log.blocked ?? 0) + 1; return; }
    const id = `lp_${mall}_${code}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, price, url, img, mall });
  };

  // ① 핫딜 API — 카테고리별 묶음
  try {
    const r = await fetch(`https://api.linkprice.com/ci/product/data/${AFF_ID}`);
    log.hotdeal_status = r.status;
    if (r.ok) {
      const j = await r.json();
      for (const key of Object.keys(j)) {
        if (!key.startsWith("list_")) continue;
        if (key === "list_book") { log.skip_book = true; continue; }   // 도서는 통째로 제외
        const byMall = j[key];
        if (!byMall || typeof byMall !== "object") continue;
        for (const mall of Object.keys(byMall)) {
          const arr = byMall[mall];
          if (!Array.isArray(arr)) continue;
          for (const p of arr) {
            push(mall, String(p.p_code ?? ""), String(p.p_name ?? ""),
                 Number(p.p_price ?? 0), String(p.target_url ?? ""), String(p.img_url ?? ""));
          }
        }
      }
    }
  } catch (e) { log.hotdeal_err = String(e).slice(0, 120); }

  // ② 리얼핫딜 API — MD 큐레이션. 정가만 오고 할인가는 0 인 경우가 많다
  try {
    const r = await fetch(`https://api.linkprice.com/ci/hotdeal/data/${AFF_ID}`);
    log.real_status = r.status;
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) {
        for (const p of j) {
          const price = Number(p.discount_price) > 0 ? Number(p.discount_price) : Number(p.normal_price ?? 0);
          push(String(p.merchant_id ?? "lp"), String(p.product_code ?? ""), String(p.product_name ?? ""),
               price, String(p.click_url ?? ""), String(p.product_image ?? ""));
        }
      }
    }
  } catch (e) { log.real_err = String(e).slice(0, 120); }

  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const isTest = url.searchParams.get("test") === "1";
  const isDry  = url.searchParams.get("dry") === "1";
  const log: any = { at: new Date().toISOString() };

  try {
    const items = await collect(log);
    log.collected = items.length;
    if (isTest) {
      return Response.json({ log, sample: items.slice(0, 15) }, { status: 200 });
    }

    const today = todayKST();

    // 1) 오늘 가격을 이력에 적재 (같은 상품 같은 날은 1건)
    for (let i = 0; i < items.length; i += 100) {
      await sb("price_history?on_conflict=product_id,day", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(items.slice(i, i + 100).map((p) => ({
          product_id: p.id, day: today, price: p.price,
        }))),
      });
    }
    log.tracked = items.length;

    // 2) 이력 조회 → 판정
    const since = new Date(Date.now() + 9 * 3600e3 - LOOKBACK * 864e5).toISOString().slice(0, 10);
    const hist: Record<string, { day: string; price: number }[]> = {};
    const ids = items.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150).map((x) => `"${x}"`).join(",");
      const rows = await sb(`price_history?select=product_id,day,price&day=gte.${since}&product_id=in.(${chunk})`);
      if (Array.isArray(rows)) for (const r of rows) (hist[r.product_id] ??= []).push({ day: r.day, price: r.price });
    }

    const cands: any[] = [];
    for (const p of items) {
      const h = (hist[p.id] ?? []).filter((x) => x.day < today);
      if (h.length < MIN_POINTS) continue;
      const prices = h.map((x) => x.price);
      const lowest = Math.min(...prices);
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      if (!(avg > 0)) continue;
      const dropVsAvg = (avg - p.price) / avg;
      const isLowest = p.price <= lowest;

      let reason = "";
      if (isLowest && dropVsAvg >= MIN_DROP) {
        reason = `추적 ${h.length}일 중 최저가 · 평소(${won(avg)})보다 ${Math.round(dropVsAvg * 100)}% 저렴`;
      } else if (dropVsAvg >= BIG_DROP) {
        reason = `평소(${won(avg)})보다 ${Math.round(dropVsAvg * 100)}% 저렴`;
      } else continue;

      const [major, minor] = categorize(p.name);
      cands.push({ ...p, avg, lowest, isLowest, reason, major, minor,
                   discount: Math.round(dropVsAvg * 100), points: h.length });
    }
    // 싼 순서로 — 같은 상품 묶음에서 제일 싼(할인율 높은) 것이 대표가 되게
    cands.sort((a, b) => b.discount - a.discount);
    log.candidates = cands.length;

    // 3) 최근에 올린 상품은 건너뛴다 (도배 방지)
    const coolFrom = new Date(Date.now() + 9 * 3600e3 - REPOST_COOLDOWN * 864e5).toISOString().slice(0, 10);
    const recent = await sb(`hotdeals?select=product_id,title&deal_day=gte.${coolFrom}`);
    const recentRows = Array.isArray(recent) ? recent : [];
    const recentIds = new Set(recentRows.map((r: any) => r.product_id));
    // 같은 상품이면 쿠팡·애드픽으로 이미 올라간 것과도 겹치지 않게 (콜라가 여기저기서 올라오면 안 된다)
    // 브랜드가 붙었냐 띄었냐로 키가 갈린다("펩시콜라" vs "펩시 엑스트라") → 앞 두 글자 + 가격
    const brandKey = (name: string, price: number) =>
      (name || "").replace(/^\[[^\]]*\]\s*/, "").trim().slice(0, 2) + "|" + price;
    const usedKeys = new Set(recentRows.map((r: any) => baseKey(r.title || "")).filter(Boolean));
    const usedBrand = new Set(recentRows.map((r: any) => brandKey(r.title || "", (r as any).price)));

    // 공구로 파는 상품은 핫딜에 올리지 않는다
    // (사장님 지적 2026-08-05: 뉴케어 마이키즈는 공구 상품인데 핫딜 탭에 올라왔다)
    const gg = await sb(`gonggu?select=name&approved=eq.true&end_date=gte.${today}&limit=1000`);
    const gKeys = new Set((Array.isArray(gg) ? gg : []).map((g: any) => baseKey(g.name || "")).filter(Boolean));

    const picks: any[] = [];
    for (const p of cands) {
      if (picks.length >= MAX_PER_RUN) break;
      if (recentIds.has(p.id)) continue;
      const k = baseKey(p.name), bk = brandKey(p.name, p.price);
      if (k && gKeys.has(k)) { log.skip_gonggu = (log.skip_gonggu ?? 0) + 1; continue; }
      if ((k && usedKeys.has(k)) || usedBrand.has(bk)) { log.dedup_option = (log.dedup_option ?? 0) + 1; continue; }
      if (k) usedKeys.add(k);
      usedBrand.add(bk);
      picks.push(p);
    }
    log.picked = picks.length;

    if (isDry) return Response.json({ log, picks }, { status: 200 });

    // 4) 등록
    if (picks.length) {
      const expires = new Date(Date.now() + 3 * 864e5).toISOString();
      await sb("hotdeals?on_conflict=product_id,deal_day", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(picks.map((p) => ({
          title: p.name, link: p.url, img_url: p.img,
          price: p.price, price_before: p.avg, discount_rate: p.discount,
          major: p.major, minor: p.minor, mall: p.mall,
          source: "linkprice", product_id: p.id, is_lowest: p.isLowest,
          deal_day: today, expires_at: expires,
        }))),
      });
    }
    return Response.json({ log }, { status: 200 });
  } catch (e) {
    log.error = String(e).slice(0, 400);
    return Response.json({ log }, { status: 500 });
  }
});

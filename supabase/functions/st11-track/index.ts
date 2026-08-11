// 11번가 가격 추적 (2026-08-11)
//
// 왜 만들었나: 지마켓·쿠팡·보리보리는 상품페이지가 봇 차단이라 우리가 가격을 못 읽는다.
// 11번가만 상품페이지에 JSON-LD 가 그대로 실려 있어서 현재가와 정가를 둘 다 읽을 수 있다.
//   "offers":{"price":27400, ... "priceSpecification":{"price":32230}}
//   → price = 지금 파는 값 / priceSpecification.price = 정가
//
// ⚠ 반드시 데스크톱 UA 로 부를 것. 모바일 UA 는 302 로 튕기고 본문이 0바이트로 온다(실측 2026-08-11).
//
// 호출: 헤더 x-cron-secret 필요
//   ?dry=1  → 읽기만 하고 저장 안 함
const SB     = Deno.env.get("SUPABASE_URL")!;
const KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

// 정가 대비 이만큼은 싸야 핫딜로 남긴다. 아니면 만료 처리.
const MIN_DROP = 5;   // %

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

function today() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // Asia/Seoul
}

// 상품페이지에서 현재가·정가를 뽑는다
// ⚠ 할인이 끝나면 offers.price 와 priceSpecification.price 가 같은 값으로 온다(실측 2026-08-11).
//   그때 org 를 0 으로 뭉개면 '할인 없음'과 '정가 모름'을 구분 못 해 끝난 핫딜을 못 내린다.
//   그래서 spec 을 그대로 돌려주고, 판단은 호출부에서 한다.
function parsePrices(html: string): { now: number; spec: number } | null {
  const m = html.match(/"offers"\s*:\s*\{[^{]*?"price"\s*:\s*(\d+)/);
  if (!m) return null;
  const now = Number(m[1]);
  const s = html.match(/"priceSpecification"\s*:\s*\{[^{]*?"price"\s*:\s*(\d+)/);
  if (!now || now < 100) return null;
  return { now, spec: s ? Number(s[1]) : 0 };
}

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-cron-secret") !== SECRET) {
    return new Response("no", { status: 401 });
  }
  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const day = today();
  const log: any = { mode: "st11-track", day, dry, 대상: 0, 읽음: 0, 실패: 0, 만료: 0, 항목: [] };

  const rows = await sb(
    "hotdeals?select=id,title,price,price_before,product_id,manual" +
    "&product_id=like.lp_11st_*&or=(expires_at.is.null,expires_at.gt.now())",
  );
  if (!Array.isArray(rows)) return Response.json({ ...log, error: rows });
  log.대상 = rows.length;

  for (const r of rows) {
    const code = String(r.product_id).replace("lp_11st_", "");
    let html = "";
    try {
      const res = await fetch(`https://www.11st.co.kr/products/${code}`, {
        headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
      });
      html = await res.text();
    } catch (_) { /* 아래 실패 처리 */ }

    const p = parsePrices(html);
    if (!p) { log.실패++; log.항목.push({ id: r.id, code, 결과: "읽기실패" }); continue; }
    log.읽음++;

    const 정가있음 = p.spec > 0;
    const org  = p.spec > p.now ? p.spec : 0;              // 진짜 할인일 때만 정가로 인정
    const drop = org ? Math.round(((org - p.now) / org) * 100) : 0;
    const item: any = { id: r.id, title: r.title, 현재가: p.now, 정가: org || null, 할인율: drop };

    if (!dry) {
      // 가격 이력 (같은 상품·같은 날은 한 줄)
      await sb("price_history?on_conflict=product_id,day", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ product_id: r.product_id, day, price: p.now }),
      });

      // 수동 등록(사장님이 카톡에서 주신 건)은 "할인폭이 작다"는 이유로는 내리지 않는다.
      // 다만 **할인 자체가 사라졌으면** 수동이든 자동이든 내린다 — 그건 판단이 아니라 사실이다.
      // (끝난 핫딜이 목록에 계속 떠 있던 문제, 2026-08-10)
      const 수동   = r.manual === true;
      const 할인끝 = 정가있음 && org === 0;
      const 내림   = 할인끝 || (!수동 && org > 0 && drop < MIN_DROP);
      const patch: any = { price: p.now };
      if (org) { patch.price_before = org; patch.discount_rate = drop; }
      if (내림) {
        patch.expires_at = new Date().toISOString(); log.만료++;
        item.조치 = 할인끝 ? "만료(할인 끝남 — 정가로 돌아옴)" : "만료(할인폭 부족)";
      }

      await sb(`hotdeals?id=eq.${r.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    }
    log.항목.push(item);
    await new Promise((s) => setTimeout(s, 1500)); // 11번가에 부담 주지 않게
  }
  return Response.json(log);
});

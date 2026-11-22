// 💰 쿠팡 파트너스 **정산액**을 매일 받아 revenue_daily 에 쌓는다 (사장님 지시 2026-10-06)
//
//   *"맘캘린더 관리자페이지에 내 수익링크 종류 … 수익 얼만지 합계보이게 만들어줘"*
//   *"니가 키 자동으로 받아서 해"*
//
// 🔑 키를 새로 받을 필요가 없었다 — COUPANG_ACCESS_KEY/SECRET 가 **이미 시크릿에 있다**
//    (coupang-hotdeal 함수가 상품 검색에 쓰고 있다). 서명 방식도 그 함수 것을 그대로 쓴다.
//
// 쿠팡 파트너스 리포트 엔드포인트(셋 다 날짜 범위가 최대 31일):
//   /v1/reports/clicks      누른 수
//   /v1/reports/orders      주문
//   /v1/reports/commission  💰 커미션(정산액)
//   ⚠ 날짜는 YYYYMMDD. **서명에 쿼리스트링이 들어간다** — path 와 query 를 나눠 넘긴다.
//
// 부르는 법:  POST  …/functions/v1/coupang-revenue   { "secret": "<PUSH_CRON_SECRET>", "days": 7 }
//   days 를 안 주면 7. 같은 날을 다시 받아도 upsert 라 덮어쓰기만 된다.
//
// ⚠ 쿠팡 리포트는 **확정 전 금액이 바뀐다**(취소·반품). 그래서 매일 최근 7일을 다시 받는다.

const ACCESS = Deno.env.get("COUPANG_ACCESS_KEY") ?? "";
const SECRET = Deno.env.get("COUPANG_SECRET_KEY") ?? "";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HOST = "https://api-gateway.coupang.com";

function signedDate(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "").substring(2);
}
async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function cpGet(path: string, query: string): Promise<any> {
  const dt = signedDate();
  const sig = await hmacHex(SECRET, dt + "GET" + path + query);
  const auth = `CEA algorithm=HmacSHA256, access-key=${ACCESS}, signed-date=${dt}, signature=${sig}`;
  const r = await fetch(HOST + path + (query ? "?" + query : ""), { headers: { Authorization: auth } });
  const txt = await r.text();
  let j: any = null; try { j = JSON.parse(txt); } catch { /* */ }
  if (!r.ok) return { _status: r.status, _raw: txt.slice(0, 500) };
  return j;
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const cp = (d: Date) => ymd(d).replace(/-/g, "");

async function sb(path: string, init: RequestInit = {}) {
  return await fetch(SB_URL + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: SB_SRK, Authorization: "Bearer " + SB_SRK,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  if (!CRON_SECRET || body?.secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  if (!ACCESS || !SECRET) {
    return new Response(JSON.stringify({ error: "쿠팡 키가 시크릿에 없다" }), { status: 500 });
  }
  const days = Math.min(Math.max(Number(body?.days ?? 7), 1), 31);
  const now = new Date(Date.now() + 9 * 3600e3);                 // KST
  const end = new Date(now); const start = new Date(now.getTime() - (days - 1) * 86400e3);
  const base = "/v2/providers/affiliate_open_api/apis/openapi";
  const q = `startDate=${cp(start)}&endDate=${cp(end)}`;

  const out: Record<string, any> = { 기간: `${ymd(start)}~${ymd(end)}` };
  const byDay: Record<string, { clicks: number; orders: number; gmv: number; commission: number }> = {};
  const touch = (d: string) => (byDay[d] ??= { clicks: 0, orders: 0, gmv: 0, commission: 0 });

  // ① 클릭
  const c = await cpGet(`${base}/v1/reports/clicks`, q);
  out.clicks = c?._status ? `🔴 ${c._status} ${String(c._raw).slice(0, 120)}` : (c?.data?.length ?? 0);
  for (const r of (c?.data ?? [])) {
    const d = String(r.date ?? "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    if (d) touch(d).clicks += Number(r.click ?? r.clickCount ?? 0);
  }
  // ② 커미션 — 이게 실제 수익이다
  const m = await cpGet(`${base}/v1/reports/commission`, q);
  out.commission = m?._status ? `🔴 ${m._status} ${String(m._raw).slice(0, 120)}` : (m?.data?.length ?? 0);
  for (const r of (m?.data ?? [])) {
    const d = String(r.date ?? "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    if (!d) continue;
    const t = touch(d);
    t.commission += Math.round(Number(r.commission ?? r.commissionPrice ?? 0));
    t.gmv += Math.round(Number(r.gmv ?? r.salesPrice ?? r.orderPrice ?? 0));
    t.orders += Number(r.order ?? r.orderCount ?? 0);
  }

  const rows = Object.entries(byDay).map(([day, v]) => ({
    day, source: "coupang", clicks: v.clicks, orders: v.orders,
    gmv: v.gmv, commission: v.commission, updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const r = await sb("revenue_daily?on_conflict=day,source", { method: "POST", body: JSON.stringify(rows) });
    out.저장 = r.ok ? rows.length + "일" : `🔴 ${r.status} ${(await r.text()).slice(0, 200)}`;
  } else out.저장 = "0일 (받은 줄이 없다)";
  out.합계_커미션 = rows.reduce((a, x) => a + x.commission, 0);

  return new Response(JSON.stringify(out, null, 1), { headers: { "Content-Type": "application/json" } });
});

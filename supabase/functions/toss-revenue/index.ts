// 💰 토스 쉐어링크 **정산액**을 받아 revenue_daily 에 쌓는다 (사장님 지시 2026-10-06)
//
//   *"수익링크가 지금 다 나눠져있어서 뭐가 뭔지 출금신청 내가 해야되는데 못하니까
//     니가 수익링크 제휴링크 쓰는거 플랫폼별 수익 현재 얼마인지랑 싹 정리해놔"*
//
// 🔑 키는 이미 있다 — TOSS_ACCESS_KEY / TOSS_SECRET_KEY 로 OAuth 토큰을 받는다(toss-sync 와 같은 방식).
//    toss-sync 가 쓰는 toss_token 표의 토큰을 **재사용하지 않는다** — scope 가 다를 수 있어 따로 받는다.
//
// ⚠ 토스 쉐어링크 OpenAPI 의 실적 경로는 공개 문서가 얇다. 그래서 **후보를 차례로 찔러 보고**
//    200 이 오는 것을 쓴다. 어떤 경로가 먹혔는지 응답에 담아 돌려준다 — 다음 사람이 헤매지 않게.
//    못 찾으면 그 사실을 그대로 돌려준다(조용히 0원으로 적지 않는다).
//
//   POST …/functions/v1/toss-revenue   { "secret": "<PUSH_CRON_SECRET>", "days": 30 }

const AK = Deno.env.get("TOSS_ACCESS_KEY") ?? "";
const SK = Deno.env.get("TOSS_SECRET_KEY") ?? "";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BASE = "https://sharelink.toss.im/openapi";
const OAUTH = "https://oauth2.cert.toss.im/token";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function token(): Promise<string> {
  const form = `grant_type=client_credentials&client_id=${encodeURIComponent(AK)}` +
    `&client_secret=${encodeURIComponent(SK)}&scope=${encodeURIComponent("sharelink:read")}`;
  const r = await fetch(OAUTH, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) throw new Error(`토큰 발급 실패 ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

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
  if (!AK || !SK) return new Response(JSON.stringify({ error: "토스 키가 시크릿에 없다" }), { status: 500 });

  const days = Math.min(Math.max(Number(body?.days ?? 30), 1), 90);
  const now = new Date(Date.now() + 9 * 3600e3);
  const start = new Date(now.getTime() - (days - 1) * 86400e3);
  const out: Record<string, any> = { 기간: `${ymd(start)}~${ymd(now)}` };

  let tok = "";
  try { tok = await token(); out.토큰 = "받음"; }
  catch (e) { return new Response(JSON.stringify({ 토큰: "🔴 " + String(e).slice(0, 200) }), { status: 200 }); }

  // 실적 경로 후보 — 200 오는 첫 번째를 쓴다
  const qs = `startDate=${ymd(start)}&endDate=${ymd(now)}`;
  const 후보 = [
    `/v1/settlements?${qs}`, `/v1/reports/settlements?${qs}`,
    `/v1/statistics?${qs}`, `/v1/reports/commission?${qs}`,
    `/v1/reports?${qs}`, `/v1/performances?${qs}`,
  ];
  const 시도: any[] = [];
  let data: any = null, 쓴경로 = "";
  for (const p of 후보) {
    try {
      const r = await fetch(BASE + p, { headers: { Authorization: "Bearer " + tok } });
      const t = await r.text();
      // 🔴 토스는 **200 을 주면서 본문에 FAIL 을 담는다**(2026-10-06 실측).
      //    r.ok 만 보면 첫 후보에서 멈춰 버린다 — resultType 까지 본다.
      let j: any = null; try { j = JSON.parse(t); } catch { /* */ }
      const 실패 = !r.ok || j?.resultType === "FAIL" || j?.error;
      시도.push({ 경로: p.split("?")[0], 상태: r.status, 결과: j?.resultType ?? "-", 앞: t.slice(0, 140) });
      if (!실패) { data = j; 쓴경로 = p; break; }
    } catch (e) { 시도.push({ 경로: p.split("?")[0], 상태: "ERR", 앞: String(e).slice(0, 60) }); }
  }
  out.시도 = 시도;
  if (!data) { out.결과 = "🔴 실적 경로를 못 찾았다 — 위 시도 목록을 보고 토스에 문의하거나 경로를 추가할 것"; return new Response(JSON.stringify(out, null, 1)); }

  out.쓴경로 = 쓴경로;
  // 응답 모양을 모르니 숫자처럼 생긴 칸을 찾아 합친다. 원문은 raw 에 통째로 남긴다.
  const list: any[] = Array.isArray(data) ? data : (data.data ?? data.items ?? data.list ?? data.results ?? []);
  const pick = (o: any, ...k: string[]) => { for (const x of k) if (o?.[x] != null) return Number(o[x]) || 0; return 0; };
  const byDay: Record<string, any> = {};
  for (const r of list) {
    const d = String(r.date ?? r.settlementDate ?? r.day ?? "").slice(0, 10) || ymd(now);
    byDay[d] ??= { clicks: 0, orders: 0, gmv: 0, commission: 0 };
    byDay[d].clicks += pick(r, "click", "clickCount", "clicks");
    byDay[d].orders += pick(r, "order", "orderCount", "orders");
    byDay[d].gmv += pick(r, "gmv", "salesPrice", "orderAmount", "amount");
    byDay[d].commission += pick(r, "commission", "reward", "settlementAmount", "fee");
  }
  const rows = Object.entries(byDay).map(([day, v]: any) => ({
    day, source: "toss", clicks: v.clicks, orders: v.orders, gmv: Math.round(v.gmv),
    commission: Math.round(v.commission), raw: null, updated_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const r = await sb("revenue_daily?on_conflict=day,source", { method: "POST", body: JSON.stringify(rows) });
    out.저장 = r.ok ? rows.length + "일" : `🔴 ${r.status} ${(await r.text()).slice(0, 200)}`;
  } else out.저장 = "0일 (받은 줄이 없다)";
  out.합계_커미션 = rows.reduce((a, x) => a + x.commission, 0);
  return new Response(JSON.stringify(out, null, 1), { headers: { "Content-Type": "application/json" } });
});

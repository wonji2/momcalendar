// 파싱 수집분을 브라우저에서 바로 서버에 넣는 통로 (사장님 지시 2026-08-06)
// 브라우저 탭이 닫히면 수집분이 통째로 날아간다(오늘 두 번 겪음) → 모으는 즉시 여기로 보낸다.
//
// ⚠ 인증을 두지 않는 이유: 시크릿을 브라우저 콘솔 코드에 넣으면 대화 기록에 남는다.
//   대신 (1) 인스타 페이지에서만 (2) 한 번에 50건까지 (3) 형식이 맞는 것만 받는다.
//   parse_stash 는 '승인 전 임시 보관함'이라 여기에 쓰레기가 들어와도 DB 본체는 안전하고,
//   내가 승인표를 만들 때 어차피 전수 검토한다.
const SB  = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = {
  "Access-Control-Allow-Origin": "https://www.instagram.com",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const okDate = (s: unknown) => typeof s === "string" && /^\d{1,2}-\d{1,2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const origin = req.headers.get("origin") ?? "";
  if (!/^https:\/\/(www\.)?instagram\.com$/.test(origin)) return json({ error: "허용되지 않은 출처" }, 403);

  let rows: any;
  try { rows = (await req.json())?.rows; } catch { return json({ error: "bad json" }, 400); }
  if (!Array.isArray(rows) || !rows.length) return json({ error: "rows 가 비었다" }, 400);

  const clean = rows.slice(0, 50).filter((x: any) =>
    x && typeof x.h === "string" && x.h.length <= 40 &&
    typeof x.nm === "string" && x.nm.length >= 3 && x.nm.length <= 80 &&
    okDate(x.o) && okDate(x.e));
  if (!clean.length) return json({ error: "형식이 맞는 행이 없다", sent: rows.length }, 400);

  const r = await fetch(`${SB}/rest/v1/rpc/stash_put`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p: clean }),
  });
  const t = await r.text();
  return json({ status: r.status, inserted: Number(t) || 0, accepted: clean.length, sent: rows.length });
});

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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // ── 프로필 수집분 (2026-08-21 신설) ─────────────────────────
  // 수집 루프가 채집 즉시 여기로 쏜다. 탭이 닫혀도 유실이 없다.
  // (드레인 방식은 결과에 슬래시가 많아 도구가 차단하고, base64 는 출력 한도에 잘린다 — 실측)
  // 검증: 핸들 형식 + 길이 상한. seller_profile 은 통계 테이블이라 본체 DB 와 분리돼 있다.
  if (Array.isArray(body?.profiles) && body.profiles.length) {
    const ps = body.profiles.slice(0, 30).filter((x: any) =>
      x && typeof x.h === "string" && /^[a-z0-9._]{1,40}$/i.test(x.h));
    let saved = 0;
    for (const x of ps) {
      const p = {
        insta: x.h,
        followers: Number.isFinite(x.fo) ? x.fo : null,
        posts: Number.isFinite(x.po) ? x.po : null,
        following: Number.isFinite(x.fg) ? x.fg : null,
        full_name: typeof x.fn === "string" ? x.fn.slice(0, 120) : null,
        biography: typeof x.bio === "string" ? x.bio.slice(0, 2000) : null,
        external_url: typeof x.url === "string" ? x.url.slice(0, 500) : null,
        is_private: typeof x.pv === "boolean" ? x.pv : null,
        is_verified: typeof x.vf === "boolean" ? x.vf : null,
        is_business: typeof x.biz === "boolean" ? x.biz : null,
        category: typeof x.cat === "string" ? x.cat.slice(0, 80) : null,
        profile_pic: typeof x.pic === "string" ? x.pic.slice(0, 1000) : null,
      };
      const r = await fetch(`${SB}/rest/v1/rpc/seller_profile_upsert`, {
        method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p }),
      });
      if (r.ok) saved++;
      await r.text();
    }
    return json({ mode: "profiles", saved, sent: body.profiles.length });
  }

  const rows: any = body?.rows;
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

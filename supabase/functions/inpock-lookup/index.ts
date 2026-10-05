// 셀러 인포크 대조 (사장님 지시 2026-10-05)
//
// 왜: *"관리자 파싱에서 … 일정수확기 (실제 그 셀러 인스타가서 공구랑 상품명 기간 맞는지까지 확인) 더 고도화 시켜"*
//   인스타는 실시간으로 못 친다(브라우저 CORS · 서버 로그인벽·429) → **셀러 본인 인포크**로 대조한다(사장님 동의 "ㅇㅇ둘다하고").
//   브라우저는 인포크도 CORS 로 못 친다 → 여기서 대신 친다(선례 cafe-lookup).
//
// 🔑 파싱·판정은 **여기 짜지 않았다.** `core.gen.mjs` 는 로컬 수확기(scratchpad/inpock_harvest.mjs)와
//   판정(tools/daily/verify_judge.mjs)을 그대로 묶은 것이다 — 사본이 둘이면 한쪽만 고쳐진다(규칙 0-P 사고).
//   고칠 땐 원본을 고치고 `node tools/daily/build_inpock_lookup.mjs --deploy`.
//
// 요청:  POST { handle:"seonwoone", rows:[{ k:3, name:"꿈잉 …", open_date:"2026-10-07", end_date:"2026-10-10" }] }
//        한 번에 **셀러 1명**(무료 플랜 CPU 2초 — 여러 명을 한 요청에 넣으면 넘는다). 화면이 셀러별로 나눠 부른다.
// 응답:  { ok, handle, slug, found, count, items:[{name,open,end,url}], verdicts:[{k,code,nameLoose,best}], today, core }
//        code = ok(✅일치) · regong(🔁재공구) · date(⚠기간다름) · none(❔확인불가) — 뜻은 verify_judge.mjs 머리말.
//
// 🔒 **사장님 계정(app_admins)만.** 아무나 부르면 우리 서버가 인포크 대리 수집 통로가 된다.
//   슬러그는 손님이 넘기지 못한다 — DB `seller_inpock`(비공개 표)에서 서버가 직접 읽는다.
import { harvest, judgeInpock, CORE_HASH } from "./core.gen.mjs";

const SB = Deno.env.get("SUPABASE_URL")!;
const SKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors(origin: string | null) {
  const ok = ["https://momcalendar.com", "https://www.momcalendar.com"];
  const o = origin && ok.includes(origin) ? origin : "https://momcalendar.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
  };
}

async function sb(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } });
  if (!r.ok) return null;
  return await r.json().catch(() => null);
}

async function isAdmin(req: Request): Promise<boolean> {
  const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!tok) return false;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SKEY, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return false;
  const u = await r.json().catch(() => null);
  if (!u?.id) return false;
  const a = await sb(`app_admins?user_id=eq.${u.id}&select=user_id`);
  return !!a?.length;
}

const HANDLE_RE = /^[A-Za-z0-9._]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  const H = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...H, "Content-Type": "application/json" } });

  try {
    if (req.method !== "POST") return json({ ok: false, reason: "POST 만 받는다" }, 405);
    if (!(await isAdmin(req))) return json({ ok: false, reason: "관리자 로그인이 필요해요" }, 401);

    const body = await req.json().catch(() => null);
    const handle = String(body?.handle ?? "").trim().replace(/^@/, "");
    if (!HANDLE_RE.test(handle)) return json({ ok: false, reason: "핸들 형식이 아니다" }, 400);
    const rows = (Array.isArray(body?.rows) ? body.rows : []).slice(0, 80)
      .filter((r: any) => r && typeof r.name === "string" && DATE_RE.test(String(r.open_date ?? "")))
      .map((r: any) => ({
        k: r.k,
        name: String(r.name).slice(0, 120),
        open_date: String(r.open_date),
        // 마감이 비어 오면 오픈+3 (DB등록규칙 1) — 판정이 빈 값과 비교하지 않게
        end_date: DATE_RE.test(String(r.end_date ?? "")) ? String(r.end_date)
          : new Date(Date.parse(r.open_date + "T00:00:00Z") + 3 * 864e5).toISOString().slice(0, 10),
      }));

    // 슬러그 ≠ 핸들 (892쌍 중 430쌍이 다르다) — 표는 DB 한 곳. 대소문자만 다른 경우까지 본다.
    const cand = [...new Set([handle, handle.toLowerCase()])].map((h) => `"${h}"`).join(",");
    const m = await sb(`seller_inpock?insta=in.(${encodeURIComponent(cand)})&select=slug&limit=1`);
    const known = m?.[0]?.slug ? String(m[0].slug) : "";

    const r = await harvest(handle, known);
    const items = r && Array.isArray(r.rows) ? r.rows : [];
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);   // KST 오늘

    const verdicts = rows.map((row: any) => {
      const j = judgeInpock(row, items, today);
      return {
        k: row.k, code: j.code, nameLoose: j.nameLoose,
        best: j.best ? { name: j.best.name, open: j.best.open, end: j.best.end, url: j.best.url } : null,
      };
    });

    return json({
      ok: true, handle, slug: r?.slug ?? known ?? "", found: !!r, blocks: r?.blocks ?? 0, count: items.length,
      items: items.slice(0, 60).map((x: any) => ({ name: x.name, open: x.open, end: x.end, url: x.url })),
      verdicts, today, core: CORE_HASH,
    });
  } catch (e) {
    return json({ ok: false, reason: String(e).slice(0, 150) }, 500);
  }
});

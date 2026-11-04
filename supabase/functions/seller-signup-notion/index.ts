// 📒 셀러 가입 → 노션 자동 기록 (사장님 2026-11-04 「셀러가입 들어오는 셀러정보 인스타아이디 팔로워수 이메일 이름 노션에 자동으로 쌓이게」)
//   register.html 가입(rpc seller_signup → sellers 표)으로 들어온 셀러를 노션 「셀러 가입 (자동수집)」 표에 한 줄씩 쌓는다.
//   · 5분마다 pg_cron 이 호출(헤더 x-cron-secret). 아직 안 쌓인 셀러(notion_synced_at 없음)를 최대 20명씩.
//   · 팔로워는 seller_profile(PC 인스타 수집기가 채움)에서 가져온다. 새 가입은 아직 비어 있을 수 있어, 수집된 뒤(14일 안) 같은 줄을 고쳐 쓴다.
//   · 노션 토큰은 Edge 시크릿 NOTION_TOKEN (벤더 접수 표와 같은 연동). 표 번호는 비밀값이 아니라 코드에 둔다.
//   · 비밀번호·PIN·연락처 외 민감값은 노션에 보내지 않는다(이름·인스타·이메일·연락처·팔로워만).
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") || "";
const NOTION_DB = Deno.env.get("NOTION_SIGNUP_DB_ID") || "bc424504-4957-4d8a-a23e-4be2078c4b37";   // 「셀러 가입 (자동수집)」 (벤더 내부용 아래)

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", ...((init.headers as Record<string, string>) || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`sb ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const rt = (s: string) => ({ rich_text: s ? [{ text: { content: s.slice(0, 1900) } }] : [] });
const handleOf = (s: any) => String(s.login_insta || s.insta || "").replace(/^@/, "").trim();

async function followersOf(handle: string): Promise<number | null> {
  if (!handle) return null;
  try {
    const rows = await sb(`seller_profile?select=followers&insta=eq.${encodeURIComponent(handle.toLowerCase())}&order=checked_at.desc.nullslast&limit=1`);
    const v = rows?.[0]?.followers;
    return typeof v === "number" ? v : null;
  } catch { return null; }
}
function props(s: any, followers: number | null) {
  const h = handleOf(s);
  return {
    "셀러명": { title: [{ text: { content: String(s.name || h || "(이름없음)").slice(0, 200) } }] },
    "인스타그램 아이디": rt(h ? `@${h}` : ""),
    "인스타 주소": { url: h ? `https://www.instagram.com/${h}/` : null },
    "팔로워": { number: followers },
    "이메일": { email: s.email || null },
    "대표자명(이름)": rt(String(s.contact_name || "")),
    "연락처": { phone_number: s.phone || null },
    "가입일시": { date: { start: s.created_at } },
    "승인상태": { select: { name: s.login_active ? "승인됨" : "승인대기" } },
    "가입번호": { number: s.id },
  };
}
async function notion(method: string, url: string, body: unknown) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`notion ${r.status} ${JSON.stringify(j).slice(0, 250)}`);
  return j;
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);
  if (!NOTION_TOKEN) return json({ ok: false, msg: "NOTION_TOKEN 없음" }, 500);
  const out = { created: 0, updated: 0, errors: [] as string[] };
  const cols = "id,name,login_insta,insta,email,contact_name,phone,login_active,created_at,notion_page_id";
  // ① 새 가입 → 노션에 한 줄
  const fresh = await sb(`sellers?select=${cols}&notion_synced_at=is.null&login_insta=not.is.null&order=id&limit=20`);
  for (const s of fresh || []) {
    try {
      const f = await followersOf(handleOf(s));
      const page = await notion("POST", "https://api.notion.com/v1/pages", { parent: { database_id: NOTION_DB }, properties: props(s, f) });
      await sb(`sellers?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notion_page_id: page.id, notion_synced_at: new Date().toISOString(), notion_error: null, notion_has_followers: f !== null }) });
      out.created++;
    } catch (e) {
      out.errors.push(`#${s.id} ${String(e).slice(0, 160)}`);
      await sb(`sellers?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notion_error: String(e).slice(0, 300) }) }).catch(() => {});
    }
  }
  // ② 팔로워가 뒤늦게 수집된 최근 가입 → 같은 줄 고치기
  const late = await sb(`sellers?select=${cols}&notion_page_id=not.is.null&notion_has_followers=eq.false&created_at=gte.${new Date(Date.now() - 14 * 864e5).toISOString()}&order=id&limit=20`);
  for (const s of late || []) {
    try {
      const f = await followersOf(handleOf(s));
      if (f === null) continue;
      await notion("PATCH", `https://api.notion.com/v1/pages/${s.notion_page_id}`, { properties: { "팔로워": { number: f } } });
      await sb(`sellers?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notion_has_followers: true }) });
      out.updated++;
    } catch (e) { out.errors.push(`#${s.id} 팔로워 ${String(e).slice(0, 120)}`); }
  }
  return json({ ok: out.errors.length === 0, ...out });
});

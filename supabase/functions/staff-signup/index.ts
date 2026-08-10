// 스탭 계정 만들기 (사장님 지시 2026-08-10 "가입 신청이 안된대")
//
// 왜 필요한가: 7/23 보안 정비 때 "가입만 하면 관리자" 구멍을 막으려고
//   Supabase 공개 회원가입(disable_signup)을 껐다. 그런데 그 뒤 staff.html 에
//   회원가입 화면을 만들면서 서버가 막혀 있다는 걸 확인하지 않았다.
//   → 화면에서는 가입되는 것처럼 보이지만 "Signups not allowed" 만 떴다.
//
// 공개 회원가입을 다시 켜면 아무나 계정을 만들 수 있다. 그래서 여기서만 만든다.
//   · 가입코드를 **서버에서** 검증한다(화면 검증은 우회할 수 있다)
//   · service_role 로 계정을 만들고 곧바로 이메일 확인 처리
//   · 계정만 생기고 **권한은 없다**. 사장님이 스탭 관리에서 승인해야 쓸 수 있다.
const SB  = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CODE = Deno.env.get("STAFF_SIGNUP_CODE") ?? "momcal260610";

function cors(origin: string | null) {
  const ok = ["https://momcalendar.com", "https://www.momcalendar.com"];
  const o = origin && ok.includes(origin) ? origin : "https://momcalendar.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
}

Deno.serve(async (req) => {
  const H = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...H, "Content-Type": "application/json" } });

  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b?.email ?? "").trim().toLowerCase();
    const password = String(b?.password ?? "");
    const code = String(b?.code ?? "").trim();

    if (code !== CODE) return json({ error: "가입코드가 올바르지 않아요. 사장님에게 코드를 받아주세요." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "이메일 형식이 아니에요." }, 400);
    if (password.length < 8) return json({ error: "비밀번호는 8자 이상으로 해주세요." }, 400);

    const r = await fetch(`${SB}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const t = await r.text();
    if (!r.ok) {
      // 이미 있는 계정이면 안내만 바꿔 준다(가입 시도 자체를 막지는 않는다)
      if (/already|exists|registered/i.test(t))
        return json({ error: "이미 가입된 아이디예요. 로그인해 주세요." }, 409);
      return json({ error: "가입에 실패했어요. 잠시 뒤 다시 시도해 주세요.", detail: t.slice(0, 200) }, 500);
    }
    return json({ ok: true, note: "가입됐어요. 사장님이 승인해야 사용할 수 있어요." });
  } catch (e) {
    return json({ error: "가입 처리 중 문제가 생겼어요.", detail: String(e).slice(0, 150) }, 500);
  }
});

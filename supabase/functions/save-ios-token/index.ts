// ══════════════════════════════════════════════════════════
//  save-ios-token  —  아이폰 앱의 APNs 디바이스 토큰 저장/해제
//
//  앱(웹뷰)이 push_ios 에 직접 못 쓰게 하고(RLS 전면 차단) 이 함수만 대신 써준다.
//  save-push-sub(웹푸시)와 같은 사상. 웹푸시 쪽은 건드리지 않는다.
//
//  action:'on'  → 토큰 저장/갱신 (fail_count 0 리셋)
//  action:'off' → fail_count 99 로 올려 발송 대상에서 제외
//
//  ⚠ 공개 엔드포인트다. 자기 device_id 한 건만 건드릴 수 있게 하고 형식을 전부 검사한다.
//  ⚠ APNs 토큰은 기기·앱 재설치마다 바뀐다 → 앱은 켤 때마다 이걸 부른다(그게 정상).
// ══════════════════════════════════════════════════════════

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOW_ORIGINS = [
  "https://momcalendar.com",
  "https://www.momcalendar.com",
  "https://wonji2.github.io",
];

function cors(origin: string | null) {
  const o = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

const isDeviceId = (v: unknown) =>
  typeof v === "string" && v.length >= 8 && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);

// APNs 토큰은 16진수 문자열이다. 지금은 64자지만 애플이 늘릴 수 있어 폭을 둔다.
const isApnsToken = (v: unknown) =>
  typeof v === "string" && v.length >= 60 && v.length <= 200 && /^[0-9a-fA-F]+$/.test(v);

async function sb(path: string, init: RequestInit) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SRV,
      Authorization: `Bearer ${SB_SRV}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, origin); }

  const device = body.device_id;
  const action = body.action === "off" ? "off" : "on";
  if (!isDeviceId(device)) return json({ error: "bad device_id" }, 400, origin);

  if (action === "off") {
    const r = await sb(`push_ios?device_id=eq.${device}`, {
      method: "PATCH",
      body: JSON.stringify({ fail_count: 99 }),
    });
    if (!r.ok) return json({ error: "db", status: r.status }, 500, origin);
    return json({ ok: true, action: "off" }, 200, origin);
  }

  const token = body.apns_token;
  if (!isApnsToken(token)) return json({ error: "bad apns_token" }, 400, origin);

  // dev = TestFlight/Xcode 빌드, prod = 스토어 배포. 보낼 서버가 달라서 반드시 구분해 저장한다.
  const env = body.env === "dev" ? "dev" : "prod";
  const ua = typeof body.ua === "string" ? body.ua.slice(0, 300) : null;

  const r = await sb("rpc/push_ios_upsert", {
    method: "POST",
    body: JSON.stringify({ p_device: device, p_token: token, p_env: env, p_ua: ua }),
  });
  if (!r.ok) return json({ error: "db", status: r.status, msg: await r.text() }, 500, origin);

  return json({ ok: true, action: "on", env }, 200, origin);
});

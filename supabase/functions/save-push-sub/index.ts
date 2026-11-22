// ══════════════════════════════════════════════════════════
//  save-push-sub  —  브라우저의 푸시 구독 정보를 저장/해제
//
//  브라우저가 push_subs 에 직접 쓰지 못하게 하고(RLS 로 전면 차단),
//  이 함수만 service_role 로 대신 써준다.
//
//  action:'on'  → 구독 저장(있으면 갱신), fail_count 0 으로 리셋
//  action:'off' → fail_count 99 로 올려 발송 대상에서 제외
//
//  ⚠ 공개 엔드포인트다. 누구나 부를 수 있으므로
//    · 자기 device_id 한 건만 건드릴 수 있게 하고 (전체 수정 불가)
//    · endpoint 는 실제 푸시 서비스 도메인만 허용하고
//    · 길이·형식을 전부 검사한다.
// ══════════════════════════════════════════════════════════

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 사이트 외 도메인에서의 호출은 브라우저 단계에서 차단
const ALLOW_ORIGINS = [
  "https://momcalendar.com",
  "https://www.momcalendar.com",
  "https://wonji2.github.io",
];

// 실제 푸시 서비스만 (엉뚱한 주소를 저장해두는 것 방지)
const ALLOW_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
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

const isB64u = (v: unknown, min: number, max: number) =>
  typeof v === "string" && v.length >= min && v.length <= max && /^[A-Za-z0-9_\-=+/]+$/.test(v);

function isPushEndpoint(v: unknown) {
  if (typeof v !== "string" || v.length > 600) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== "https:") return false;
  return ALLOW_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
}

function sbFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SRV,
      Authorization: `Bearer ${SB_SRV}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, msg: "method" }, 405, origin);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, msg: "bad json" }, 400, origin); }

  const device_id = b.device_id;
  if (!isDeviceId(device_id)) return json({ ok: false, msg: "bad device_id" }, 400, origin);

  // ── 알림 끄기 ──
  if (b.action === "off") {
    const r = await sbFetch(`push_subs?device_id=eq.${encodeURIComponent(device_id as string)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ fail_count: 99 }),
    });
    return json({ ok: r.ok }, r.ok ? 200 : 500, origin);
  }

  // ── 알림 켜기 ──
  if (!isPushEndpoint(b.endpoint)) return json({ ok: false, msg: "bad endpoint" }, 400, origin);
  if (!isB64u(b.p256dh, 60, 200)) return json({ ok: false, msg: "bad p256dh" }, 400, origin);
  if (!isB64u(b.auth, 16, 60)) return json({ ok: false, msg: "bad auth" }, 400, origin);

  const row = {
    device_id,
    endpoint: b.endpoint,
    p256dh: b.p256dh,
    auth: b.auth,
    ua: typeof b.ua === "string" ? b.ua.slice(0, 300) : null,
    fail_count: 0,            // 다시 켰으니 실패 이력 초기화
  };

  const r = await sbFetch("push_subs", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });

  if (!r.ok) return json({ ok: false, msg: (await r.text()).slice(0, 200) }, 500, origin);
  return json({ ok: true }, 200, origin);
});

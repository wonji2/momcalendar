// ══════════════════════════════════════════════════════════
//  send-open-push-ios  —  찜한 공구 "오늘 오픈" 아침 알림 (아이폰 앱 / APNs)
//
//  send-open-push(웹푸시)의 아이폰 판. 문구·링크 규칙은 웹과 **똑같이** 맞춘다.
//    · "열렸어요" 같은 완료형 금지 (오픈 시각을 모른다) — "오늘 오픈" 까지만
//    · 링크는 반드시 맘캘린더를 거친다. 셀러 인스타·결제링크 직행 금지
//
//  흐름
//    1) push_targets_ios() RPC  (오늘 오픈 + 미발송 + fail_count<5 를 걸러서 준다)
//    2) device_id 로 묶어 **한 사람당 알림 1건**
//    3) APNs 로 발송 → 성공 push_log(kind='open_ios') / 400·410 → push_ios_fail
//
//  호출: pg_cron 이 x-cron-secret 헤더로. 손님 키로는 못 부른다.
//  점검: ?dry=1 (보내지 않고 대상만) · ?selftest=1 (APNs 키가 제대로 읽히는지만)
//
//  ⚠ APNs 는 dev(TestFlight·Xcode)와 prod(스토어)의 서버 주소가 다르다.
//    토큰마다 env 를 저장해두고 그에 맞는 서버로 보낸다. 틀리면 400 BadDeviceToken 이 난다.
// ══════════════════════════════════════════════════════════

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";

// 애플 개발자 계정이 나오면 채운다 (Supabase 시크릿에만 둔다 — 레포에 절대 두지 않는다)
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") || "";   // .p8 파일 내용 그대로
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";   // 10자
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || ""; // 10자
const BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") || "com.wontsbe.momcalendar";

const SITE = "https://momcalendar.com/";
const HOST = { prod: "https://api.push.apple.com", dev: "https://api.sandbox.push.apple.com" };

const b64u = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/[=]+$/, "");
};

/** .p8(PEM PKCS8) → WebCrypto 키 */
async function importP8(pem: string) {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
}

/** APNs 인증 토큰 (ES256 JWT). 애플은 1시간 미만 재발급을 거부하므로 회차마다 1개만 만든다. */
async function apnsJwt() {
  const key = await importP8(APNS_KEY_P8);
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID })));
  const payload = b64u(new TextEncoder().encode(JSON.stringify({
    iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000),
  })));
  const signing = new TextEncoder().encode(`${header}.${payload}`);
  // WebCrypto 의 ECDSA 서명은 이미 r||s 원형이라 JOSE 형식 그대로 쓸 수 있다(DER 변환 불필요)
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, signing),
  );
  return `${header}.${payload}.${b64u(sig)}`;
}

type Target = {
  device_id: string; apns_token: string; env: string;
  gonggu_id: number; gonggu_name: string; seller: string | null;
};

/** 웹푸시와 완전히 같은 문구 규칙 */
function message(items: { id: number; name: string }[]) {
  const n = items.length;
  if (n === 1) {
    return { title: "내가 찜한 공구 오늘 오픈", body: items[0].name, url: `${SITE}?g=${items[0].id}` };
  }
  return {
    title: `내가 찜한 공구 ${n}건 오늘 오픈`,
    body: `${items[0].name} 외 ${n - 1}건 눌러서 확인하세요`,
    url: SITE,
  };
}

async function sbFetch(path: string, init: RequestInit) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`,
      "Content-Type": "application/json", Prefer: "return=minimal",
      ...(init.headers || {}),
    },
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  // 키가 아직 없다 → 500 으로 죽지 않고 "무엇이 없는지" 를 말해준다
  const missing = [
    !APNS_KEY_P8 && "APNS_KEY_P8",
    !APNS_KEY_ID && "APNS_KEY_ID",
    !APNS_TEAM_ID && "APNS_TEAM_ID",
  ].filter(Boolean);
  if (missing.length) {
    return json({
      ok: false, ready: false, missing,
      hint: "애플 개발자 계정 → Certificates > Keys 에서 APNs 키(.p8)를 만들고 Supabase 시크릿에 넣으세요.",
    }, 200);
  }

  if (url.searchParams.get("selftest") === "1") {
    try {
      const t = await apnsJwt();
      return json({ ok: true, selftest: true, jwtParts: t.split(".").length, bundle: BUNDLE_ID });
    } catch (e) {
      return json({ ok: false, selftest: true, error: String(e) }, 500);
    }
  }

  const r = await sbFetch("rpc/push_targets_ios", { method: "POST", body: "{}" });
  if (!r.ok) return json({ ok: false, step: "push_targets_ios", status: r.status, msg: await r.text() }, 500);
  const rows: Target[] = await r.json();

  // 한 사람당 알림 1건으로 묶는다 (5개 찜했다고 5번 울리면 안 된다)
  const byDevice = new Map<string, { token: string; env: string; items: { id: number; name: string }[] }>();
  for (const t of rows) {
    let g = byDevice.get(t.device_id);
    if (!g) { g = { token: t.apns_token, env: t.env === "dev" ? "dev" : "prod", items: [] }; byDevice.set(t.device_id, g); }
    g.items.push({ id: t.gonggu_id, name: t.gonggu_name });
  }

  if (dry) {
    return json({
      ok: true, dry: true, people: byDevice.size, rows: rows.length,
      preview: [...byDevice.entries()].slice(0, 5).map(([d, g]) => ({ device: d.slice(0, 8), env: g.env, ...message(g.items) })),
    });
  }

  const jwt = await apnsJwt();
  const okLog: { device_id: string; gonggu_id: number; kind: string }[] = [];
  const dead: string[] = [];
  let sent = 0, failed = 0;

  for (const [device, g] of byDevice) {
    const m = message(g.items);
    const payload = JSON.stringify({
      aps: {
        alert: { title: m.title, body: m.body },
        sound: "default",
        badge: g.items.length,
        "thread-id": "gonggu-open",
      },
      url: m.url,
    });
    try {
      const res = await fetch(`${HOST[g.env as "prod" | "dev"]}/3/device/${g.token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": BUNDLE_ID,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 6 * 3600),
        },
        body: payload,
      });
      if (res.ok) {
        sent++;
        for (const it of g.items) okLog.push({ device_id: device, gonggu_id: it.id, kind: "open_ios" });
      } else {
        failed++;
        // 410 Unregistered / 400 BadDeviceToken = 죽은 토큰
        if (res.status === 410 || res.status === 400) dead.push(g.token);
      }
    } catch { failed++; }
  }

  if (okLog.length) {
    for (let i = 0; i < okLog.length; i += 500) {
      await sbFetch("push_log", { method: "POST", body: JSON.stringify(okLog.slice(i, i + 500)) });
    }
  }
  for (const tk of dead) {
    await sbFetch("rpc/push_ios_fail", { method: "POST", body: JSON.stringify({ p_token: tk }) });
  }

  return json({ ok: true, people: byDevice.size, sent, failed, dead: dead.length });
});

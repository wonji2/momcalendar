// 아이폰 앱 아이콘 숫자를 0 으로 되돌린다 (제보 #21 「알림에 아무것도 없는데 어플에 1이 안 사라져요」 2026-11-16)
//   오픈 알림(send-open-push-ios)이 aps.badge 로 숫자를 올리는데, 앱을 열어 지우는 코드(index.html)가 닿지 않는 기기에도
//   숫자가 남아 있다 → 등록된 아이폰 전부에 { aps: { badge: 0 } } 만 보낸다. 글·소리가 없어 알림은 뜨지 않고 숫자만 사라진다.
//   호출: x-cron-secret 머리말. ?dry=1 이면 대상 수만. 표는 읽기만 한다(죽은 토큰 정리는 send-open-push-ios 몫).
//   비밀값은 Supabase 시크릿에서만 읽는다(코드에 두지 않는다).
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const APNS_KEY_P8 = Deno.env.get("APNS_KEY_P8") || "";
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID") || "";
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID") || "";
const BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID") || "com.wontsbe.momcalendar";
const HOST = { prod: "https://api.push.apple.com", dev: "https://api.sandbox.push.apple.com" };

const b64u = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/[=]+$/, ""); };
async function apnsJwt() {
  const body = APNS_KEY_P8.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/[^A-Za-z0-9+/=]/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(body), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const h = b64u(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: APNS_KEY_ID })));
  const p = b64u(new TextEncoder().encode(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64u(sig)}`;
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  if (!APNS_KEY_P8 || !APNS_KEY_ID || !APNS_TEAM_ID) return json({ ok: false, error: "APNs 시크릿 없음" }, 200);
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const r = await fetch(`${SB_URL}/rest/v1/push_ios?select=apns_token,env&fail_count=lt.3&limit=5000`, { headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}` } });
  if (!r.ok) return json({ ok: false, step: "push_ios", status: r.status }, 500);
  const rows = await r.json() as { apns_token: string; env: string }[];
  if (dry) return json({ ok: true, dry: true, devices: rows.length });
  const jwt = await apnsJwt();
  let sent = 0, failed = 0; const codes: Record<string, number> = {};
  for (const t of rows) {
    try {
      const res = await fetch(`${HOST[t.env === "dev" ? "dev" : "prod"]}/3/device/${t.apns_token}`, {
        method: "POST",
        headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE_ID, "apns-push-type": "alert", "apns-priority": "5", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3 * 86400) },
        body: JSON.stringify({ aps: { badge: 0 } }),
      });
      if (res.ok) sent++; else { failed++; codes[String(res.status)] = (codes[String(res.status)] || 0) + 1; }
      await res.body?.cancel();
    } catch { failed++; codes.err = (codes.err || 0) + 1; }
  }
  return json({ ok: true, devices: rows.length, sent, failed, codes });
});

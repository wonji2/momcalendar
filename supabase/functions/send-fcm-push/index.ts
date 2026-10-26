// ══════════════════════════════════════════════════════════
//  send-fcm-push  —  안드로이드 웹뷰 앱 알림 (FCM HTTP v1) · 2026-10-26
//
//  웹푸시 발송 함수 3개(send-open-push · send-sale-push · send-live-push)의 안드로이드 앱 판.
//  **대상 규칙·문구·링크는 웹과 똑같다** — 다른 것은 받는 곳(push_fcm 토큰)과 보내는 길(FCM)뿐.
//    mode=open  찜한 공구 오늘 오픈·마감 (웹 open-push 와 같은 시각) · 맘캘 공구는 한 건씩 판매 링크로
//    mode=sale  알림 켠 세일 오늘 시작
//    mode=live  찜한 라방 곧 시작 (5분마다)
//  기록 표·kind 는 웹과 같다(push_log · sale_push_log · live_push_log) → 두 번 안 간다.
//
//  시크릿: FCM_SA_B64 = Firebase 서비스 계정 JSON 을 base64 로(프로젝트 momcalendar-77f89).
//          원본 파일 = work-backup/secrets/firebase/fcm-service-account.json (비공개 백업에만)
//  호출: pg_cron 이 x-cron-secret 헤더로(PUSH_CRON_SECRET). 손님 키로는 못 부른다.
//  점검: ?dry=1 (보내지 않고 대상·문구만) · ?selftest=1 (서비스 계정으로 구글 토큰을 받아지는지만)
//        ?device=<id> (그 기기에만) · mode=test&device=<id> (대상 규칙 없이 시험 알림 1건)
// ══════════════════════════════════════════════════════════

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const SA_B64 = Deno.env.get("FCM_SA_B64") || "";
const SITE = "https://momcalendar.com/";
const LIVE_URL = `${SITE}#live`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function sbFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
const seoulToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hm = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

// ── 구글 접근 토큰 (서비스 계정 JWT → oauth2) ──
type SA = { client_email: string; private_key: string; project_id: string };
let saCache: SA | null = null;
function sa(): SA {
  if (!saCache) saCache = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(SA_B64), (c) => c.charCodeAt(0))));
  return saCache!;
}
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const u = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function accessToken(): Promise<string> {
  const s = sa();
  const pem = s.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: s.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3300 }));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${claim}.${sig}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("oauth: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

type Msg = { title: string; body: string; url: string; tag: string };
// 보내기 — 결과: ok / dead(토큰 죽음) / fail
async function send(at: string, token: string, m: Msg): Promise<"ok" | "dead" | "fail"> {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa().project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: { title: m.title, body: m.body },
      data: { url: m.url },   // 앱(사이트 nativeBoot)이 누른 알림의 url 로 보낸다
      android: { priority: "high", ttl: "21600s", notification: { tag: m.tag, color: "#602090", channel_id: "momcal_default", default_sound: true, notification_priority: "PRIORITY_HIGH" } },   // 앱이 만든 「맘캘린더 알림」 채널(중요도 높음 = 팝업)
    } }),
  });
  if (r.ok) return "ok";
  const t = await r.text();
  if (r.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(t)) return "dead";
  return "fail";
}

// ── 문구 (웹 send-open-push 의 buildPayload 와 같다 — 바꾸면 웹도 같이) ──
const badge = (k: string) => k === "end" ? "[오늘 마감]" : "[오늘 오픈]";
type Item = { id: number; name: string; kind: string };
function openMsg(items: Item[], today: string, direct?: string): Msg {
  const n = items.length;
  if (direct) return { title: "내가 찜한 공구", body: `${badge(items[0].kind)} ${items[0].name}`, url: direct, tag: `mc-open-${today}-${items[0].id}` };
  if (n === 1) return { title: "내가 찜한 공구", body: `${badge(items[0].kind)} ${items[0].name}`, url: `${SITE}?g=${items[0].id}`, tag: `mc-open-${today}` };
  const opens = items.filter((i) => i.kind !== "end").length, ends = n - opens;
  const head = [opens ? `오늘 오픈 ${opens}건` : "", ends ? `오늘 마감 ${ends}건` : ""].filter(Boolean).join(" · ");
  return { title: `내가 찜한 공구 ${head}`, body: `${badge(items[0].kind)} ${items[0].name} 외 ${n - 1}건 눌러서 확인하세요`, url: SITE, tag: `mc-open-${today}` };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "open";
  const dry = url.searchParams.get("dry") === "1";
  const only = url.searchParams.get("device") || "";
  if (!SA_B64) return json({ ok: false, ready: false, missing: ["FCM_SA_B64"], hint: "Firebase 서비스 계정 JSON 을 base64 로 Supabase 시크릿 FCM_SA_B64 에" });
  if (url.searchParams.get("selftest") === "1") {
    try { const t = await accessToken(); return json({ ok: true, selftest: true, project: sa().project_id, token: t.length > 20 }); }
    catch (e) { return json({ ok: false, selftest: true, error: String(e) }, 500); }
  }
  const today = seoulToday();

  // 시험 알림: 그 기기 한 대에만(대상 규칙·기록 없이)
  if (mode === "test") {
    if (!only) return json({ ok: false, error: "device 필요" }, 400);
    const r = await sbFetch(`push_fcm?device_id=eq.${encodeURIComponent(only)}&select=fcm_token`);
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) return json({ ok: false, error: "그 기기의 토큰이 없다" }, 404);
    const res = await send(await accessToken(), rows[0].fcm_token, { title: "맘캘린더 알림 시험", body: "알림이 잘 오고 있어요", url: SITE, tag: "mc-test" });
    return json({ ok: res === "ok", result: res });
  }

  type Out = { device_id: string; token: string; msg: Msg; log: Record<string, unknown>[] };
  const outs: Out[] = [];
  let logTable = "";

  if (mode === "open") {
    logTable = "push_log";
    const r = await sbFetch("rpc/push_targets_fcm", { method: "POST", body: "{}" });
    if (!r.ok) return json({ ok: false, step: "push_targets_fcm", status: r.status, msg: await r.text() }, 500);
    let rows: { device_id: string; fcm_token: string; gonggu_id: number; gonggu_name: string; kind: string }[] = await r.json();
    if (only) rows = rows.filter((t) => t.device_id === only);
    const groups = new Map<string, { token: string; items: Item[] }>();
    for (const t of rows) {
      let g = groups.get(t.device_id);
      if (!g) { g = { token: t.fcm_token, items: [] }; groups.set(t.device_id, g); }
      if (!g.items.some((i) => i.id === t.gonggu_id)) g.items.push({ id: t.gonggu_id, name: t.gonggu_name, kind: t.kind === "end" ? "end" : "open" });
    }
    // 맘캘린더 공구는 한 건씩, 판매 링크로(웹과 같다 — 2026-10-25)
    const ids = [...new Set(rows.map((t) => t.gonggu_id))];
    const meta = new Map<number, { insta: string | null; pay_link: string | null }>();
    if (ids.length) { const mr = await sbFetch(`gonggu?id=in.(${ids.join(",")})&select=id,insta,pay_link`); if (mr.ok) for (const m of await mr.json()) meta.set(m.id, m); }
    const isOwn = (id: number) => (meta.get(id)?.insta || "") === "momcal_";
    const payOf = (id: number) => { const p = (meta.get(id)?.pay_link || "").trim(); return /^https?:\/\//i.test(p) ? p : ""; };
    for (const [device, g] of groups) {
      const own = g.items.filter((i) => isOwn(i.id) && i.kind !== "end" && payOf(i.id));
      const rest = g.items.filter((i) => !own.includes(i));
      for (const it of own) outs.push({ device_id: device, token: g.token, msg: openMsg([it], today, payOf(it.id)), log: [{ device_id: device, gonggu_id: it.id, kind: it.kind }] });
      if (rest.length) outs.push({ device_id: device, token: g.token, msg: openMsg(rest, today), log: rest.map((it) => ({ device_id: device, gonggu_id: it.id, kind: it.kind })) });
    }
  } else if (mode === "sale") {
    logTable = "sale_push_log";
    const r = await sbFetch("rpc/sale_push_targets_fcm", { method: "POST", body: "{}" });
    if (!r.ok) return json({ ok: false, step: "sale_push_targets_fcm", status: r.status, msg: await r.text() }, 500);
    let rows: { device_id: string; fcm_token: string; sale_id: number; brand: string; title: string; kind: string }[] = await r.json();
    if (only) rows = rows.filter((t) => t.device_id === only);
    const groups = new Map<string, { token: string; items: { id: number; label: string; kind: string }[] }>();
    for (const t of rows) {
      let g = groups.get(t.device_id);
      if (!g) { g = { token: t.fcm_token, items: [] }; groups.set(t.device_id, g); }
      if (!g.items.some((i) => i.id === t.sale_id)) g.items.push({ id: t.sale_id, label: `${t.brand} ${t.title}`, kind: t.kind || "start" });
    }
    for (const [device, g] of groups) {
      const n = g.items.length, end = g.items[0].kind === "end";
      const msg = n === 1
        ? { title: end ? "🛍 내가 알림 켠 세일 내일 마감" : "🛍 내가 알림 켠 세일 오늘 시작", body: g.items[0].label, url: `${SITE}#sale`, tag: `mc-sale-${today}` }
        : { title: `🛍 내가 알림 켠 세일 ${n}건 소식`, body: `${g.items[0].label} 외 ${n - 1}건 눌러서 확인하세요`, url: `${SITE}#sale`, tag: `mc-sale-${today}` };
      outs.push({ device_id: device, token: g.token, msg, log: g.items.map((it) => ({ device_id: device, sale_id: it.id, kind: it.kind })) });
    }
  } else if (mode === "live") {
    logTable = "live_push_log";
    const r = await sbFetch("rpc/live_push_targets_fcm", { method: "POST", body: "{}" });
    if (!r.ok) return json({ ok: false, step: "live_push_targets_fcm", status: r.status, msg: await r.text() }, 500);
    let rows: { device_id: string; fcm_token: string; show_id: number; title: string; channel_name: string | null; start_at: string }[] = await r.json();
    if (only) rows = rows.filter((t) => t.device_id === only);
    const groups = new Map<string, { token: string; items: typeof rows }>();
    for (const t of rows) {
      let g = groups.get(t.device_id);
      if (!g) { g = { token: t.fcm_token, items: [] }; groups.set(t.device_id, g); }
      if (!g.items.some((i) => i.show_id === t.show_id)) g.items.push(t);
    }
    for (const [device, g] of groups) {
      g.items.sort((a, b) => a.start_at.localeCompare(b.start_at));
      const a = g.items[0], n = g.items.length;
      const head = `${hm(a.start_at)} ${a.channel_name ? a.channel_name + " · " : ""}${a.title}`.slice(0, 120);
      const msg = n === 1
        ? { title: "찜한 라방이 곧 시작해요", body: head, url: LIVE_URL, tag: `mc-live-${a.show_id}` }
        : { title: `찜한 라방 ${n}개가 곧 시작해요`, body: `${head} 외 ${n - 1}개`, url: LIVE_URL, tag: `mc-live-${a.show_id}` };
      outs.push({ device_id: device, token: g.token, msg, log: g.items.map((it) => ({ device_id: device, show_id: it.show_id })) });
    }
  } else return json({ ok: false, error: "mode 는 open|sale|live|test" }, 400);

  if (dry) return json({ ok: true, dry: true, mode, today, messages: outs.length, preview: outs.slice(0, 20).map((o) => ({ device: o.device_id.slice(0, 8), ...o.msg })) });
  if (!outs.length) return json({ ok: true, mode, today, sent: 0, note: "발송 대상 없음" });

  const at = await accessToken();
  const okLog: Record<string, unknown>[] = [];
  const dead = new Set<string>();
  let sent = 0, failed = 0;
  for (const o of outs) {
    const res = await send(at, o.token, o.msg).catch(() => "fail" as const);
    if (res === "ok") { sent++; okLog.push(...o.log); }
    else { failed++; if (res === "dead") dead.add(o.token); }
  }
  for (let i = 0; i < okLog.length; i += 500) {
    await sbFetch(logTable, { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(okLog.slice(i, i + 500)) }).catch(() => {});
  }
  for (const tk of dead) await sbFetch("rpc/push_fcm_fail", { method: "POST", body: JSON.stringify({ p_token: tk }) }).catch(() => {});
  return json({ ok: true, mode, today, messages: outs.length, sent, failed, dead: dead.size });
});

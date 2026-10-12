// ══════════════════════════════════════════════════════════
//  send-sale-push  —  🔔 를 켜 둔 세일이 "오늘 시작" 인 날 아침 알림
//  매일 한국 09:05(UTC 00:05)에 pg_cron(sale-push)이 호출한다.
//  (send-open-push 와 같은 구조 — 공구 알림은 건드리지 않는다)
//
//  1) sale_push_targets() RPC  (오늘 시작 + 🔔 켬 + 미발송 + fail_count<5 를 이미 걸러줌)
//  2) device_id 별로 묶어서 한 사람당 알림 1건만
//  3) web-push 발송  4) 성공 → sale_push_log / 404·410 → push_subs.fail_count +1
//
//  ⚠ 시작 "시각"은 모른다 → "시작했어요" 완료형 금지. "오늘 시작" 까지만.
// ══════════════════════════════════════════════════════════
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:momcal@kakao.com";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";

const SITE = "https://momcalendar.com/";
const BATCH = 20;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function sbFetch(path: string, init: RequestInit = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
}
function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

type Target = { device_id: string; endpoint: string; p256dh: string; auth: string; sale_id: number; brand: string; title: string };
type Group = { device_id: string; endpoint: string; p256dh: string; auth: string; items: { id: number; label: string }[] };

// 링크는 반드시 맘캘린더 세일 탭(#sale)을 거치게 한다 — 사이트 방문이 사라지지 않게(공구 알림과 같은 원칙)
function buildPayload(g: Group, today: string) {
  const n = g.items.length;
  if (n === 1) {
    return { title: "🛍 내가 알림 켠 세일 오늘 시작", body: g.items[0].label, url: `${SITE}#sale`, tag: `mc-sale-${today}` };
  }
  return { title: `🛍 내가 알림 켠 세일 ${n}건 오늘 시작`, body: `${g.items[0].label} 외 ${n - 1}건 눌러서 확인하세요`, url: `${SITE}#sale`, tag: `mc-sale-${today}` };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const only = url.searchParams.get("device") || "";
  const today = seoulToday();

  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);

  try {
    const r = await sbFetch("rpc/sale_push_targets", { method: "POST", body: "{}" });
    if (!r.ok) return json({ ok: false, step: "sale_push_targets", status: r.status, msg: await r.text() }, 500);
    let targets: Target[] = await r.json();
    if (only) targets = targets.filter((t) => t.device_id === only);
    if (!targets.length) return json({ ok: true, today, targets: 0, sent: 0, note: "발송 대상 없음" });

    const groups = new Map<string, Group>();
    for (const t of targets) {
      let g = groups.get(t.device_id);
      if (!g) { g = { device_id: t.device_id, endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth, items: [] }; groups.set(t.device_id, g); }
      if (!g.items.some((i) => i.id === t.sale_id)) g.items.push({ id: t.sale_id, label: `${t.brand} ${t.title}` });
    }
    const list = [...groups.values()];
    if (dry) {
      return json({ ok: true, dry: true, today, targets: targets.length, devices: list.length,
        preview: list.slice(0, 20).map((g) => ({ device_id: g.device_id, ...buildPayload(g, today) })) });
    }

    const okLog: { device_id: string; sale_id: number; kind: string }[] = [];
    const dead: string[] = [];
    const errors: { device_id: string; status?: number; msg: string }[] = [];
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(list.slice(i, i + BATCH).map(async (g) => {
        try {
          const d = webpush.generateRequestDetails(
            { endpoint: g.endpoint, keys: { p256dh: g.p256dh, auth: g.auth } },
            JSON.stringify(buildPayload(g, today)),
            { TTL: 6 * 60 * 60 },
          );
          const res = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as BodyInit });
          if (res.ok) for (const it of g.items) okLog.push({ device_id: g.device_id, sale_id: it.id, kind: "start" });
          else if (res.status === 404 || res.status === 410) dead.push(g.device_id);
          else errors.push({ device_id: g.device_id, status: res.status, msg: (await res.text()).slice(0, 200) });
        } catch (e) { errors.push({ device_id: g.device_id, msg: String(e).slice(0, 200) }); }
      }));
    }
    for (let i = 0; i < okLog.length; i += 500) {
      await sbFetch("sale_push_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(okLog.slice(i, i + 500)) }).catch(() => {});
    }
    if (dead.length) await sbFetch("rpc/push_fail_bump", { method: "POST", body: JSON.stringify({ p_devices: dead }) }).catch(() => {});
    return json({ ok: true, today, targets: targets.length, devices: list.length, sent: list.length - dead.length - errors.length, logged: okLog.length, dead: dead.length, errors: errors.slice(0, 10), ms: Date.now() - t0 });
  } catch (e) {
    return json({ ok: false, msg: String(e) }, 500);
  }
});

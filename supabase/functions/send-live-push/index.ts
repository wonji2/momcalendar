// ══════════════════════════════════════════════════════════
//  send-live-push  —  찜한 라방이 곧 시작할 때(10분 전 무렵) 알림
//  pg_cron(live-push)이 5분마다 보고, 대상이 있을 때만 이 함수를 부른다 — supabase/sql/live_wish_103.sql
//  (send-sale-push 와 같은 구조 · 사장님 2026-10-24 「라방 알림은 어디서 받아 세일처럼 찜표시가 없네」)
//
//  1) live_push_targets() RPC (12분 안에 시작 + 찜 + 미발송 + fail_count<5)
//  2) device_id 별로 묶어 한 사람당 알림 1건  3) web-push  4) 성공 → live_push_log / 404·410 → push_subs.fail_count +1
//  ⚠ 링크는 맘캘린더 라방(#live)으로 — 사이트 방문이 사라지지 않게(공구·세일 알림과 같은 원칙). 이모지 없음(사장님 「라방 이모티콘 최소화」)
// ══════════════════════════════════════════════════════════
import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:momcal@kakao.com";
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const SITE = "https://momcalendar.com/";
// ⚠ 라방 하트는 아직 test.html 에만 있다(라이브 index 는 사장님 허락 대기) → 알림도 test 의 라방으로 연다. index 배포 때 LIVE_URL = `${SITE}#live` 로 바꾼다
const LIVE_URL = `${SITE}test.html#live`;
const BATCH = 20;
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const sbFetch = (path: string, init: RequestInit = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", ...(init.headers || {}) },
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const hm = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type Target = { device_id: string; endpoint: string; p256dh: string; auth: string; show_id: number; title: string; channel_name: string | null; start_at: string };
type Group = { device_id: string; endpoint: string; p256dh: string; auth: string; items: Target[] };

function buildPayload(g: Group) {
  const a = g.items[0], n = g.items.length;
  const head = `${hm(a.start_at)} ${a.channel_name ? a.channel_name + " · " : ""}${a.title}`.slice(0, 120);
  return n === 1
    ? { title: "찜한 라방이 곧 시작해요", body: head, url: LIVE_URL, tag: `mc-live-${a.show_id}` }
    : { title: `찜한 라방 ${n}개가 곧 시작해요`, body: `${head} 외 ${n - 1}개`, url: LIVE_URL, tag: `mc-live-${a.show_id}` };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);
  try {
    const r = await sbFetch("rpc/live_push_targets", { method: "POST", body: "{}" });
    if (!r.ok) return json({ ok: false, step: "live_push_targets", status: r.status, msg: await r.text() }, 500);
    const targets: Target[] = await r.json();
    if (!targets.length) return json({ ok: true, targets: 0, sent: 0, note: "발송 대상 없음" });
    const groups = new Map<string, Group>();
    for (const t of targets) {
      let g = groups.get(t.device_id);
      if (!g) { g = { device_id: t.device_id, endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth, items: [] }; groups.set(t.device_id, g); }
      if (!g.items.some((i) => i.show_id === t.show_id)) g.items.push(t);
    }
    const list = [...groups.values()];
    for (const g of list) g.items.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    if (dry) return json({ ok: true, dry: true, targets: targets.length, devices: list.length, preview: list.slice(0, 20).map((g) => ({ device_id: g.device_id, ...buildPayload(g) })) });

    const okLog: { device_id: string; show_id: number }[] = [];
    const dead: string[] = [];
    const errors: { device_id: string; status?: number; msg: string }[] = [];
    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(list.slice(i, i + BATCH).map(async (g) => {
        try {
          const d = webpush.generateRequestDetails({ endpoint: g.endpoint, keys: { p256dh: g.p256dh, auth: g.auth } }, JSON.stringify(buildPayload(g)), { TTL: 15 * 60 });   // 15분 지나면 버린다(방송이 이미 시작)
          const res = await fetch(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as BodyInit });
          if (res.ok) for (const it of g.items) okLog.push({ device_id: g.device_id, show_id: it.show_id });
          else if (res.status === 404 || res.status === 410) dead.push(g.device_id);
          else errors.push({ device_id: g.device_id, status: res.status, msg: (await res.text()).slice(0, 200) });
        } catch (e) { errors.push({ device_id: g.device_id, msg: String(e).slice(0, 200) }); }
      }));
    }
    for (let i = 0; i < okLog.length; i += 500) {
      await sbFetch("live_push_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(okLog.slice(i, i + 500)) }).catch(() => {});
    }
    if (dead.length) await sbFetch("rpc/push_fail_bump", { method: "POST", body: JSON.stringify({ p_devices: dead }) }).catch(() => {});
    return json({ ok: true, targets: targets.length, devices: list.length, sent: list.length - dead.length - errors.length, logged: okLog.length, dead: dead.length, errors: errors.slice(0, 10), ms: Date.now() - t0 });
  } catch (e) {
    return json({ ok: false, msg: String(e) }, 500);
  }
});

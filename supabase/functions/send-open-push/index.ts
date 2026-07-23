// ══════════════════════════════════════════════════════════
//  send-open-push  —  찜한 공구 "오늘 오픈 예정" 아침 알림
//  매일 한국 09:00(UTC 00:00)에 pg_cron이 호출한다.
//
//  1) push_targets() RPC  (오늘 오픈 + 미발송 + fail_count<5 를 이미 걸러줌)
//  2) device_id 별로 묶어서 한 사람당 알림 1건만
//  3) web-push 발송
//  4) 성공 → push_log insert / 404·410 → push_subs.fail_count +1
//
//  ⚠ 오픈 "시각"은 모른다 → "열렸어요" 같은 완료형 금지.
//    "오늘 오픈" 까지만 쓴다 (2026-07-23 사장님 결정: '예정' 을 빼서 제목을 한 줄에 맞춤)
// ══════════════════════════════════════════════════════════

import webpush from "npm:web-push@3.6.7";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:momcal@kakao.com";
// 이 함수 전용 호출 암호. anon 키는 사이트에 공개돼 있어서 그것만으론 막을 수 없다.
// pg_cron 이 x-cron-secret 헤더로 같은 값을 보낸다.
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";

const SITE = "https://momcalendar.com/";
const BATCH = 20;        // 동시 발송 수

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// ── Supabase REST (service_role → RLS 우회) ──
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

// 서버는 UTC → '오늘'은 항상 Asia/Seoul 기준으로 계산할 것
function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

type Target = {
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  gonggu_id: number;
  gonggu_name: string;
  seller: string | null;
};

type Group = {
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  items: { id: number; name: string }[];
};

// ── 발송 문구 (확정 — 함부로 바꾸지 말 것) ──
//  ⚠ 링크는 반드시 맘캘린더를 거치게 한다. 셀러 인스타·결제링크로 직행시키지 말 것.
//    (2026-07-23 사장님 지시: 알림에서 바로 인스타로 빠지면 사이트 방문이 사라짐)
function buildPayload(g: Group, today: string) {
  const n = g.items.length;
  if (n === 1) {
    return {
      title: "내가 찜한 공구 오늘 오픈",
      body: g.items[0].name,
      url: `${SITE}?g=${g.items[0].id}`,   // 사이트로 보내되 어떤 공구인지 표시
      tag: `mc-open-${today}`,
    };
  }
  return {
    title: `내가 찜한 공구 ${n}건 오늘 오픈`,
    body: `${g.items[0].name} 외 ${n - 1}건 눌러서 확인하세요`,
    url: SITE,
    tag: `mc-open-${today}`,
  };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";     // 발송 없이 대상·문구만 확인
  const only = url.searchParams.get("device") || "";   // 테스트용: 이 기기에만 발송
  const today = seoulToday();

  // ── 0) 호출자 확인 ──
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ ok: false, msg: "unauthorized" }, 401);
  }

  // 자가진단: 실제 발송 없이 web-push 암호화가 동작하는지만 확인 (?selftest=1)
  if (url.searchParams.get("selftest") === "1") {
    try {
      const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", (kp as CryptoKeyPair).publicKey));
      const b64u = (u: Uint8Array) =>
        btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const d = webpush.generateRequestDetails(
        { endpoint: "https://fcm.googleapis.com/fcm/send/SELFTEST", keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } },
        JSON.stringify({ title: "자가진단", body: "발송하지 않음" }),
        { TTL: 60 },
      );
      return json({ ok: true, selftest: true, encryptedBytes: (d.body as Uint8Array).length, headers: Object.keys(d.headers) });
    } catch (e) {
      return json({ ok: false, selftest: true, msg: String(e) }, 500);
    }
  }

  try {
    // ── 1) 대상 조회 ──
    const r = await sbFetch("rpc/push_targets", { method: "POST", body: "{}" });
    if (!r.ok) {
      return json({ ok: false, step: "push_targets", status: r.status, msg: await r.text() }, 500);
    }
    let targets: Target[] = await r.json();
    if (only) targets = targets.filter((t) => t.device_id === only);

    if (!targets.length) {
      return json({ ok: true, today, targets: 0, sent: 0, note: "발송 대상 없음" });
    }

    // ── 2) device_id 별로 묶기 (한 사람당 알림 1건) ──
    const groups = new Map<string, Group>();
    for (const t of targets) {
      let g = groups.get(t.device_id);
      if (!g) {
        g = { device_id: t.device_id, endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth, items: [] };
        groups.set(t.device_id, g);
      }
      if (!g.items.some((i) => i.id === t.gonggu_id)) {
        g.items.push({ id: t.gonggu_id, name: t.gonggu_name });
      }
    }

    const list = [...groups.values()];
    if (dry) {
      return json({
        ok: true, dry: true, today, targets: targets.length, devices: list.length,
        preview: list.slice(0, 20).map((g) => ({ device_id: g.device_id, ...buildPayload(g, today) })),
      });
    }

    // ── 3) 발송 ──
    const okLog: { device_id: string; gonggu_id: number; kind: string }[] = [];
    const deadDevices: string[] = [];
    const errors: { device_id: string; status?: number; msg: string }[] = [];

    for (let i = 0; i < list.length; i += BATCH) {
      await Promise.all(list.slice(i, i + BATCH).map(async (g) => {
        const payload = buildPayload(g, today);
        try {
          // web-push의 node http 대신 fetch로 직접 쏜다 (Deno에서 가장 안전)
          const d = webpush.generateRequestDetails(
            { endpoint: g.endpoint, keys: { p256dh: g.p256dh, auth: g.auth } },
            JSON.stringify(payload),
            { TTL: 6 * 60 * 60 },   // 6시간 안에 못 받으면 버림 (아침 알림이 밤에 오면 이상함)
          );
          const res = await fetch(d.endpoint, {
            method: d.method,
            headers: d.headers as Record<string, string>,
            body: d.body as BodyInit,
          });
          if (res.ok) {
            for (const it of g.items) okLog.push({ device_id: g.device_id, gonggu_id: it.id, kind: "open" });
          } else if (res.status === 404 || res.status === 410) {
            deadDevices.push(g.device_id);   // 구독 만료·삭제
          } else {
            errors.push({ device_id: g.device_id, status: res.status, msg: (await res.text()).slice(0, 200) });
          }
        } catch (e) {
          errors.push({ device_id: g.device_id, msg: String(e).slice(0, 200) });
        }
      }));
    }

    // ── 4) 기록 ──
    for (let i = 0; i < okLog.length; i += 500) {
      await sbFetch("push_log", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(okLog.slice(i, i + 500)),
      }).catch(() => {});
    }
    if (deadDevices.length) {
      await sbFetch("rpc/push_fail_bump", {
        method: "POST",
        body: JSON.stringify({ p_devices: deadDevices }),
      }).catch(() => {});
    }

    return json({
      ok: true, today,
      targets: targets.length,
      devices: list.length,
      sent: list.length - deadDevices.length - errors.length,
      logged: okLog.length,
      dead: deadDevices.length,
      errors: errors.slice(0, 10),
      ms: Date.now() - t0,
    });
  } catch (e) {
    return json({ ok: false, msg: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

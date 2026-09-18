// 셀러 정산정보 접수 (원츠비 벤더사용) — 2026-09-18
//
// 흐름:  관리자가 초대링크 생성 → 셀러가 링크로 폼 작성 → 여기서 검증·암호화 저장 → 노션에 마스킹본 자동 기록
//
// 실행법(관리자): sellerdesk.html 에서 호출. 공개 폼: sellerform.html?t=<초대코드>
// 상태파일 없음(전부 DB). 주기 없음(요청 때만).
//
// 🔒 보안 기준
//   · seller_invite / seller_intake 는 RLS 켜고 정책 0개 → 공개 키로는 접근 불가. 여기(service_role)로만 들어온다.
//   · 주민등록번호·계좌번호는 AES-256-GCM 으로 암호화해서 넣는다. 키는 시크릿 INTAKE_ENC_KEY 에만 있고 DB 엔 없다.
//   · 초대코드는 1회용·만료 있음. 제출되면 used_at 이 찍혀 다시 못 쓴다.
//   · IP 는 원문을 저장하지 않고 소금 친 해시만 남긴다(폭주 방어용).
//   · 관리자 열람(reveal)은 seller_intake_audit 에 남는다.

const SB   = Deno.env.get("SUPABASE_URL")!;
const SKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENCK = Deno.env.get("INTAKE_ENC_KEY") ?? "";      // base64 32바이트
const SALT = Deno.env.get("INTAKE_IP_SALT") ?? "momcal";
const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const NOTION_DB    = Deno.env.get("NOTION_DB_ID") ?? "";
const CONSENT_VER  = "2026-09-18";

const OK_ORIGIN = [
  "https://momcalendar.com", "https://www.momcalendar.com",
  "http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8000", "http://127.0.0.1:8000",
];
function cors(origin: string | null) {
  const o = origin && OK_ORIGIN.includes(origin) ? origin : "https://momcalendar.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
}

// ── DB 헬퍼 (service_role) ──
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`db ${r.status} ${String(t).slice(0, 200)}`);
  return j;
}

// ── 암호화 (AES-256-GCM) ──
async function keyOf() {
  if (!ENCK) throw new Error("INTAKE_ENC_KEY 미설정");
  const raw = Uint8Array.from(atob(ENCK), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("INTAKE_ENC_KEY 는 32바이트 base64 여야 한다");
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function enc(plain: string) {
  const k = await keyOf();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}
async function dec(b64: string) {
  const k = await keyOf();
  const all = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, k, all.slice(12));
  return new TextDecoder().decode(pt);
}
async function sha(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");

// ── 입력 검증 ──
const CTRL = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const clean = (v: unknown, max = 200) => String(v ?? "").replace(CTRL, "").trim().slice(0, max);
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
function bizOk(no: string) {                     // 사업자등록번호 체크섬
  if (no.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0; for (let i = 0; i < 9; i++) s += Number(no[i]) * w[i];
  s += Math.floor((Number(no[8]) * 5) / 10);
  return (10 - (s % 10)) % 10 === Number(no[9]);
}
function rrnOk(no: string) {                     // 주민등록번호 형식·체크섬
  if (no.length !== 13) return false;
  const mm = Number(no.slice(2, 4)), dd = Number(no.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  const w = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let s = 0; for (let i = 0; i < 12; i++) s += Number(no[i]) * w[i];
  return (11 - (s % 11)) % 10 === Number(no[12]);
}
const phoneOk = (p: string) => /^01[016789]\d{7,8}$/.test(p);
const emailOk = (e: string) => !e || /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-zA-Z]{2,}$/.test(e);
const urlOk = (u: string) => !u || /^https?:\/\/[^\s]{3,300}$/i.test(u);

// ── 누가 부르는지 확인 (사장님 / 직원 / 그 외) ──
//   사장님(app_admins) = 전부 가능 · 직원(app_staff) = 링크 발급·접수 확인·상태 변경까지
//   🔒 계좌번호·주민등록번호 열람(reveal)은 **사장님만**. 직원 화면엔 마스킹만 간다.
type Who = { uid: string; role: "admin" | "staff" } | null;
async function whoIs(req: Request): Promise<Who> {
  const auth = req.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SKEY, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const admin = await sb(`app_admins?user_id=eq.${u.id}&select=user_id`);
  if (admin?.length) return { uid: u.id, role: "admin" };
  const staff = await sb(`app_staff?user_id=eq.${u.id}&select=user_id`);
  if (staff?.length) return { uid: u.id, role: "staff" };
  return null;
}

// ── 노션 기록 ──
async function toNotion(row: any) {
  if (!NOTION_TOKEN || !NOTION_DB) return { skipped: "NOTION_TOKEN/NOTION_DB_ID 미설정" };
  const addr = [row.zipcode ? `(${row.zipcode})` : "", row.addr1, row.addr2].filter(Boolean).join(" ");
  const props: Record<string, unknown> = {
    "셀러명": { title: [{ text: { content: row.seller_name || "(이름없음)" } }] },
    "대표자명": { rich_text: [{ text: { content: row.owner_name || "" } }] },
    "연락처": { phone_number: row.phone || null },
    "이메일": { email: row.email || null },
    "채널": { url: row.channel_url || null },
    "팔로워": { number: row.followers ?? null },
    "정산유형": { select: { name: row.settle_type === "business" ? "사업자" : "프리랜서" } },
    "과세유형": {
      select: {
        name: row.settle_type !== "business" ? "프리랜서(개인)"
            : row.biz_type === "simplified" ? "간이과세자" : "일반과세자",
      },
    },
    "사업자명": { rich_text: [{ text: { content: row.biz_name || "" } }] },
    "사업자등록번호": { rich_text: [{ text: { content: row.biz_no || "" } }] },
    "샘플 수령 주소": { rich_text: [{ text: { content: addr } }] },
    "은행": { rich_text: [{ text: { content: row.bank || "" } }] },
    "예금주": { rich_text: [{ text: { content: row.acct_holder || "" } }] },
    "계좌 끝4자리": { rich_text: [{ text: { content: row.acct_last4 ? `****${row.acct_last4}` : "" } }] },
    "상태": { select: { name: "신규접수" } },
    "접수일시": { date: { start: row.created_at } },
    "접수번호": { number: row.id },
    "비고": { rich_text: [{ text: { content: "계좌번호·주민등록번호 전체는 관리자 화면(sellerdesk)에서만 조회" } }] },
  };
  const r = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({ parent: { database_id: NOTION_DB }, properties: props }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`notion ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { id: j.id };
}
async function syncRow(row: any) {
  try {
    const res: any = await toNotion(row);
    if (res?.skipped) {
      await sb(`seller_intake?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notion_error: res.skipped }) });
      return { ok: false, reason: res.skipped };
    }
    await sb(`seller_intake?id=eq.${row.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ notion_page_id: res.id, notion_synced_at: new Date().toISOString(), notion_error: null }),
    });
    return { ok: true, page: res.id };
  } catch (e) {
    await sb(`seller_intake?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notion_error: String(e).slice(0, 300) }) });
    return { ok: false, reason: String(e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  const H = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...H, "Content-Type": "application/json" } });

  try {
    const u = new URL(req.url);
    const op = u.searchParams.get("op") ?? "";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── 1) 공개: 초대코드 확인 ──
    if (op === "check") {
      const token = clean(u.searchParams.get("token"), 64);
      if (!/^[0-9a-f]{16,64}$/.test(token)) return json({ ok: false, reason: "invalid" });
      const rows = await sb(`seller_invite?token=eq.${token}&select=label,expires_at,used_at,revoked`);
      const iv = rows?.[0];
      if (!iv) return json({ ok: false, reason: "invalid" });
      if (iv.revoked) return json({ ok: false, reason: "revoked" });
      if (iv.used_at) return json({ ok: false, reason: "used" });
      if (new Date(iv.expires_at) < new Date()) return json({ ok: false, reason: "expired" });
      return json({ ok: true, label: iv.label, expires_at: iv.expires_at });
    }

    // ── 2) 공개: 제출 ──
    if (op === "submit" && req.method === "POST") {
      const token = clean(body.token, 64);
      if (!/^[0-9a-f]{16,64}$/.test(token)) return json({ ok: false, reason: "invalid" }, 400);
      if (clean(body.website)) return json({ ok: true });                   // 허니팟(봇) — 조용히 성공 처리
      const ipRaw = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
      const ip_hash = await sha(SALT + ipRaw);
      const hour_key = new Date().toISOString().slice(0, 13);
      const rate = await sb(`seller_intake_rate?ip_hash=eq.${ip_hash}&hour_key=eq.${hour_key}&select=n`);
      if ((rate?.[0]?.n ?? 0) >= 20) return json({ ok: false, reason: "too_many" }, 429);

      const rows = await sb(`seller_invite?token=eq.${token}&select=label,expires_at,used_at,revoked`);
      const iv = rows?.[0];
      if (!iv || iv.revoked) return json({ ok: false, reason: "invalid" }, 400);
      if (iv.used_at) return json({ ok: false, reason: "used" }, 409);
      if (new Date(iv.expires_at) < new Date()) return json({ ok: false, reason: "expired" }, 410);

      const settle_type = body.settle_type === "business" ? "business" : "freelancer";
      // 사업자면 과세유형까지 받는다 (일반=세금계산서 필수 / 간이=부가세액 제외 후 현금영수증)
      const biz_type = settle_type === "business" ? (body.biz_type === "simplified" ? "simplified" : "general") : null;
      const seller_name = clean(body.seller_name, 80);
      const owner_name  = clean(body.owner_name, 40);
      const phone       = digits(body.phone).slice(0, 11);
      const email       = clean(body.email, 254).toLowerCase();
      const channel_url = clean(body.channel_url, 300);
      const followersN  = Number(digits(body.followers) || 0);
      const bank        = clean(body.bank, 30);
      const acct        = digits(body.acct_no).slice(0, 20);
      const acct_holder = clean(body.acct_holder, 40);
      const zipcode     = digits(body.zipcode).slice(0, 6);
      const addr1       = clean(body.addr1, 200);
      const addr2       = clean(body.addr2, 120);
      const biz_name    = clean(body.biz_name, 80);
      const biz_no      = digits(body.biz_no).slice(0, 10);
      const rrn         = digits(body.rrn).slice(0, 13);

      const bad: string[] = [];
      if (!seller_name) bad.push("셀러명");
      if (!owner_name) bad.push("대표자명");
      if (!phoneOk(phone)) bad.push("연락처");
      if (!emailOk(email)) bad.push("이메일");
      if (!urlOk(channel_url)) bad.push("채널 주소");
      if (!(followersN >= 0 && followersN <= 100000000)) bad.push("팔로워 수");
      if (!bank) bad.push("은행");
      if (!(acct.length >= 8 && acct.length <= 20)) bad.push("계좌번호");
      if (!acct_holder) bad.push("예금주");
      if (!zipcode || !addr1) bad.push("샘플 수령 주소");
      if (settle_type === "business") {
        if (!biz_name) bad.push("사업자명");
        if (!bizOk(biz_no)) bad.push("사업자등록번호");
      } else {
        if (!rrnOk(rrn)) bad.push("주민등록번호");
      }
      if (body.agreed !== true) bad.push("개인정보 수집·이용 동의");
      if (bad.length) return json({ ok: false, reason: "invalid_fields", fields: bad }, 400);

      const now = new Date().toISOString();
      const rec: Record<string, unknown> = {
        token, seller_name, owner_name, phone, email: email || null,
        channel_url: channel_url || null, followers: followersN || null,
        settle_type, biz_type,
        biz_name: settle_type === "business" ? biz_name : null,
        biz_no: settle_type === "business" ? biz_no : null,
        rrn_enc: settle_type === "freelancer" ? await enc(rrn) : null,
        rrn_masked: settle_type === "freelancer" ? `${rrn.slice(0, 6)}-${rrn[6]}******` : null,
        zipcode, addr1, addr2: addr2 || null,
        bank, acct_enc: await enc(acct), acct_last4: acct.slice(-4), acct_holder,
        agreed: true, agreed_at: now, consent_ver: CONSENT_VER,
        ip_hash, ua: clean(req.headers.get("user-agent"), 200),
      };
      const ins = await sb(`seller_intake`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rec) });
      const row = ins?.[0];
      await sb(`seller_invite?token=eq.${token}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ used_at: now }) });
      await sb(`seller_intake_rate?on_conflict=ip_hash,hour_key`, {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ ip_hash, hour_key, n: (rate?.[0]?.n ?? 0) + 1 }),
      });
      const sync = await syncRow(row);
      return json({ ok: true, id: row.id, notion: sync.ok });
    }

    // ── 2-b) 서버 예약작업(pg_cron)용 재동기화 ──
    //   노션 토큰이 늦게 설정돼도 밀린 건이 자동으로 올라가게 한다. 사람 없이 도는 유일한 경로.
    const CRON = Deno.env.get("PUSH_CRON_SECRET") ?? "";
    if (op === "resync" && CRON && req.headers.get("x-cron-secret") === CRON) {
      const rows = await sb(`seller_intake?notion_synced_at=is.null&select=*&order=id&limit=20`);
      const res = [];
      for (const r of rows ?? []) res.push({ id: r.id, ...(await syncRow(r)) });
      return json({ ok: true, by: "cron", done: res });
    }

    // ── 3) 여기부터 로그인 필요 (사장님 또는 직원) ──
    const who = await whoIs(req);
    if (!who) return json({ ok: false, reason: "forbidden" }, 401);
    const uid = who.uid;

    // 화면이 역할에 맞게 그리도록 알려준다
    if (op === "whoami") return json({ ok: true, role: who.role });

    if (op === "invite" && req.method === "POST") {
      const label = clean(body.label, 80);
      if (!label) return json({ ok: false, reason: "label 필요" }, 400);
      const days = Math.min(Math.max(Number(body.days ?? 7), 1), 30);
      const token = hex(16);
      const expires_at = new Date(Date.now() + days * 864e5).toISOString();
      await sb(`seller_invite`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ token, label, memo: clean(body.memo, 200) || null, expires_at, created_by: uid, created_role: who.role }),
      });
      return json({ ok: true, token, expires_at, url: `https://momcalendar.com/sellerform.html?t=${token}` });
    }

    if (op === "list") {
      const invites = await sb(`seller_invite?select=token,label,memo,created_at,expires_at,used_at,revoked&order=created_at.desc&limit=100`);
      // 직원에게도 같은 목록을 주되, 아래 select 에 암호문(acct_enc·rrn_enc)은 애초에 없다.
      const intakes = await sb(`seller_intake?select=id,seller_name,owner_name,phone,email,channel_url,followers,settle_type,biz_type,biz_name,biz_no,rrn_masked,zipcode,addr1,addr2,bank,acct_last4,acct_holder,status,notion_page_id,notion_synced_at,notion_error,created_at&order=id.desc&limit=200`);
      return json({ ok: true, invites, intakes });
    }

    if (op === "reveal") {
      // 🔒 사장님 전용. 직원 계정으로는 계좌·주민번호를 절대 못 연다.
      if (who.role !== "admin") return json({ ok: false, reason: "계좌·주민등록번호는 사장님 계정에서만 열 수 있어요." }, 403);
      const id = Number(u.searchParams.get("id") ?? 0);
      const rows = await sb(`seller_intake?id=eq.${id}&select=id,acct_enc,rrn_enc,bank,acct_holder`);
      const r = rows?.[0];
      if (!r) return json({ ok: false, reason: "없는 접수" }, 404);
      const out: Record<string, unknown> = { ok: true, id: r.id, bank: r.bank, acct_holder: r.acct_holder };
      out.acct_no = r.acct_enc ? await dec(r.acct_enc) : null;
      out.rrn = r.rrn_enc ? await dec(r.rrn_enc) : null;
      await sb(`seller_intake_audit`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ intake_id: id, admin_uid: uid, action: r.rrn_enc ? "reveal_rrn_acct" : "reveal_acct" }) });
      return json(out);
    }

    if (op === "resync" && req.method === "POST") {
      const id = Number(body.id ?? 0);
      const q = id ? `seller_intake?id=eq.${id}&select=*` : `seller_intake?notion_synced_at=is.null&select=*&order=id&limit=20`;
      const rows = await sb(q);
      const res = [];
      for (const r of rows ?? []) res.push({ id: r.id, ...(await syncRow(r)) });
      return json({ ok: true, done: res });
    }

    if (op === "revoke" && req.method === "POST") {
      const token = clean(body.token, 64);
      // 관리자만 오는 경로지만 필터 문자열에 그대로 들어가므로 여기서도 형식을 다시 본다 (검증자 지적 2026-09-18)
      if (!/^[0-9a-f]{16,64}$/.test(token)) return json({ ok: false, reason: "invalid" }, 400);
      await sb(`seller_invite?token=eq.${token}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked: true }) });
      return json({ ok: true });
    }

    if (op === "status" && req.method === "POST") {
      const id = Number(body.id ?? 0);
      const st = ["new", "checked", "hold"].includes(body.status) ? body.status : "new";
      await sb(`seller_intake?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: st }) });
      return json({ ok: true });
    }

    return json({ ok: false, reason: "알 수 없는 op" }, 400);
  } catch (e) {
    return json({ ok: false, reason: String(e).slice(0, 300) }, 500);
  }
});

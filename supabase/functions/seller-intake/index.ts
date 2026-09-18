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
//   사장님(app_admins) = 전부 가능
//   직원(app_staff)   = 링크 발급·접수 확인·상태 변경 + **계좌번호 열람**(정산 담당이라 필요)
//   🔒 직원에게 잠그는 것 = **연락처·주민등록번호** (사장님 지시 2026-09-18). 목록에서도 가려서 보낸다.
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
    "상태": { select: { name: row.status === "checked" ? "확인완료" : row.status === "hold" ? "보류" : "신규접수" } },
    "접수일시": { date: { start: row.created_at } },
    "접수번호": { number: row.id },
    "비고": { rich_text: [{ text: { content: row.hold_reason ? `⚠ ${row.hold_reason} — 확인 필요` : "" } }] },
  };
  // 이미 노션에 줄이 있으면 새로 만들지 않고 그 줄을 고친다 (사장님이 접수 내용을 수정한 경우)
  const url = row.notion_page_id
    ? `https://api.notion.com/v1/pages/${row.notion_page_id}`
    : "https://api.notion.com/v1/pages";
  const r = await fetch(url, {
    method: row.notion_page_id ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify(row.notion_page_id ? { properties: props } : { parent: { database_id: NOTION_DB }, properties: props }),
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
        // 사람이 눌러서 확인하지 않는다. 검사를 다 통과했으면 바로 '확인완료'.
        // 정산 때 실제로 걸리는 것(예금주 ≠ 대표자명)만 '보류'로 돌려 사장님이 보게 한다.
        status: acct_holder.replace(/\s/g, "") === owner_name.replace(/\s/g, "") ? "checked" : "hold",
        hold_reason: acct_holder.replace(/\s/g, "") === owner_name.replace(/\s/g, "") ? null : "예금주와 대표자명이 다름",
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
      const days = Math.min(Math.max(Number(body.days ?? 3), 1), 30);   // 기본 3일 (사장님 지시 2026-09-18)
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
      const intakes = await sb(`seller_intake?select=id,seller_name,owner_name,phone,email,channel_url,followers,settle_type,biz_type,biz_name,biz_no,rrn_masked,zipcode,addr1,addr2,bank,acct_last4,acct_holder,status,hold_reason,notion_page_id,notion_synced_at,notion_error,created_at&order=id.desc&limit=200`);
      // 직원에게는 연락처·주민등록번호를 가려서 내보낸다 (목록 응답 자체에 값이 안 실린다)
      const shown = who.role === "admin" ? intakes : (intakes ?? []).map((r: any) => ({
        ...r,
        phone: r.phone ? `${String(r.phone).slice(0, 3)}-****-${String(r.phone).slice(-4)}` : null,
        rrn_masked: null,
        locked: ["phone", "rrn"],
      }));
      return json({ ok: true, role: who.role, invites, intakes: shown });
    }

    if (op === "reveal") {
      //   직원(정산 담당) = 계좌번호까지 / 사장님 = 계좌 + 연락처 + 주민등록번호
      const id = Number(u.searchParams.get("id") ?? 0);
      const rows = await sb(`seller_intake?id=eq.${id}&select=id,acct_enc,rrn_enc,bank,acct_holder,phone`);
      const r = rows?.[0];
      if (!r) return json({ ok: false, reason: "없는 접수" }, 404);
      const out: Record<string, unknown> = { ok: true, id: r.id, bank: r.bank, acct_holder: r.acct_holder, role: who.role };
      out.acct_no = r.acct_enc ? await dec(r.acct_enc) : null;
      if (who.role === "admin") {
        out.rrn = r.rrn_enc ? await dec(r.rrn_enc) : null;
        out.phone = r.phone ?? null;
      } else {
        out.rrn = null;
        out.phone = null;
        out.locked_note = "연락처·주민등록번호는 사장님 계정에서만 열립니다.";
      }
      await sb(`seller_intake_audit`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ intake_id: id, admin_uid: uid, action: who.role === "admin" ? "reveal_all" : "reveal_acct_staff" }),
      });
      return json(out);
    }

    // ── 접수 내용 수정 (사장님 전용) ──
    //   셀러가 잘못 냈을 때 링크를 다시 보내지 않고 여기서 고친다. 고치면 노션 줄도 같은 줄이 갱신된다.
    if (op === "update" && req.method === "POST") {
      if (who.role !== "admin") return json({ ok: false, reason: "수정은 사장님 계정에서만 가능해요." }, 403);
      const id = Number(body.id ?? 0);
      const cur = (await sb(`seller_intake?id=eq.${id}&select=*`))?.[0];
      if (!cur) return json({ ok: false, reason: "없는 접수" }, 404);

      const patch: Record<string, unknown> = {};
      const bad: string[] = [];
      const has = (k: string) => body[k] !== undefined && body[k] !== null;

      if (has("seller_name")) { const v = clean(body.seller_name, 80); v ? patch.seller_name = v : bad.push("셀러명"); }
      if (has("owner_name")) { const v = clean(body.owner_name, 40); v ? patch.owner_name = v : bad.push("대표자명"); }
      if (has("phone")) { const v = digits(body.phone).slice(0, 11); phoneOk(v) ? patch.phone = v : bad.push("연락처"); }
      if (has("email")) { const v = clean(body.email, 254).toLowerCase(); emailOk(v) ? patch.email = v || null : bad.push("이메일"); }
      if (has("channel_url")) { const v = clean(body.channel_url, 300); urlOk(v) ? patch.channel_url = v || null : bad.push("채널 주소"); }
      if (has("followers")) patch.followers = Number(digits(body.followers) || 0) || null;
      if (has("bank")) { const v = clean(body.bank, 30); v ? patch.bank = v : bad.push("은행"); }
      if (has("acct_holder")) { const v = clean(body.acct_holder, 40); v ? patch.acct_holder = v : bad.push("예금주"); }
      if (has("zipcode")) patch.zipcode = digits(body.zipcode).slice(0, 6);
      if (has("addr1")) patch.addr1 = clean(body.addr1, 200);
      if (has("addr2")) patch.addr2 = clean(body.addr2, 120) || null;
      if (has("biz_name")) patch.biz_name = clean(body.biz_name, 80) || null;
      if (has("biz_no")) { const v = digits(body.biz_no).slice(0, 10); (!v || bizOk(v)) ? patch.biz_no = v || null : bad.push("사업자등록번호"); }
      if (has("settle_type")) patch.settle_type = body.settle_type === "business" ? "business" : "freelancer";
      if (has("biz_type")) patch.biz_type = body.biz_type === "simplified" ? "simplified" : body.biz_type === "general" ? "general" : null;
      // 계좌번호·주민번호는 값을 새로 줄 때만 다시 암호화해서 덮는다 (빈칸이면 그대로 둔다)
      if (clean(body.acct_no, 30)) {
        const v = digits(body.acct_no).slice(0, 20);
        if (v.length >= 8 && v.length <= 20) { patch.acct_enc = await enc(v); patch.acct_last4 = v.slice(-4); }
        else bad.push("계좌번호");
      }
      if (clean(body.rrn, 20)) {
        const v = digits(body.rrn).slice(0, 13);
        if (rrnOk(v)) { patch.rrn_enc = await enc(v); patch.rrn_masked = `${v.slice(0, 6)}-${v[6]}******`; }
        else bad.push("주민등록번호");
      }
      if (bad.length) return json({ ok: false, reason: "invalid_fields", fields: bad }, 400);
      if (!Object.keys(patch).length) return json({ ok: false, reason: "바뀐 값이 없어요." }, 400);

      await sb(`seller_intake?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      await sb(`seller_intake_audit`, {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ intake_id: id, admin_uid: uid, action: "edit:" + Object.keys(patch).join(",").slice(0, 120) }),
      });
      const fresh = (await sb(`seller_intake?id=eq.${id}&select=*`))?.[0];
      const sync = await syncRow(fresh);
      return json({ ok: true, id, changed: Object.keys(patch), notion: sync.ok });
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

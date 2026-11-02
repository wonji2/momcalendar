// 📸 맘캘린더 인스타그램 댓글 자동 답글봇 (Instagram Graph API Webhook)
//   @momcal_official 계정 고유의 말투와 양식(💜, .ᐟ.ᐟ, 친근한 경어체)을 100% 학습 반영한 버전.
//
//   손님이 인스타 릴스/피드에 "OO 공구 있나요?", "OO 언제해요?", "OO요ㅜㅜ" 댓글을 남기면:
//   1) 댓글에서 브랜드/상품명 추출
//   2) Supabase gonggu / hotdeals DB 실시간 검색
//   3) @momcal_official 고유 스타일의 맞춤형 대댓글 자동 등록

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SB = Deno.env.get("SUPABASE_URL") || "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_PUBLISHABLE_KEY") || "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";

const VERIFY_TOKEN = Deno.env.get("INSTAGRAM_VERIFY_TOKEN") || "momcal_insta_verify_2026";
const IG_ACCESS_TOKEN = Deno.env.get("INSTAGRAM_ACCESS_TOKEN") || "";
const IG_ACCOUNT_ID = Deno.env.get("INSTAGRAM_ACCOUNT_ID") || ""; // 맘캘린더 공식 계정 ID (루프 방지)

const COLS = "id,name,influencer,insta,open_date,end_date,pay_link";

// ─────────── 안전장치 (2026-11-02) ───────────
const IG_BOT_OFF = Deno.env.get("IG_BOT_OFF") === "1";                         // 🔴 즉시 정지 스위치 (시크릿 IG_BOT_OFF=1)
const APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") || "";                 // 메타 앱 시크릿 — 있으면 서명을 반드시 확인
const OWN_USERNAMES = (Deno.env.get("INSTAGRAM_OWN_USERNAMES") || "momcal_official").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
const PER_HOUR = Number(Deno.env.get("IG_BOT_PER_HOUR") || 8);                  // 시간당 답글 상한 (0-T: 막히면 멈추고, 몰아서 안 쏜다)
const PER_DAY = Number(Deno.env.get("IG_BOT_PER_DAY") || 30);                   // 하루 상한
const GAP_MS = Number(Deno.env.get("IG_BOT_GAP_MS") || 30000);                  // 답글 사이 최소 간격(+ 무작위 0~15초)
const COOLDOWN_MS = 6 * 3600e3;                                                 // 차단 신호 뒤 6시간 정지
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sbs(path: string, init: RequestInit = {}) {   // 서비스 키로 ig_bot_log 읽기·쓰기 (anon 은 이 표를 못 본다)
  return await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...((init.headers as Record<string, string>) || {}) },
  });
}
// 같은 댓글은 한 번만: 처음 넣는 데 성공한 호출만 true
async function claim(commentId: string): Promise<boolean> {
  const r = await sbs("ig_bot_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ comment_id: commentId, status: "claimed" }) });
  if (!r.ok) return false;
  const j = await r.json().catch(() => []);
  return Array.isArray(j) && j.length > 0;
}
// 진단 기록: 상한 계산(ok·fail·block)에 안 잡히는 status 만 쓴다. 키 접두사로 댓글 claim 과 겹치지 않는다
async function diag(key: string, status: string, note: string) {
  if (!SR) return;
  await sbs("ig_bot_log", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ comment_id: key, status, note: note.slice(0, 280), done_at: new Date().toISOString() }) }).catch(() => {});
}
async function setStatus(commentId: string, status: string, note = "") {
  await sbs(`ig_bot_log?comment_id=eq.${encodeURIComponent(commentId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status, note: note.slice(0, 300), done_at: new Date().toISOString() }) }).catch(() => {});
}
// 지금 답글을 보내도 되는가 — 상한·정지·간격
async function mayReply(): Promise<{ ok: boolean; why?: string; waitMs?: number }> {
  if (!SR) return { ok: false, why: "SUPABASE_SERVICE_ROLE_KEY 없음(기록 못 하면 보내지 않는다)" };
  const day = new Date(Date.now() - 86400e3).toISOString();
  const r = await sbs(`ig_bot_log?select=status,done_at&done_at=gte.${encodeURIComponent(day)}&status=in.(ok,fail,block)&order=done_at.desc&limit=200`);
  if (!r.ok) return { ok: false, why: "log 조회 실패" };
  const rows: { status: string; done_at: string }[] = await r.json().catch(() => []);
  const now = Date.now();
  const blocked = rows.find((x) => x.status === "block" && now - Date.parse(x.done_at) < COOLDOWN_MS);
  if (blocked) return { ok: false, why: "차단 신호 뒤 6시간 정지 중" };
  const last3 = rows.slice(0, 3);
  if (last3.length >= 3 && last3.every((x) => x.status !== "ok")) return { ok: false, why: "연속 3회 실패 — 정지(원인 확인 뒤 ig_bot_log 정리)" };
  const oks = rows.filter((x) => x.status === "ok");
  if (oks.length >= PER_DAY) return { ok: false, why: "하루 상한" };
  if (oks.filter((x) => now - Date.parse(x.done_at) < 3600e3).length >= PER_HOUR) return { ok: false, why: "시간당 상한" };
  const lastOk = oks.length ? Date.parse(oks[0].done_at) : 0;
  const need = GAP_MS > 0 ? GAP_MS + Math.floor(Math.random() * 15000) - (now - lastOk) : 0;
  return { ok: true, waitMs: need > 0 ? Math.min(need, 60000) : 0 };
}
// 메타 서명 확인 (앱 시크릿이 설정돼 있으면 필수)
async function sigOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) { console.warn("[IG_BOT] INSTAGRAM_APP_SECRET 미설정 — 서명 확인 건너뜀(설정 권장)"); return true; }
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = "sha256=" + Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== header.length) return false;
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ header.charCodeAt(i);
  return d === 0;
}
// 「공구 문의」로 보이는 댓글만 — "예쁘다" "ㅋㅋ" 같은 말엔 답하지 않는다
const INTENT = /(공구|핫딜|언제|있나|있어|있을까|있는지|없나|알려|궁금|\?|？|ㅜ|ㅠ|해주세요|해주시|부탁|오픈|열려|떠요|하나요|사고싶|구매|링크)/;
function wantsReply(text: string): boolean { return text.length >= 2 && text.length <= 80 && INTENT.test(text); }
// 차단·한도 신호(0-T): 메타 코드 4/17/32/368/613/2207051 또는 문구
function isBlockSignal(code: number | undefined, msg: string): boolean {
  return [4, 17, 32, 368, 613, 2207051].includes(Number(code)) || /action.?block|temporarily.?block|spam|restrict|행동이 차단/i.test(msg);
}


// Supabase REST query 헬퍼
async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return r.ok ? await r.json() : [];
}

// 손님들의 실제 댓글 유형에 맞춘 불용어/말끝 제거 규칙
// (예: "엉파 공구중인곳 있나요??", "두리수전이요ㅜㅜㅜ", "아보드 밥솥캐리어요ㅜㅜ", "엔퍼센트 알려주세요")
const TAILS = [
  /(?:[?？!！~.,ㅋㅎㅠㅜ\s]|z{2,}|Z{2,})+$/,
  /(뭐|머|모)\s*(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐)?$/,
  /(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐|는지)?$/,
  /(없|업)(어요|어|엉|음|나요|나|니)?$/,
  /(있|잇|읻|없|업)을까(요|용|나)?$/,
  /(파는|사는)\s*(데|곳)(가|이|는|은)?$/,
  /공구\s*(중인\s*곳|하는\s*곳|일정|언제|있나|있나요|하나|하나요|해요)?$/,
  /알려\s*(주세요|주라|줄래|줘|죠|줭)?$/,
  /언제\s*(해요|해용|하나요|하나|한대요|한대|함|해|야)?$/,
  /부탁\s*(드려요|드립니다|해요)?$/,
  /(궁금해요|궁금해|궁금합니다|알고싶어요|사고싶어요)$/,
  /(안보여요|안보여|어디있나요)$/,
  /(이요|에요|예요|요)$/,
  /공구$/,
];

function extractKeyword(text: string): string {
  let cleaned = text.trim();
  // 머리 인사말 및 접속사 제거
  cleaned = cleaned.replace(/^(안녕하세요|안녕|하이|반가워요|혹시)[\s,.!~]*/i, "");
  // 말끝 제거 루프
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    for (const re of TAILS) {
      cleaned = cleaned.replace(re, "").trim();
    }
  }
  return cleaned.trim();
}

// 날짜 포맷 (M월 D일)
function formatDate(dStr: string): string {
  if (!dStr) return "";
  const parts = dStr.split("-");
  if (parts.length === 3) {
    return `${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일`;
  }
  return dStr;
}

// 가격 포맷
function won(n: number | string): string {
  const num = Number(n);
  return isNaN(num) ? String(n) : num.toLocaleString("ko-KR") + "원";
}

// 맘캘린더 공구 및 핫딜 검색
async function searchMomcal(keyword: string) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (!keyword || keyword.length < 2) return null;

  // 1. 공구 검색 (진행 중이거나 예정된 공구 우선) — 띄어쓰기가 다른 말(슈메르양말 ↔ 슈메르 미끄럼방지 양말)도 찾는다
  const clean = keyword.replace(/[,()*%\\"']/g, "").trim();
  const pats = new Set<string>([`*${clean}*`]);
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length > 1) pats.add(`*${parts.join("*")}*`);
  const flat = clean.replace(/\s+/g, "");
  for (let i = 2; i <= flat.length - 2 && pats.size < 14; i++) pats.add(`*${flat.slice(0, i)}*${flat.slice(i)}*`);
  const orExpr = [...pats].map((p) => `name.ilike.${p}`).join(",");
  const gonggus = await q(
    `gonggu?select=${COLS}&approved=eq.true&or=(${encodeURIComponent(orExpr)})&end_date=gte.${today}&order=open_date.asc&limit=6`
  );

  if (Array.isArray(gonggus) && gonggus.length > 0) {
    const mine = gonggus.find((g: any) => g.insta === "momcal_");   // 맘캘린더 공구가 있으면 그것을 먼저(규칙 0-M)
    return { type: "gonggu", item: mine || gonggus[0], count: gonggus.length };
  }

  // 2. 핫딜 검색 (공구가 없으면 최저가 핫딜 확인)
  const hotdeals = await q(
    `hotdeals?select=id,title,price,price_before,mall,link&title=ilike.${encodeURIComponent(`*${clean}*`)}&order=id.desc&limit=1`
  );

  if (Array.isArray(hotdeals) && hotdeals.length > 0) {
    return { type: "hotdeal", item: hotdeals[0] };
  }

  return null;
}

// 인스타그램 Graph API 대댓글 발송 — 결과(성공·차단 신호·실패)를 돌려 준다
async function replyToComment(commentId: string, message: string): Promise<{ ok: boolean; block: boolean; msg: string }> {
  if (!IG_ACCESS_TOKEN) {
    console.warn("[IG_BOT] INSTAGRAM_ACCESS_TOKEN is not configured. Reply message:", message);
    return { ok: false, block: false, msg: "토큰 없음" };
  }
  const url = `https://graph.instagram.com/v21.0/${commentId}/replies`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${IG_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (data && data.error) || {};
    const msg = String(e.message || "").slice(0, 200);
    console.error("[IG_BOT] Error replying to comment:", data);
    return { ok: false, block: isBlockSignal(e.code, msg + " " + String(e.error_subcode || "")), msg: `${e.code || res.status} ${msg}` };
  }
  console.log("[IG_BOT] Successfully replied to comment", commentId);
  return { ok: true, block: false, msg: "" };
}

// 댓글 이벤트 하나씩 처리 (모든 안전장치가 여기를 지난다)
async function handleEvents(body: any) {
  if (body?.object !== "instagram") return;
  for (const entry of body.entry || []) {
    const ownId = String(entry?.id || "");
    for (const change of entry.changes || []) {
      if (change.field !== "comments") continue;
      const val = change.value;
      const commentId = String(val?.id || "");
      const text = String(val?.text || "").trim();
      const from = val?.from;
      const username = from?.username || "고객";
      const fromId = String(from?.id || "");

      // ① 내 계정·답글은 무시 — 봇이 단 답글에 다시 답하는 반복 차단(계정 ID 환경변수가 없어도 entry.id 와 부모 댓글 유무로 항상 막는다)
      if (!commentId) continue;
      await diag("seen-" + commentId, "seen", `from=${username} parent=${!!val?.parent_id} len=${text.length}`);
      if (val?.parent_id) continue;
      if ((IG_ACCOUNT_ID && fromId === IG_ACCOUNT_ID) || (ownId && fromId === ownId)) continue;
      if (OWN_USERNAMES.includes(String(username).toLowerCase())) continue;
      // ⑤ 공구 문의로 보이는 댓글만
      if (!wantsReply(text)) continue;

      // 상품명/키워드 추출
      const kw = extractKeyword(text);
      if (!kw || kw.length < 2 || kw.length > 20) continue;

      // DB 검색
      const searchResult = await searchMomcal(kw);
      // 일정이 없다는 답은 공구·핫딜을 직접 말한 댓글에만
      if (!searchResult && !/공구|핫딜/.test(text)) continue;

      let replyMsg = "";
      
                    // 💜 @momcal_official 오피셜 계정 고유의 말투 및 양식 반영
                    if (searchResult?.type === "gonggu") {
                      const g = searchResult.item;
                      const openD = formatDate(g.open_date);
                      const endD = formatDate(g.end_date);
                      const seller = g.influencer || (g.insta ? `@${g.insta}` : "공구 셀러");
                      const dateStr = openD === endD ? `${openD}` : `${openD}~${endD}`;
      
                      replyMsg = `@${username} 님! 문의주신 '${g.name}' 공구는 ${dateStr}에 ${seller} 님을 통해 진행 예정이에요 💜 전체 일정과 상세 정보는 프로필 링크 맘캘린더 웹사이트에서 바로 확인하실 수 있어요.ᐟ.ᐟ ✨`;
                    } else if (searchResult?.type === "hotdeal") {
                      const hd = searchResult.item;
                      const priceStr = hd.price ? ` (${won(hd.price)})` : "";
                      replyMsg = `@${username} 님! '${kw}' 공구 일정은 현재 없지만, 최저가 핫딜${priceStr}이 지금 떠 있어요 🔥 프로필 링크 맘캘린더 핫딜 탭에서 확인해 보세요 💜`;
                    } else {
                      replyMsg = `@${username} 님! '${kw}' 공구는 지금 맘캘린더에 등록된 일정이 안 보여요 🥺 새 일정은 계속 올라오고 있어서, 프로필 링크 맘캘린더 웹사이트에서 '${kw}' 검색하며 주기적으로 확인해 보시거나 키워드 알림을 켜두시면 올라오는 즉시 알려드려요 💜`;
                    }

      // ③④ 상한·정지·간격 확인 → ② 같은 댓글 한 번만 → 발송
      const may = await mayReply();
      if (!may.ok) { console.warn("[IG_BOT] 답글 보류:", may.why); continue; }
      if (!(await claim(commentId))) { console.log("[IG_BOT] 이미 처리한 댓글", commentId); continue; }
      if (may.waitMs) await sleep(may.waitMs);
      const res = await replyToComment(commentId, replyMsg);
      await setStatus(commentId, res.ok ? "ok" : res.block ? "block" : "fail", res.msg);
      if (!res.ok && res.block) { console.error("[IG_BOT] 차단 신호 — 6시간 정지"); return; }
    }
  }
}

serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. Meta Webhook URL Verification (GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[IG_BOT] Webhook verified successfully");
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2. Webhook Event Received (POST) — 먼저 200 으로 받고 답글은 백그라운드에서(메타 재전송·중복 방지)
  if (req.method === "POST") {
    try {
      const raw = await req.text();
      if (!(await sigOk(raw, req.headers.get("x-hub-signature-256")))) { await diag("sigfail-" + Date.now(), "sigfail", `header=${req.headers.get("x-hub-signature-256") ? "있음" : "없음"} len=${raw.length}`); return new Response("Forbidden", { status: 403 }); }
      if (IG_BOT_OFF) { console.warn("[IG_BOT] IG_BOT_OFF=1 — 처리하지 않음"); return new Response(JSON.stringify({ status: "off" }), { headers: { "Content-Type": "application/json" }, status: 200 }); }
      const body = JSON.parse(raw);
      const work = handleEvents(body).catch((e) => console.error("[IG_BOT] handleEvents error:", e));
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(work); } catch (_) { /* 로컬 실행 */ }
      return new Response(JSON.stringify({ status: "ok" }), { headers: { "Content-Type": "application/json" }, status: 200 });
    } catch (err) {
      console.error("[IG_BOT] Error handling webhook:", err);
      return new Response(JSON.stringify({ error: String(err) }), { headers: { "Content-Type": "application/json" }, status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
});

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
  if (!APP_SECRET) { console.warn("[IG_BOT] INSTAGRAM_APP_SECRET 미설정 — 서명을 확인할 수 없어 거절"); return false; } // 보안 점검 2026-11-13 F13: 시크릿이 없으면 통과시키던 것을 거절로
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

// ── 🧠 상품명 읽기 학습 (2026-11-04 사장님 「멀티쿠커까지가 상품명인데 인식이 왜 이래 … 상품명만 똑바로 읽도록 학습시켜」)
//   순서: ① 해석 사전(bot_interp, 챗봇과 같은 표) 히트 → 0원  ② 규칙 추출·DB 검색  ③ 그래도 못 찾으면 AI 가 상품명만 읽어 사전에 저장 → 다시 검색
//   AI 는 「무엇을 묻는지」만 말한다 — 일정 카드는 100% 우리 DB 에서 나온다. 조사·어미를 글자 단위로 떼는 규칙은 두지 않는다(메모리 ai-spend-must-accumulate).
//   키(ANTHROPIC_API_KEY)가 없거나 하루 상한이 차면 ③ 만 건너뛰고 규칙으로만 간다.
const AI_MODEL = Deno.env.get("BOT_AI_MODEL") || "claude-haiku-4-5";
const AI_PER_DAY = Number(Deno.env.get("IG_BOT_AI_PER_DAY") || 100);
const normUtt = (x: string) => x.toLowerCase().replace(/[?？!！.,~♡♥]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
type Interp = { ask: boolean; q: string; src: string };
async function interpLookup(text: string): Promise<Interp | null> {
  try {
    const un = normUtt(text); if (!un) return null;
    if (!SR) return null;   // bot_interp 는 anon 읽기가 막혀 있다 — 서비스 키로만 읽는다
    const rr = await sbs(`bot_interp?select=intent,q&utt_norm=eq.${encodeURIComponent(un)}&limit=1`);
    const rows: any[] = rr.ok ? await rr.json().catch(() => []) : [];
    const r = rows[0]; if (!r) return null;
    return { ask: String(r.intent) === "search", q: String(r.q || "").trim(), src: "dict" };
  } catch { return null; }
}
const AI_SYSTEM = [
  "맘캘린더(인스타 공동구매 일정 사이트) 인스타 댓글 해석기. 댓글을 읽고 JSON 한 줄만 낸다: {\"ask\":true|false,\"q\":\"...\"}",
  "ask=true: 특정 브랜드·상품의 공구·핫딜 일정(언제 하는지·있는지·예정이 있는지)을 묻는 댓글만. 배송·가격·사이즈·후기·사용법·교환 문의, 칭찬·감탄·잡담·인사는 ask=false, q=\"\".",
  "q: 손님이 쓴 브랜드+상품명만, 표기는 한 글자도 바꾸지 않는다. 인사·'혹시'·'공구'·'예정'·'있나요·없을까요' 같은 말과 상품명 뒤에 붙은 조사(는·은·이·가·을·를)는 뺀다. 상품명이 끝나는 곳까지만.",
  "예: '안녕하세요 혹시 오엘라 멀티쿠커는 공구 예정 없을까요?' → {\"ask\":true,\"q\":\"오엘라 멀티쿠커\"} / '엔퍼센트 알려주세요ㅜㅜ' → {\"ask\":true,\"q\":\"엔퍼센트\"} / '너무 예뻐요' → {\"ask\":false,\"q\":\"\"}",
].join("\n");
async function aiCallsToday(): Promise<number> {
  try {
    const since = new Date(Date.now() - 86400e3).toISOString();
    const r = await sbs(`ig_bot_log?select=comment_id&status=in.(ai,aierr)&done_at=gte.${encodeURIComponent(since)}&limit=500`);
    const j = await r.json().catch(() => []);
    return Array.isArray(j) ? j.length : 0;
  } catch { return 0; }
}
// 성공하면 {ask,q}, 키·상한·오류면 null (호출처는 규칙 답으로 간다)
async function interpAI(text: string, commentId: string): Promise<Interp | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key || !SR) return null;
  if ((await aiCallsToday()) >= AI_PER_DAY) { await diag("aicap-" + commentId, "aicap", "하루 AI 상한"); return null; }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 120, system: AI_SYSTEM, messages: [{ role: "user", content: text.slice(0, 200) }] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { await diag("aierr-" + commentId, "aierr", String(res.status) + " " + JSON.stringify(j).slice(0, 120)); return null; }
    const raw = String(j?.content?.[0]?.text || "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) { await diag("aierr-" + commentId, "aierr", "JSON 아님 " + raw.slice(0, 80)); return null; }
    const p = JSON.parse(m[0]);
    const it: Interp = { ask: p?.ask === true, q: String(p?.q || "").trim().slice(0, 40), src: "ai" };
    // 상품명은 댓글에 실제로 있는 글자여야 하고(지어낸 말 금지), 줄바꿈·@·주소는 답글 본문에 못 들어간다 — 어기면 AI 결과를 버리고 규칙으로 간다(사전에도 안 남긴다)
    if (it.ask && (!it.q || !flatKo(text).includes(flatKo(it.q)) || /[\n\r@]|https?:|www\./i.test(it.q))) { await diag("aierr-" + commentId, "aierr", "q 가 댓글에 없거나 쓸 수 없는 글자: " + it.q.slice(0, 40)); return null; }
    // 🔴 돈이 나간 호출은 사전에 남긴다 — 같은 말은 두 번 AI 에 안 간다(챗봇 bot_interp 와 같은 표)
    await sbs("bot_interp", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },   // 이미 있는 행(챗봇·사람이 만든 것)은 덮지 않는다
      body: JSON.stringify({ utt_norm: normUtt(text), utt: text.slice(0, 120), intent: it.ask && it.q ? "search" : "other", q: it.q, cat: "", src: "ai", model: AI_MODEL, in_tok: j?.usage?.input_tokens ?? 0, out_tok: j?.usage?.output_tokens ?? 0 }) }).catch(() => {});
    await diag("ai-" + commentId, "ai", `${text.slice(0, 40)} => ${it.ask ? it.q : "(문의 아님)"}`);
    return it;
  } catch (e) {
    await diag("aierr-" + commentId, "aierr", String((e as any)?.message || e).slice(0, 120));
    return null;
  }
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
  /(있|잇|읻|없|업)(나|어|을까|는지|냐)[가-힣]{0,3}$/,   // 있나용·있나욤·있어여 같은 말끝
  /(주세요|주세용|줘요|줘용)$/,
  /(이요|에요|예요|요)$/,
  /(\s|공구)(예정|일정)(이|은|은요|도)?$/,   // 「공구 예정 없을까요」 의 예정은 상품명이 아니다 (2026-11-04 오엘라 멀티쿠커)
  /공구$/,
];

function extractKeyword(text: string): string {
  let cleaned = text.trim();
  // 머리 인사말 및 접속사 제거
  let h0 = "";
  while (h0 !== cleaned) {
    h0 = cleaned;
    cleaned = cleaned.replace(/^(안녕하세요|안녕하세여|안녕하세용)[\s,.!~]*/, "").replace(/^(안녕|하이|반가워요|혹시나|혹시|저기)[\s,.!~]+/, "");
  }
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
// 노출 중인 공구 목록(승인·마감 전) — 댓글이 드물어 통째로 받아 앞뒤 띄어쓰기·낱말 순서에 상관없이 코드에서 맞춘다. 5분 캐시
let _gCache: { at: number; rows: any[] } | null = null;
async function activeGonggu(today: string): Promise<any[]> {
  if (_gCache && Date.now() - _gCache.at < 300e3) return _gCache.rows;
  const rows: any[] = [];
  for (let off = 0; off < 5000; off += 1000) {
    const page = await q(`gonggu?select=${COLS}&approved=eq.true&end_date=gte.${today}&order=id.asc&limit=1000&offset=${off}`);
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < 1000) break;
  }
  if (rows.length) _gCache = { at: Date.now(), rows };
  return rows;
}
const flatKo = (t: string) => String(t || "").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
// 낱말 하나가 이름에 걸리는가 — 통째로 들어 있거나, 둘로 쪼갠 두 조각이 다 들어 있으면 된다(슈메르양말 ↔ 슈메르 미끄럼방지 양말)
function tokenHit(hay: string, tok: string): boolean {
  if (hay.includes(tok)) return true;
  for (let i = 2; i <= tok.length - 2; i++) if (hay.includes(tok.slice(0, i)) && hay.includes(tok.slice(i))) return true;
  return false;
}
// 챗봇과 같은 규칙(고정): 별칭은 DB bot_alias 한 곳 · 다른 브랜드 제외는 bot_alias_deny · 셀러 이름으로는 찾지 않는다 · 수식어는 사전으로만 뗀다
let _aCache: { at: number; AL: [string, string][]; DENY: Map<string, string[]> } | null = null;
async function aliasData() {
  if (_aCache && Date.now() - _aCache.at < 300e3) return _aCache;
  const al = await q("bot_alias?select=term,expand");
  const dn = await q("bot_alias_deny?select=term,expand");
  const AL: [string, string][] = (Array.isArray(al) ? al : []).map((r: any) => [String(r.term), String(r.expand)]);
  const DENY = new Map<string, string[]>();
  for (const r of Array.isArray(dn) ? dn : []) { const t = String((r as any).term || "").trim(), x = String((r as any).expand || "").trim(); if (t && x) { if (!DENY.has(t)) DENY.set(t, []); DENY.get(t)!.push(x); } }
  _aCache = { at: Date.now(), AL, DENY };
  return _aCache;
}
const MODIFIERS = ["신생아", "어린이", "우리아이", "유아용", "아기", "유아", "아이", "키즈", "엄마"];
function expandAlias(src: string[], AL: [string, string][]): string[] {
  const out: string[] = [];
  for (const t of src) for (const [a, b] of AL) {
    if (a && t.includes(a)) out.push(t.split(a).join(b));
    if (b && t.includes(b)) out.push(t.split(b).join(a));
  }
  return out;
}
function nameHit(name: string, keyword: string): boolean {
  const toks = keyword.split(/\s+/).map(flatKo).filter((x) => x.length >= 2);
  const hay = flatKo(name);
  return toks.length > 0 && toks.every((t) => tokenHit(hay, t));
}
function matchGonggu(rows: any[], keyword: string, AL: [string, string][] = [], DENY: Map<string, string[]> = new Map()): any[] {
  // 손님 말 그대로 → 별칭 1·2단계 → (그래도 없으면) 수식어를 사전으로 뗀 말
  const t0 = [keyword];
  const t1 = expandAlias(t0, AL);
  const t2 = expandAlias(t1, AL);
  const mods: string[] = [];
  for (const t of [...t0, ...t1, ...t2]) for (const w of t.split(/\s+/)) for (const m of MODIFIERS) if (w.startsWith(m) && w.length > m.length + 1) { mods.push(t.split(w).join(w.slice(m.length))); break; }
  const stages = [[...new Set([...t0, ...t1, ...t2])], [...new Set(mods)]];
  let hit: any[] = [];
  for (const st of stages) {
    hit = rows.filter((g) => st.some((v) => nameHit(String(g.name || ""), v)));
    if (hit.length) break;
  }
  // 다른 브랜드 제외 — 손님이 term 을 그대로 쳤을 때만
  const deny = DENY.get(keyword.trim()) || [];
  if (deny.length) hit = hit.filter((g) => !deny.some((x) => String(g.name || "").includes(x)));
  // 맘캘린더 공구 먼저(규칙 0-M), 그 뒤 오픈 빠른 순
  hit.sort((x, y) => (y.insta === "momcal_" ? 1 : 0) - (x.insta === "momcal_" ? 1 : 0) || String(x.open_date).localeCompare(String(y.open_date)));
  return hit;
}
async function searchMomcal(keyword: string) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (!keyword || keyword.length < 2) return null;

  // 1. 공구 검색 (진행 중이거나 예정된 공구)
  const { AL, DENY } = await aliasData();
  const hit = matchGonggu(await activeGonggu(today), keyword, AL, DENY);
  if (hit.length > 0) return { type: "gonggu", item: hit[0], items: hit.slice(0, 3), count: hit.length };

  // 2. 핫딜 검색 (공구가 없으면 최저가 핫딜 확인)
  const clean = keyword.replace(/[,()*%\\"']/g, "").trim();
  const hotdeals = await q(
    `hotdeals?select=id,title,price,price_before,mall,link&title=ilike.${encodeURIComponent(`*${clean}*`)}&order=id.desc&limit=1`
  );
  if (Array.isArray(hotdeals) && hotdeals.length > 0) return { type: "hotdeal", item: hotdeals[0] };
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

      // 상품명/키워드 추출 — ① 해석 사전  ② 규칙  ③ 규칙으로 못 찾으면 AI(결과는 사전에 저장)
      let kw = extractKeyword(text);
      let confirmed = false;   // 사전·AI 가 「상품을 묻는 댓글」이라고 확인했는가
      const dict = await interpLookup(text);
      if (dict) {
        if (!dict.ask || !dict.q) continue;   // 사전이 「문의 아님」으로 알고 있는 말
        kw = dict.q; confirmed = true;
      }
      const okKw = (k: string) => !!k && k.length >= 2 && k.length <= 20;
      let searchResult = okKw(kw) ? await searchMomcal(kw) : null;
      // AI 는 답글을 실제로 보낼 수 있고(상한·정지 안 걸림) 상품 낱말이 남았을 때만 부른다 — 「공구 언제 해요?」처럼 낱말이 없는 말은 안 부른다
      const interpGuard = !!kw && kw.length >= 2 && !/^(링크|가격|얼마|후기|배송|어디|언제|주소|문의|구매|오픈|예약|사이트)$/.test(kw);
      if (!searchResult && !dict && interpGuard && (await mayReply()).ok) {
        const ai = await interpAI(text, commentId);
        if (ai) {
          if (!ai.ask || !ai.q) continue;
          kw = ai.q; confirmed = true;
          searchResult = okKw(kw) ? await searchMomcal(kw) : null;
        }
      }
      if (!okKw(kw)) continue;
      // DB 에 없는 상품: 사전·AI 가 「상품 문의」로 확인했으면 「사이트에서 주기적으로 확인」 안내를 단다. 확인 못 한 말(AI 꺼짐)은 공구·핫딜을 직접 말한 댓글에만
      if (!searchResult && !confirmed && !/공구|핫딜/.test(text)) continue;

      let replyMsg = "";
      
                    // 💜 @momcal_official 오피셜 계정 고유의 말투 및 양식 반영
                    if (searchResult?.type === "gonggu" && (searchResult as any).items?.length > 1) {
                      const list = (searchResult as any).items.map((g: any) => `· ${g.name} (${formatDate(g.open_date)}~${formatDate(g.end_date)}${g.insta === "momcal_" ? " 맘캘린더 공구" : ""})`).join("\n");
                      replyMsg = `@${username} 님! '${kw}' 관련 공구가 ${(searchResult as any).count}건 있어요 💜\n${list}\n전체 일정과 상세 정보는 프로필 링크 맘캘린더 웹사이트에서 확인하실 수 있어요 ✨`;
                    } else if (searchResult?.type === "gonggu") {
                      const g = searchResult.item;
                      const openD = formatDate(g.open_date);
                      const endD = formatDate(g.end_date);
                      const cleanInsta = g.insta ? String(g.insta).replace(/^@+/, "").trim() : "";
                      const sellerText = cleanInsta ? `@${cleanInsta} 님 계정에서` : `${g.influencer || "공구 셀러"} 님을 통해`;
                      const dateStr = openD === endD ? `${openD}` : `${openD}~${endD}`;
      
                      replyMsg = `@${username} 님! 문의주신 '${g.name}' 공구는 ${dateStr}에 ${sellerText} 진행 예정이에요 💜 전체 일정과 상세 정보는 프로필 링크 맘캘린더 웹사이트에서 바로 확인하실 수 있어요.ᐟ.ᐟ ✨`;
                    } else if (searchResult?.type === "hotdeal") {
                      const hd = searchResult.item;
                      const priceStr = hd.price ? ` (${won(hd.price)})` : "";
                      replyMsg = `@${username} 님! '${kw}' 공구 일정은 현재 없지만, 최저가 핫딜${priceStr}이 지금 떠 있어요 🔥 프로필 링크 맘캘린더 핫딜 탭에서 확인해 보세요 💜`;
                    } else {
                      replyMsg = `@${username} 님! '${kw}' 공구는 지금 맘캘린더에 등록된 일정이 안 보여요 🥺 새 일정은 계속 올라오고 있어서, 프로필 링크 맘캘린더 웹사이트에서 '${kw}' 검색해서 주기적으로 확인해 보시거나 키워드 알림을 켜두시면 올라오는 즉시 알려드려요 💜`;
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

// 🧼 상품명 정리기 — 문장·자랑·안내가 섞인 이름에서 「브랜드 + 상품명」 만 남긴다 (사장님 2026-11-04 「걸러야지 브랜드랑 상품명 같은 것만 떼야지」)
//   · 호출: POST /functions/v1/name-clean  헤더 x-cron-secret  본문 {"names":["…","…"]}  → {"map":{"원문":"정리본"|null}, "ai":N, "dict":N}
//   · 순서: ① 사전(name_clean_dict) 히트 → 0원  ② 처음 보는 이름만 AI(Haiku) → 사전에 저장. 같은 이름은 두 번 AI 에 안 간다(메모리 ai-spend-must-accumulate).
//   · AI 는 「원문에서 지우기만」 한다. 검증: 정리본의 글자(공백 제외)가 원문 글자의 **부분수열**이어야 한다(지어내거나 순서를 바꾸면 버린다) · 2글자 이상 · 원문보다 길지 않다.
//   · 정리할 게 없으면(이미 브랜드+상품명) null. 하루 AI 호출 상한 NAME_CLEAN_AI_PER_DAY(기본 400).
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const AI_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("BOT_AI_MODEL") || "claude-haiku-4-5";
const PER_DAY = Number(Deno.env.get("NAME_CLEAN_AI_PER_DAY") || 400);

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", ...((init.headers as Record<string, string>) || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`sb ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const squash = (s: string) => s.replace(/\s+/g, "");
const tok = (s: string) => s.split(/[\s,]+/).filter(Boolean);
// 정리본의 낱말은 원문의 낱말(그대로)이어야 하고 원문 순서를 지켜야 한다 — 글자를 깎아 「유리제로」→「유리제」 처럼 바꾸면 버린다
function valid(orig: string, clean: string): boolean {
  const a = tok(orig), b = tok(clean);
  if (squash(clean).length < 2 || squash(clean).length > squash(orig).length || !b.length) return false;
  const strip = (x: string) => x.replace(/[,.~!]+$/g, "");
  let i = 0;
  for (const w of a) { if (i < b.length && (w === b[i] || strip(w) === strip(b[i]))) i++; }
  return i === b.length;
}
const SYSTEM = [
  "맘캘린더(공동구매 일정 사이트)의 상품명 정리기. 입력은 인스타·인포크에서 가져온 공구 이름 목록이다.",
  "각 이름에서 「브랜드 + 상품명(규격·옵션 포함)」 만 남기고 문장·자랑·안내·날짜·할인·행사 문구는 뺀다.",
  "규칙: ① 원문에 있는 낱말만 그대로 쓴다(낱말을 깎거나 바꿔 쓰기·순서 바꾸기·지어내기 금지) — 낱말 단위로 지우기만 한다. ② 이미 브랜드+상품명뿐이면 원문 그대로. ③ 브랜드를 지우지 않는다. ④ 상품이 여럿이면 원문 순서대로 모두 남긴다.",
  "상품을 설명·추천·감탄하는 말(…에 진심인, …했던, …하는, 역시, 최고의, 믿고 쓰는, 엄마 선택 등)은 뺀다. 앞쪽이 모두 이런 설명 문구이고 마지막 낱말이 상품명이면 그 낱말만 남긴다. 상품 종류를 좁혀 주는 말(예: 얼룩&오염 흔적 지우개의 얼룩&오염 흔적)은 남긴다.",
  "예: '오 브리에 패드, 세럼, 크림 찐템이면 건조한 계절 하나도 안두려움' → '오 브리에 패드, 세럼, 크림' / '정로스 은은한 광택이 다했다~ 마탱 글로시 다운 패딩' → '정로스 마탱 글로시 다운 패딩' / '맛있고 챙겨먹기 편한, 비타알펜 영양제 4종' → '비타알펜 영양제 4종'",
  "출력: JSON 배열 한 개만. 입력과 같은 순서·같은 길이: [{\"name\":\"정리본\"}, …]. 다른 말 금지.",
].join("\n");

async function aiCallsToday(): Promise<number> {
  try {
    const since = new Date(Date.now() - 86400e3).toISOString();
    const r = await sb(`name_clean_dict?select=src_name&src=eq.ai&created_at=gte.${encodeURIComponent(since)}&limit=1000`);
    return Array.isArray(r) ? r.length : 0;
  } catch { return 0; }
}
async function askAI(names: string[]): Promise<(string | null)[] | null> {
  if (!AI_KEY) return null;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(names) }] }),
    signal: AbortSignal.timeout(40000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const raw = String(j?.content?.[0]?.text || "");
  const m = raw.match(/\[[\s\S]*\]/); if (!m) return null;
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || arr.length !== names.length) return null;
    return arr.map((x: any) => (typeof x?.name === "string" ? x.name.trim() : null));
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* 빈 본문 */ }
  const names: string[] = [...new Set((Array.isArray(body?.names) ? body.names : []).map((x: unknown) => String(x || "").trim()).filter((x: string) => x.length >= 2))].slice(0, 120) as string[];
  const map: Record<string, string | null> = {};
  let dictHits = 0, aiUsed = 0;
  // ① 사전
  const todo: string[] = [];
  for (let i = 0; i < names.length; i += 30) {
    const chunk = names.slice(i, i + 30);
    const q = chunk.map((n) => `"${n.replace(/"/g, '""')}"`).join(",");
    const rows = await sb(`name_clean_dict?select=src_name,clean&src_name=in.(${encodeURIComponent(q)})`).catch(() => []);
    const found = new Map<string, string | null>((rows || []).map((r: any) => [r.src_name, r.clean]));
    for (const n of chunk) { if (found.has(n)) { map[n] = found.get(n) === n ? null : found.get(n)!; dictHits++; } else todo.push(n); }
  }
  // ② 처음 보는 이름 → AI (한 번에 20개)
  if (todo.length && AI_KEY && (await aiCallsToday()) < PER_DAY) {
    for (let i = 0; i < todo.length; i += 20) {
      const chunk = todo.slice(i, i + 20);
      const out = await askAI(chunk);
      if (!out) { for (const n of chunk) map[n] = null; continue; }
      const save: any[] = [];
      chunk.forEach((n, k) => {
        const c = out[k];
        const ok = c && c !== n && valid(n, c) ? c : null;
        map[n] = ok;
        save.push({ src_name: n, clean: ok ?? n, src: "ai", model: MODEL });
        aiUsed++;
      });
      await sb("name_clean_dict", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(save) }).catch(() => {});
    }
  } else { for (const n of todo) map[n] = null; }
  return json({ ok: true, map, dict: dictHits, ai: aiUsed });
});

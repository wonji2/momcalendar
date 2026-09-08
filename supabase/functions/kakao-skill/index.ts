// 카카오톡 채널 챗봇 스킬 서버 (사장님 지시 2026-09-01)
//
//   손님이 말하는 대로 물어도 알아듣는다: "오늘 핫한 공구머있어", "냄비", "오늘 뽀사카 공구있어?"
//
//   🔑 설계 원칙 (전부 실사고에서 나옴)
//   ① **말버릇을 먼저 걷어낸다.** "오늘 핫한 공구머있어" → 남는 낱말이 없으면 '오늘 공구'로 본다.
//      안 걷어내면 '핫한 머' 라는 브랜드를 찾다가 "없어요" 를 뱉는다 (2026-09-01 사장님 지적).
//   ② 브랜드 낱말이 시간어보다 우선. ('오늘'을 먼저 보면 "오늘 뽀사카 공구있어?" 가 전체 목록으로 샌다)
//   ③ 진짜 브랜드를 못 찾았을 때만 "없어요" 카드를 낸다 (사장님: 그건 나쁘지 않다).
//
//   🔴 맘캘린더·이웃셀러 공구는 무조건 맨 앞 + 💜. 파트너는 **따로 조회해 앞에 붙인다**
//      (전체를 받아 정렬하면 오늘 348건 중 파트너가 상위 N 밖으로 밀린다).
//   ⚠ 카카오 규격: 캐러셀 최대 5장 · 캐러셀 안 항목 최대 4개(단일 5개) · 버튼 label 14자 · textCard 400자.
//      어기면 응답이 통째로 버려져 손님에겐 무응답. **봇테스트는 이 검사를 안 한다.**
//   ⚠ 손님이 '상담 진행중' 이면 카카오가 챗봇을 아예 호출하지 않는다 → 채널 관리자센터에서 상담 완료 처리.
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";   // 버전 고정 — 재배포마다 최신을 받지 않게 (f9 검증 지적)
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.124.0/helpers/zod";
const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";
// 핫딜에 사진이 없을 때 쓸 기본 이미지 — basicCard 는 thumbnail 이 비면 규격 위반이다
const FALLBACK_THUMB = "https://momcalendar.com/momcal-appicon.png";
// 카카오가 읽는 것은 jpg·png 다. webp 를 넣었다가 또 규격 위반이 나면 말풍선이 통째로 안 나간다.
const thumbOf = (u: unknown) => {
  let s = String(u || "").trim();
  if (!s) return FALLBACK_THUMB;
  // 카카오는 https 만 받는다. 판매처 CDN 은 http 로 저장된 게 있어 올려준다(실측: 대부분 https 로도 200)
  if (s.startsWith("http://")) s = "https://" + s.slice(7);
  if (!s.startsWith("https://")) return FALLBACK_THUMB;
  // ⚠ 확장자로 거르지 않는다 — 쿠팡·지마켓은 확장자가 없어도 jpeg 이고,
  //    webp 를 .jpg 로 바꾸면 오히려 404 가 되는 경로가 있다(2026-09-02 실측으로 4건 깨뜨렸다).
  return s;
};
const HELP = ["맘캘린더예요! 공구 일정을 알려드려요", "", "· 오늘 공구 뭐있어?", "· 오늘 마감 공구 알려줘", "· 이번주 공구", "· 브랜드 이름 (예: 냄비, 기저귀)"].join("\n");
const MAX_SHOW = 20;   // 캐러셀 5장 × 4건 (카카오 최대치)

const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const norm = (x: unknown) => String(x || "").toLowerCase().replace("@", "").trim();
const MOMCAL = ["momcal_", "momcalendar", "momcal", "momcalendar_"];
const COLS = "id,name,influencer,insta,open_date,end_date,pay_link";

async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? await r.json() : [];
}
/** 그 낱말이 진행중 공구 **상품명**에 실제로 있나.
 *  ⚠ 조회에 실패하면 true 를 준다 — 확실하지 않으면 낱말을 빼지 않는다(안전측). */
// "DB 에 아예 없는 낱말" 판정 — 🔴 기간 무관으로 본다 (2026-09-07 사장님: 「하베브릭스 장난감」→ 없다고 하는 게 낫다).
//   진행중만 보면 마감된 브랜드(하베브릭스, 지난 공구 3건)가 '없는 낱말' 로 빠지고 '장난감' 만 남아 다른 브랜드 장난감이 나간다.
//   지난 공구에라도 있으면 진짜 낱말이다 → 남긴다 → AND 0건 → "없어요 + 지난번엔 하베브릭스 모래놀이". (_today 는 호환용)
async function hasWord(w: string, _today: string): Promise<boolean> {
  try {
    const e = encodeURIComponent("%" + w + "%");
    const r = await q(`gonggu?select=id&approved=eq.true&name=ilike.${e}&limit=1`);
    return Array.isArray(r) ? r.length > 0 : true;
  } catch { return true; }
}
/** 조건에 맞는 건수만 센다 (본문은 안 받는다). 못 세면 -1. */
async function countOf(path: string): Promise<number> {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" } });
    const cr = r.headers.get("content-range") || "";     // "0-0/37"
    const n = Number(cr.split("/")[1]);
    return Number.isFinite(n) ? n : -1;
  } catch { return -1; }
}
/**
 * 그 낱말이 **브랜드**인가 품목인가.
 * 🔑 브랜드는 상품명 **맨 앞**에 오고 품목은 안 온다 — 실측(2026-09-04):
 *      프레벨롱 10/10(100%) · 룩트 2/2 · 래폴드 1/1 · 뽀로로 5/8(63%)
 *      쌀 2/9(22%) · 휴대용 2/15(13%) · 물티슈·유산균·보관함·수납장·기저귀·간식 0%
 * 이 값으로 "쌀 보관함"(품목 폴백 금지)과 "프레벨롱 유산균"(브랜드 폴백 허용)이 갈린다.
 */
async function brandScore(w: string, today: string) {
  const base = `gonggu?select=id&approved=eq.true&end_date=gte.${today}&limit=1`;
  const all = await countOf(`${base}&name=ilike.${encodeURIComponent("%" + w + "%")}`);
  if (all <= 0) return { all, head: 0, ratio: 0 };
  const head = await countOf(`${base}&name=ilike.${encodeURIComponent(w + "%")}`);
  return { all, head, ratio: head > 0 ? head / all : 0 };
}
async function rpc(fn: string) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok ? await r.json() : [];
}
/**
 * 공구가 없을 때 핫딜에서 찾는다 (사장님 지시 2026-09-01)
 *   "뽀사카 공구는 없는데 오늘 공구 가격에 핫딜이 떴다" — 손님에게 그대로 쓸모 있는 답이다.
 * ⚠ 기간 지난 딜은 절대 안 보낸다(expires_at). 가격이 바뀌면 판매처 추적기가 그 카드를 만료시키므로 여기서 자동으로 빠진다.
 * 낱말이 여러 개면 제목에 **전부 들어간** 것만 (뽀로로 AND 사운드 → 사운드카드 딜만 잡힌다).
 */
async function findHotdeal(words: string[], today: string) {
  const nowIso = new Date().toISOString();
  const cands = [...new Set(words.map((w) => (w || "").trim()).filter((w) => w.length >= 2))].slice(0, 3);
  for (const phrase of cands) {
  // 🔑 공구 검색과 같은 이유로 한 글자도 넣는다 — 빼면 "쌀 보관함" 이 보관함만 걸려
  //    벨베이비 자석블럭(이름에 보관함이 들어간다)이 핫딜로 나갔다. 낱말끼리 AND 라 좁아진다.
  const HD1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
    const ws = phrase.split(/\s+/).filter((w) => w.length >= 2 || (w.length === 1 && !HD1.includes(w)));
    if (!ws.length) continue;
    const and = ws.map((w) => `title.ilike.${encodeURIComponent("%" + w + "%")}`).join(",");
    const cond = ws.length >= 2 ? `and=(${and})` : `title=ilike.${encodeURIComponent("%" + ws[0] + "%")}`;
    const hd = await q(`hotdeals?select=id,title,price,price_before,mall,link,deal_day,img_url&${cond}` +
      `&or=(expires_at.is.null,expires_at.gt.${nowIso})&order=id.desc&limit=1`) as any[];
    if (Array.isArray(hd) && hd.length && hd[0].link) {
      const d = hd[0];
      const won = (n: number) => Number(n || 0).toLocaleString("ko-KR") + "원";
      const isToday = String(d.deal_day || "") === today;
      return {
        basicCard: {
          // ⚠ thumbnail 은 카카오 basicCard 필수 항목이다 — 빠지면 말풍선이 미발송 처리된다(2026-09-02 실경고)
          thumbnail: { imageUrl: thumbOf(d.img_url) },
          title: "공구는 없지만 핫딜이 떴어요! 🔥",
          description: `${isToday ? "오늘 올라온 핫딜이에요\n\n" : ""}${d.title}\n${won(d.price)}${d.price_before ? ` (원래 ${won(d.price_before)})` : ""} · ${d.mall || ""}\n\n공구로는 안 열렸지만 이 값이면 공구 가격이에요.`.slice(0, 400),
          buttons: [
            { action: "webLink", label: "핫딜 보러가기", webLinkUrl: String(d.link) },
            { action: "webLink", label: "맘캘린더", webLinkUrl: SITE },
          ],
        },
      };
    }
  }
  return null;
}
async function aliases(): Promise<[string, string][]> {
  const rows = await q("bot_alias?select=term,expand");
  return (rows as any[]).map((r) => [String(r.term), String(r.expand)] as [string, string]);
}
// 사장님이 관리자 화면에서 확정한 말투 — 재배포 없이 즉시 반영된다 (bot_review_48.sql)
//   자동 학습은 오타만 배운다. "고마웡" 같은 말투는 사람이 판정해야 하고, 그 창구가 이것이다.
async function phrases(): Promise<[string, string][]> {
  const rows = await q("bot_phrase?select=term,kind");
  return (rows as any[]).map((r) => [String(r.term), String(r.kind)] as [string, string]);
}

// ── 🧠 말귀 학습 (사장님 지시 2026-09-06 "돈을 쓰는만큼 무조건 학습해서 … 데이터 많이 쌓이면 똑똑해져서 ai안써도 되게")
//   순서: ① 해석 사전(bot_interp) 히트 → 0원 즉답  ② 규칙 검색  ③ 그래도 못 찾으면 AI 해석 → 사전에 저장 → 그 해석으로 다시 찾는다
//   같은 말은 두 번 AI 에 안 간다. AI 는 "무엇을 찾는지"만 말하고 카드는 100% 우리 DB 에서 나온다(없는 공구를 지어낼 수 없다).
//   키가 없으면(ANTHROPIC_API_KEY 미설정) ③ 만 조용히 건너뛴다. 모델은 BOT_AI_MODEL 로 바꾼다(기본 Haiku 4.5 — 사장님 "최소 비용").
//   설계 원본: scratchpad/챗봇AI도입_계획.md 8장.
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || KEY;   // 사전 쓰기는 서비스 키 (anon 은 읽기만 허용)
const AI_MODEL = Deno.env.get("BOT_AI_MODEL") || "claude-haiku-4-5";
const INTENTS = ["search", "today", "tomorrow", "week", "weekend", "closing", "popular", "hotdeal", "greeting", "thanks", "other"] as const;
type Interp = { intent: string; q: string; cat: string; src: string };
const InterpSchema = z.object({ intent: z.enum(INTENTS), q: z.string(), cat: z.string() });
const AI_SYSTEM = [
  "너는 '맘캘린더' 카카오 챗봇의 해석기다. 맘캘린더는 인스타그램 공동구매(공구) 일정을 모아 보여주는 사이트다.",
  "손님이 카톡으로 친 짧은 말을 읽고 무엇을 원하는지만 JSON 으로 답한다. 답변 문장은 쓰지 않는다.",
  "intent: search(브랜드·상품·품목을 찾는다) | today(오늘 오픈) | tomorrow | week(이번 주) | weekend | closing(오늘 마감·끝나는 것) | popular(인기·베스트·핫한·잘 나가는·많이 보는 공구) | hotdeal(손님이 '핫딜·특가·세일' 이라는 낱말을 직접 썼고 찾는 상품이 없을 때만) | greeting(인사·도움말) | thanks(감사·칭찬) | other",
  "🔴 상품·품목·브랜드가 한 낱말이라도 있으면 무조건 search 다. '기저귀 싸게 파는데 없나' 는 hotdeal 이 아니라 search(q=기저귀). '요즘 핫한 공구' 는 hotdeal 이 아니라 popular.",
  "🔴 네가 모르는 낱말 하나짜리 말('이치비야','뮤이','도들','끄링물')은 브랜드·상품명일 가능성이 크다 → greeting/other 가 아니라 search(q=그 말 그대로). greeting 은 '안녕'·'하이' 처럼 인사가 분명할 때만, other 는 자모만 있거나 뜻이 없는 말('ㅁㄴㅇㄹ','xyz')에만.",
  "q: intent 가 search 일 때 검색할 핵심 낱말. 손님이 쓴 브랜드·상품명 표기를 **한 글자도 바꾸지 말고 그대로** 쓴다(줄이거나 고치지 않는다). 조사·어미·수식어('싸게','좀','그거','있어?')만 뺀다. 'A 말고 B' 면 B 만. 여러 품목이면 공백으로 나열. search 가 아니면 빈 문자열.",
  "cat: 짐작되는 분류 하나(육아·식품·리빙·뷰티·패션·반려동물·기타) 또는 빈 문자열.",
].join("\n");
const normUtt = (x: string) => x.toLowerCase().replace(/[?？!！.,~♡♥]+$/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
async function interpLookup(u: string): Promise<Interp | null> {
  try {
    const un = normUtt(u); if (!un) return null;
    const rows = await q(`bot_interp?select=intent,q,cat&utt_norm=eq.${encodeURIComponent(un)}&limit=1`);
    const r = (rows as any[])[0]; if (!r) return null;
    return { intent: String(r.intent), q: String(r.q || ""), cat: String(r.cat || ""), src: "dict" };
  } catch { return null; }
}
// 사전에서 답했다 — 히트 수(= 아낀 호출 수)와 카드가 나왔는지를 기록한다. 실패는 무시.
function interpHit(u: string, ok: boolean) {
  try {
    fetch(`${SB}/rest/v1/rpc/bot_interp_hit`, { method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_utt: normUtt(u), p_ok: ok }) }).catch(() => {});
  } catch (_) { /* 무시 */ }
}
function logEv(type: string, data: string) {
  try {
    fetch(`${SB}/rest/v1/events`, { method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ event_type: type, event_data: data.slice(0, 200) }) }).catch(() => {});
  } catch (_) { /* 무시 */ }
}
// ── 🔴 돈이 나간 호출은 한 건도 버리지 않는다 (사장님 2026-09-08 "돈나가는데 학습안되면 때려쳐")
//   전에는 AI 를 2~2.5초에서 **끊었다** — Anthropic 은 그래도 과금하고 결과는 버려졌다(하루 16%).
//   이제 AI 요청은 끊지 않는다(최대 8초). 답장 마감(DEADLINE)까지 안 오면 답은 규칙으로 먼저 나가고,
//   AI 결과는 **엣지 함수 백그라운드(EdgeRuntime.waitUntil)** 에서 끝까지 받아 사전에 저장한다 → 다음 손님부터 0원·0.3초.
const PENDING: Promise<unknown>[] = [];
function keepAlive(p: Promise<unknown>) {
  PENDING.push(p);
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(Promise.allSettled(PENDING)); } catch (_) { /* 로컬 실행 등 — 없으면 그냥 간다 */ }
}
// 답장 마감 — AI 시작 시점 기준. 실측 p50 1,671 · p90 1,833ms → 2,600 이면 90%+ 가 제때 온다. 넘기면 규칙 답 + 백그라운드 학습.
const AI_DEADLINE_MS = Number(Deno.env.get("BOT_AI_DEADLINE_MS") || 2600);
const LATE = Symbol("late");   // "마감 초과" 와 "AI 가 즉시 null(키 없음·오류)" 을 가른다 — 2026-09-08 검증: null 로 뭉뚱그려 err 마다 late 가 덤으로 찍혔다
async function withDeadline<T>(p: Promise<T>, ms: number, u: string): Promise<T | null> {
  let timer: number | undefined;
  const late = new Promise<typeof LATE>((res) => { timer = setTimeout(() => res(LATE), ms); });
  const r = await Promise.race([p, late]);
  clearTimeout(timer);
  if (r === LATE) { keepAlive(p); logEv("kakao_bot_ai_late", `${u.slice(0, 40)} | ${ms}ms 안에 못 옴 → 규칙 답, 백그라운드 저장`); return null; }
  return r as T | null;
}
async function interpAI(u: string, tReq: number): Promise<Interp | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) return null;
  // 요청 시작 3.5초가 지났으면 시작조차 안 한다(돈을 안 쓴다). 그 전이면 시작하고, 마감은 withDeadline 이 건다.
  // ⚠ "콜드스타트 직후면 건너뛰기"(모듈 시각 기준)는 넣었다가 뺐다 (2026-09-08) — 엣지는 요청마다 새 인스턴스라 전 요청이 cold 로 보여 AI 가 꺼졌다.
  if (Date.now() - tReq > 3500) return null;
  const t0 = Date.now();
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 8000 });   // 끊지 않는다 — 8초는 과금·인스턴스 상한
    const res = await client.messages.parse({
      model: AI_MODEL, max_tokens: 200, system: AI_SYSTEM,
      messages: [{ role: "user", content: u.slice(0, 200) }],
      output_config: { format: zodOutputFormat(InterpSchema) },
    });
    const p = res.parsed_output; if (!p) return null;
    const it: Interp = { intent: p.intent, q: p.q.trim().slice(0, 60), cat: p.cat.trim().slice(0, 20), src: "ai" };
    const inT = res.usage?.input_tokens ?? 0, outT = res.usage?.output_tokens ?? 0;
    // 🔴 저장 — 같은 말은 두 번 AI 에 안 간다. 저장 실패해도 답은 나간다. 답이 먼저 나갔어도 이 저장은 keepAlive 로 끝까지 간다.
    const saveP = fetch(`${SB}/rest/v1/bot_interp`, { method: "POST",
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ utt_norm: normUtt(u), utt: u.slice(0, 120), intent: it.intent, q: it.q, cat: it.cat, src: "ai", model: AI_MODEL, in_tok: inT, out_tok: outT }) }).catch(() => {});
    keepAlive(saveP);
    logEv("kakao_bot_ai", `${u.slice(0, 40)} => ${it.intent}:${it.q} | ${inT}/${outT}tok | ${Date.now() - t0}ms`);
    return it;
  } catch (e) {
    logEv("kakao_bot_ai_err", `${u.slice(0, 40)} | ${String((e as any)?.message || e).slice(0, 80)} | ${Date.now() - t0}ms`);
    return null;
  }
}

async function partnerHandles(): Promise<string[]> {
  const rows = await q("sellers?select=insta&is_partner=eq.true&active=eq.true");
  const set = new Set<string>(MOMCAL);
  for (const r of rows as any[]) { const h = norm(r.insta); if (h) set.add(h); }
  return [...set];
}
async function pick(cond: string, order: string, ph: string[]) {
  const inList = `(${ph.map((h) => `"${h}"`).join(",")})`;
  const partner = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&insta=in.${inList}&${order}&limit=15`);
  const rest = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&${order}&limit=30`);
  const seen = new Set((partner as any[]).map((g) => g.id));
  const out = [...(partner as any[]).map((g) => ({ ...g, __p: true }))];
  for (const g of rest as any[]) { if (!seen.has(g.id)) out.push({ ...g, __p: false }); if (out.length >= MAX_SHOW) break; }
  return out.slice(0, MAX_SHOW);
}

const text = (t: string) => ({ textCard: { text: t.slice(0, 390), buttons: [{ action: "webLink", label: "맘캘린더 바로가기", webLinkUrl: SITE }] } });
const one = (title: string, items: any[]) => ({
  header: { title: title.slice(0, 30) },
  items: items.map((g: any) => ({
    title: (g.__p ? "💜 " : "") + String(g.name || "").slice(0, 34),
    description: `${g.influencer || g.insta || ""} · ${String(g.open_date).slice(5)}~${String(g.end_date).slice(5)}`.replace(/^ · /, ""),
    link: { web: String(g.pay_link || "").startsWith("http") ? String(g.pay_link) : (g.insta ? `https://instagram.com/${norm(g.insta)}` : SITE) },
  })),
  buttons: [{ action: "webLink", label: "전체 일정 보기", webLinkUrl: SITE }],
});
function cards(title: string, rows: any[]) {
  if (rows.length <= 5) return { listCard: one(title, rows) };
  const ch: any[][] = [];
  for (let i = 0; i < rows.length && ch.length < 5; i += 4) ch.push(rows.slice(i, i + 4));
  return { carousel: { type: "listCard", items: ch.map((c, i) => one(`${title} ${i + 1}/${ch.length}`, c)) } };
}

// 말버릇·조사·감탄사를 걷어낸다. 남는 것이 브랜드다.
//   ⚠ 여기 낱말을 늘리는 것이 "더 잘 알아듣게" 하는 가장 싼 방법이다.
//     못 알아들은 말은 events.kakao_bot_miss 에 쌓이니 그걸 보고 채운다.
// 🔑 말끝(어미)은 **문장 끝에서만** 잘라낸다. 낱말 한가운데를 지우면 브랜드가 깨진다.
//    2026-09-01 사고: 전역 치환으로 머그컵→'그컵', 해담옥→'담옥', 소고기뭐있어→'소고기 어' 가 됐다.
const TAILS: RegExp[] = [
  /(?:[?？!！~.,ㅋㅎㅠㅜ\s]|z{2,}|Z{2,})+$/,   // zzz=ㅋㅋㅋ (z 2개 이상만 — kidz 같은 브랜드 보호)
  /(뭐|머|모)\s*(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐)?$/,   // 오타 잇어 포함 (실제 손님)
  /(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐|는지)?$/,
  /(없|업)(어요|어|엉|음|나요|나|니)?$/,
  /알려\s*(주세요|주라|줄래|줘|죠|줭)?$/,
  /보여\s*(주세요|주라|줘|죠|줭)?$/,
  /말해\s*(봐|바|줘)?$/,
  /얘기\s*(해|해줘)?$/,
  /추천\s*(해)?\s*(주세요|줘|죠|줭)?$/,
  /찾아\s*(주세요|줘|죠|봐)?$/,
  /해\s*(주세요|주라|줘|죠|줭)$/,
  /(뭐야|머야|뭐임|뭔데|뭐가|머가|뭐|머)$/,
  /(종류|모음|관련|같은거|같은\s*거)$/,
  /(언제|어때|어떤|얼마|어디)\s*(해요|해용|하나요|하나|한대요|한대|함|해|야)?$/,   // "물티슈 언제해요?"
  /(냐고|라고|다고|인데|는데|건데|잖아)$/,   // ⚠ 이야·이지·임 은 뺐다 — 브랜드 끝 글자를 먹는다(2026-09-06 검증)
  /궁금\s*(해요|해용|해영|한데|하다|해|행)?$/,          // "물티슈 공구궁금해요!" (실제 손님)
  /(알고|보고|사고)\s*싶(어요|어|다|은데)?$/,
  /(어떤가요|어떨까요|없을까요|있을까요|될까요)$/,
  /(주세요|주라|줄래|줘요|줘)$/,
  /[♡♥❤️🩷💜🙏😊😀ㅡ]+$/,                                  // "…궁금해♡" 처럼 붙는 기호
  // ⚠ 이·만 은 넣지 말 것 — 브랜드 끝 글자를 조사로 먹는다 (2026-09-02, 닥터포이→닥터포)
  //   '이' 끝 16종 104건: 미스티파이·꼬메모이·돌잡이·팁토이조이·리즈파이·대발이·마더케이·길쭉담이 …
  //   '만' 끝: 실리만 → '실리' 로 깎이면 실리콘 상품까지 섞여 나온다
  //   어제 inpock_harvest 관형형 검사에서 고친 것과 같은 뿌리다(모윰 쪽쪽이 드롭 사고)
  // ⚠ 조사·짧은꼬리는 여기 두지 않는다 — 아래 CUT_TAILS 로 뺐다 (2026-09-02)
  //    브랜드 끝 글자를 먹기 때문이다. **깎기 전 판으로 먼저 찾고** 없을 때만 이걸 쓴다.
  /(인거|인것|하는거|되는거|인가|인가요|예요|에요)$/,
  //   메쉬넵→메쉬 (2026-09-01) · 이치비야→이치비 (2026-09-02, 사장님 지적)
  //   "야" 로 끝나는 브랜드 8종: 이치비야·밧드야·하코야·요거모야·꽃게야·코코이찌방야·고새야
  //   "뭐야"·"얼마야" 는 위쪽 규칙이 이미 잡는다.
];
// 🔴 **낱말의 글자를 깎는 규칙은 없다** (사장님 지시 2026-09-06)
//   "단어 끝에 '이'자 맘대로 빼고 이런식으로 자꾸 앞뒤 낱말을 빼버리더라고 그럼 브랜드 이름이 이상하게 뭉개져서 안되고
//    ai처럼 학습해서 사람 말 알아듣게 해봐"
//   09-02~09-05 나흘간 조사(이·가·은·는·을·를·도) 를 떼는 규칙을 여섯 번 고쳤다 — 규칙으로는 '국이'(조사)와 '종이'(낱말),
//   '인도'(나라)와 '만두도'(만두+도) 를 가를 수 없다. 여기 있던 NOT_JOSA 화이트리스트·CUT_TAILS·DB 건수 판정을 전부 걷어냈다.
//   → 위 TAILS(문장 끝 말버릇, 낱말 단위)만 걷어내고, 그래도 못 찾으면 **AI 해석 → 해석 사전(bot_interp)** 이 맡는다.
//   ⚠ 조사·어미를 글자 단위로 떼는 코드를 다시 넣지 말 것. 「국이 있어?」는 AI 가 q=국 을 내고 사전에 남아 두 번째부터 0원이다.
// 말끝에 ㅇ 을 붙이는 말투를 벗긴다 — 고마웡→고마워 · 안뇽→안녕(X, 이건 목록) · 감사해용→감사해요 · 있엉→있어
//   ⚠ 마지막 글자에만 쓴다. 문장 전체에 쓰면 티니핑→티니피 처럼 브랜드가 깨진다 (사장님 지적한 유형)
function deJong(s: string) {
  const t = s.trim(); if (!t) return t;
  const c = t.charCodeAt(t.length - 1) - 0xAC00;
  if (c < 0 || c > 11171) return t;
  if (c % 28 !== 21) return t;                       // 21 = 받침 ㅇ
  return t.slice(0, -1) + String.fromCharCode(0xAC00 + (c - 21));
}

function stripTail(s: string) {
  let prev = "";
  for (let i = 0; i < 8 && s !== prev; i++) {
    prev = s;
    for (const re of TAILS) s = s.replace(re, "").trim();
  }
  return s;
}
// 손님이 친 말에서 **문장 부품(낱말 단위)** 만 걷어낸다. 낱말의 글자는 절대 깎지 않는다.
function keyword(u: string) {
  let s = stripTail(u);
  // 여기서 지우는 것은 **문장 부품**뿐이다. 브랜드가 될 수 있는 낱말은 절대 건드리지 않는다.
  //   ⚠ 전역 치환은 낱말 속까지 먹는다 — 머그컵→'그컵', 해담옥→'담옥' 사고(2026-09-01).
  //     그래서 어미·감탄사는 stripTail 이 **문장 끝에서만** 처리하고, 여기선 안전한 것만 지운다.
  s = s
    .replace(/이번\s*주에?|이번주|주간|오늘|내일|낼모레|낼|모레|요즘|지금|현재/g, " ")
    // 공궤·공귀 = 공구 오타 (2026-09-02 실제 손님: "노리터보드 공궤" → 못 찾고 다시 쳤다)
    .replace(/공동구매|공구|공궤|공귀|일정|소식|목록|리스트/g, " ")
    // 실제 손님 발화에서 나온 말 (2026-09-01: "오늘 공구 진행중인 제품 알려줘")
    .replace(/진행\s*중인|진행중|진행|하는\s*중|중인/g, " ")
    .replace(/제품|상품|물건|아이템|템/g, " ")
    .replace(/핫한|인기\s*있는|인기|괜찮은|새로운|저렴한/g, " ")
    .replace(/마지막\s*날|막날|마감|끝나는|끝나|종료|임박|오픈/g, " ")
    .replace(/바부야|바보야|아니고|아니라|말고|그리고|근데|좀/g, " ")
    .replace(/하는\s*곳|파는\s*곳|사는\s*곳|어디서|어디에|어디/g, " ")   // "공구하는곳 있어?" (실제 손님)
    .replace(/[?？!！.,~·\-_/]/g, " ")
    .replace(/\s+/g, " ").trim();
  // 🔴 여기서 cut 을 안 넘겨 **깎기 전 판(kwRaw)이 사실은 깎인 판**이었다 (2026-09-02)
  //    그래서 "오늘 하는 공구" → '하는' → 조사 '는' 이 떨어져 **'하'** 로 검색됐다.
  //    kwRaw 도 이 줄을 지나므로 우선검색·CUT_JUNK 가 통째로 무력했다.
  // 부품을 지우고 남은 **홀로 선 조사** 만 지운다 — "공구 일정이" 의 '이'.
  //   ⚠ CUT_TAILS 에 '이' 를 넣으면 안 된다. 낱말 **끝**을 먹어 닥터포이→닥터포 가 된다.
  //   DB 실측 '이' 끝 브랜드 16종 104건: 미스티파이20·꼬메모이10·돌잡이9·팁토이조이8·마더케이5 …
  const JOSA1 = ["이","가","은","는","을","를","도"];
  s = s.split(" ").filter((w) => !JOSA1.includes(w)).join(" ").trim();
  return stripTail(s);   // 부품을 지운 뒤 다시 말끝 정리 ("소고기 뭐" → "소고기")
}


// 답장 로그(kakao_bot)는 **실제로 손님에게 나간 Response 한 건**만 남긴다.
//   2026-09-08 검증: 규칙 검색(ruleP)을 AI 와 병렬로 돌리면서 버려지는 쪽 reply() 도 로그를 찍어 문장형 발화마다 kakao_bot 이 2행 쌓였다.
//   → reply() 는 로그 문구만 Response 에 붙여두고, 서버 래퍼가 돌려보내는 Response 의 것만 기록한다.
const REPLY_LOG = new WeakMap<Response, string>();
async function handle(req: Request): Promise<Response> {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  // ⚠ reply 는 body 파싱보다 먼저 정의되므로 u/uid 는 let 으로 미리 선언한다 (2026-09-01: 전 요청 500 사고)
  let u = "", uid = "?";
  const reply = (outputs: any[]) => {
    const res = json({ version: "2.0", template: { outputs } });
    try {
      const last = outputs[outputs.length - 1] as any;
      const kind = Object.keys(last || {})[0] || "?";
      const n = last?.carousel?.items?.length ?? 0;
      REPLY_LOG.set(res, `${u.slice(0, 40)} | uid=${uid} | ${kind}${n ? "x" + n : ""}`);   // 기록은 handle() 밖 래퍼가 한다
    } catch (_) { /* 기록 실패는 무시 */ }
    return res;
  };
  try {
    const body = await req.json().catch(() => ({}));
    u = String(body?.userRequest?.utterance ?? "").trim();
    // 인사말로 시작하는 문장은 인사 뒤 본문으로 본다 — 「안녕하세요 하베브릭스 장난감 공구일정 알고싶어요」에 도움말이 나갔다(실손님 09-02)
    //   ⚠ 낱말 경계 필수 — 경계 없이 떼면 「하이드로플라스크」→'드로플라스크', 「헬로디노」→'디노', 「안녕달」→'달' (2026-09-08 검증, 진행중 11건)
    { const rest = u.replace(/^(안녕하세요|안녕하세용|안녕하십니까|안녕|안뇽|안냥|하이용|하이|헬로)(?=[\s,.!~♡♥]|$)[\s,.!~♡♥]*/i, ""); if (rest !== u && rest.length >= 2) u = rest; }
    uid = String(body?.userRequest?.user?.id ?? "?").slice(0, 6) + ":" + String(body?.userRequest?.user?.type ?? "?").slice(0, 4)
        + ":" + String(req.headers.get("user-agent") ?? "?").slice(0, 14);
    const uz = deJong(u);   // 말끝 ㅇ 을 벗긴 판정용 사본 (고마웡→고마워)
    //   ⚠ uz 는 아래 인사 판정보다 먼저 정의해야 한다 — 늦게 두면 TDZ 로 전 요청 500 (2026-09-01 실사고, 2번째)
    const today = ymd(kst());
    // 🔴 요청 단위 타이머 — searchGonggu 안 t0 는 그 함수 지역변수라 밖에서 쓰면 500 이 난다
    //    (2026-09-05 실사고: 조사 재검색 블록이 t0 를 참조해 김이·쌀이·닥터포이가 전부 500)
    const tReq = Date.now();

    // ⚠ 인사말로 시작하는 **브랜드**가 있다 — 하이드로플라스크·헬로디노·안녕달·하이패스(진행중 11건). 첫 낱말이 상품명에 있으면 인사가 아니라 검색이다 (2026-09-08 검증)
    const greetLike = (x=>/^(안녕|안뇽|안냥|하이|하잉|하영|헬로|할롱|hi|hello|반가|방가|도움|사용법|메뉴|뭐해|누구|넵|넹)/i.test(x))(u) || (x=>/^(안녕|안뇽|안냥|하이|하잉|하영|헬로|할롱|hi|hello|반가|방가|도움|사용법|메뉴|뭐해|누구|넵|넹)/i.test(x))(uz) || u.length < 1;
    const w1 = u.split(/\s+/)[0] || "";
    const brandFirst = greetLike && w1.length >= 3 && (await countOf(`gonggu?select=id&name=ilike.${encodeURIComponent("%" + w1 + "%")}&limit=1`)) > 0;
    if (greetLike && !brandFirst) return reply([text(HELP)]);

    // 「아무거나」= 오늘 공구 (사장님 확정 2026-09-07). 사전·AI 보다 앞 — 검색어로 보면 "'아무거나' 없어요" 가 나간다(실손님)
    const wantAny = /^(아무거나|아무거|아무꺼나|암거나|아무말|아무것|추천|추천해줘|추천좀|뭐든)[\s!?~.]*$/.test(u);

    // 인기 질문 ("젤 인기있는", "젤 핫한거", "조회수 많은거", "오늘의 탑텐") — 조회수+찜 합산 순
    const wantTop = /인기|젤\s|제일|가장|탑\s*텐|탑10|탑\s*10|top\s*10|톱텐|조회수|많이\s*본|베스트|best|순위|랭킹/i.test(u);
    const wantClose = /마감|끝나|종료|임박|막차|마지막\s*날/.test(u);
    const wantTomorrow = /내일|낼/.test(u);
    const wantWeek = /이번\s*주|이번주|주간/.test(u);
    const wantWeekend = /주말|토요일|일요일|토일/.test(u);
    const kw = keyword(u);
    const ph = await partnerHandles();

    const todayCards = async () => {
      const rows = await pick(`open_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요. 아래 버튼에서 이번 주 일정을 볼 수 있어요!")]);
      return reply([cards(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    };

    // ⓪-0 사장님이 판정해 둔 말투가 있으면 그것부터 (관리자 화면 🙋 검토)
    const ANS: Record<string, string> = {
      hello:  HELP,
      thanks: "도움이 됐다니 저도 좋아요 🙂\n공구 궁금할 땐 언제든 물어봐 주세요!",
      praise: "헤헤 감사합니다 🙂\n찾으시는 브랜드 이름을 말해주시면 공구 일정을 바로 알려드려요!",
      bye:    "네! 또 필요하면 불러주세요 🙂",
      love:   "나도 사랑해애액 ㅎㅎ 💜\n맘캘린더 많이 써주셔서 감사해요!",
    };
    try {
      const uu = u.replace(/\s/g, "").toLowerCase(), uzz = uz.replace(/\s/g, "").toLowerCase();
      for (const [term, kind] of await phrases()) {
        const t = term.replace(/\s/g, "").toLowerCase();
        if (t && (uu === t || uzz === t || uu.includes(t)) && ANS[kind]) return reply([text(ANS[kind])]);
      }
    } catch (_) { /* 못 읽어도 아래 기본 규칙으로 답한다 */ }

    // ⓪-a 인사·감사·칭찬에는 사람처럼 답한다 (손님이 실제로 이렇게 말한다)
    //   ⚠ 감사 낱말이 든 **브랜드**가 있다 — 「땡스소윤」(냉동용기, DB 4건)이 '땡스' 에 걸려 "저도 좋아요" 가 나갔다(실손님 09-06).
    //     상품명에 그 말이 통째로 있으면 인사가 아니라 검색이다.
    const THANKS_RE = /고마워|고마와|고맙|감사|땡스|땡큐|thank|ㄱㅅ/i;
    //   ⚠ 문장 전체(u)가 아니라 깎은 말(kw)로 센다 — 「땡스소윤 있어?」는 u 로 찾으면 0건이라 감사 답이 나갔다 (2026-09-08 검증)
    if ((THANKS_RE.test(u) || THANKS_RE.test(uz))
        && !(kw.length >= 2 && (await countOf(`gonggu?select=id&name=ilike.${encodeURIComponent("%" + kw + "%")}`)) > 0)) {
      return reply([text("도움이 됐다니 저도 좋아요 🙂\n공구 궁금할 땐 언제든 물어봐 주세요!")]);
    }
    if ((x=>/우와|우왕|와우|대박|쩐다|좋다|좋아요|최고|짱|잘한다|똑똑|귀엽|신기/i.test(x))(u) || (x=>/우와|우왕|와우|대박|쩐다|좋다|좋아요|최고|짱|잘한다|똑똑|귀엽|신기/i.test(x))(uz)) {
      return reply([text("헤헤 감사합니다 🙂\n찾으시는 브랜드 이름을 말해주시면 공구 일정을 바로 알려드려요!")]);
    }
    if ((x=>/잘가|안녕히|바이|수고|굿밤|잘자|들어가|담에 봐|다음에 봐/i.test(x))(u) || (x=>/잘가|안녕히|바이|수고|굿밤|잘자|들어가|담에 봐|다음에 봐/i.test(x))(uz)) {
      return reply([text("네! 또 필요하면 불러주세요 🙂")]);
    }
    // 실제 손님이 이렇게 말했다 (2026-09-01 첫날 로그: "맘방사랑해") — 사장님 지시로 이스터에그
    if ((x=>/사랑해|사랑행|사랑합니다|좋아해|팬이|잘쓰고|잘 쓰고/i.test(x))(u) || (x=>/사랑해|사랑행|사랑합니다|좋아해|팬이|잘쓰고|잘 쓰고/i.test(x))(uz)) {
      return reply([text("나도 사랑해애액 ㅎㅎ 💜\n맘캘린더 많이 써주셔서 감사해요!")]);
    }

    // ⓪-0 이스터에그 (사장님 지시 2026-09-01)
    if (/송중기/.test(u)) {
      return reply([text("TMI 방장아들은 1초 송중기를 닮았다 맘캘 VIP 회원님 감사합니다 🙂")]);
    }

    // ⓪ 핫딜·특가 질문 (사장님 지시 2026-09-01 → 2026-09-06 보강)
    //   상품 낱말이 같이 오면(「물티슈 특가 있어?」) **공구 먼저, 없으면 핫딜 카드(수익링크 버튼)** — searchReply 안의 기존 폴백이 그 순서다.
    //   사장님: "당연히 공구있으면 공구 먼저 알려주는데 핫딜있냐거나 공구 없으면 그때 핫딜로 안내하면 될듯 (내수익링크로)"
    //   상품 낱말이 없으면 예전 안내 그대로. AI 는 안 탄다(핫딜 질문은 낱말이 분명하다).
    const HD_GUIDE = "핫딜은 아직 챗봇에서는 안 알려드려요 🙏\n맘캘린더 사이트 '🔥 핫딜' 탭에서 오늘 올라온 특가를 모아 보실 수 있어요!";
    const hdAsk = /핫딜|특가|할인|세일|최저가|딜\b/.test(u);
    // ⚠ 핫딜 낱말에 붙은 어미까지 같이 뗀다 — 「해담옥 세일해?」에서 '해' 가 남아 '해담옥 해' 로 사랑해 보드북이 나갔다(실측)
    const hdWord = hdAsk ? keyword(u.replace(/(핫딜|특가|할인|세일|최저가|딜\b)\s*(하나요|하냐|하니|해요|해|함|중|이야|야|은|는|이|가|도|로|으로)?/g, " ")).replace(/\s+/g, " ").trim() : "";
    if (hdAsk && hdWord.length < 2) return reply([text(HD_GUIDE)]);

    // ⓪-b 인기 질문 ("젤 인기있는", "젤 핫한거", "조회수 많은거", "오늘의 탑텐") = 조회수 + 찜 합산 순
    const topCards = async (): Promise<Response | null> => {
      const [cc, wc] = await Promise.all([rpc("gonggu_click_counts"), rpc("wish_counts")]);
      const score = new Map<number, number>();
      for (const r of cc as any[]) score.set(r.id, (score.get(r.id) ?? 0) + (r.clicks ?? 0));
      for (const r of wc as any[]) score.set(r.gonggu_id, (score.get(r.gonggu_id) ?? 0) + (r.cnt ?? 0));
      const ids = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map((x) => x[0]);
      if (ids.length) {
        const rows = await q(`gonggu?select=${COLS}&approved=eq.true&end_date=gte.${today}&id=in.(${ids.join(",")})&limit=60`);
        const sorted = (rows as any[])
          .map((g) => ({ ...g, __s: score.get(g.id) ?? 0, __p: ph.includes(norm(g.insta)) }))
          .sort((a, b) => (a.__p === b.__p ? b.__s - a.__s : (a.__p ? -1 : 1)))
          .slice(0, MAX_SHOW);
        if (sorted.length) return reply([cards("지금 인기 있는 공구", sorted)]);
      }

      return null;
    };
    // ① 브랜드·상품 검색에 쓰는 상수 (말버릇을 걷어내고 남은 낱말이 있을 때만 찾는다)
    // 한 글자("김")도 찾는다. 다만 한 글자는 셀러명까지 보면 오탐이 크니 상품명만 본다.
    const STOP1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
    // 문장 부품을 지우고 남은 찌꺼기는 브랜드가 아니다 — 이걸 검색하면 엉뚱한 안내가 나간다
    const STOPKW = ["되는거","하는거","되는것","하는것","되는","하는","임박","주말","토요일","일요일","평일","이번","다음","우리","그거","이거","저거","해줘","하는곳","파는곳","어디","언제","얼마","가격","알려","보여","추천"];
    // 부품을 지우고 숫자·기호만 남으면 브랜드가 아니다 (2026-09-02)
    //   "없는브랜드12345" 가 '5' 로 줄어 '5' 가 든 상품 20건을 뿌렸다 — 손님에겐 뜻 없는 답이다.
    //   '5차'(한글 있음)·'1+1'(3글자) 은 그대로 통과한다.
    const NUMONLY = kw.length <= 2 && !/[가-힣a-zA-Z]/.test(kw);
    // 🔴 **깎기 전 판을 맨 앞에 둔다** (사장님 지시 2026-09-02: "말을 깎는건 절대 안 된다")
    //   "닥터포이" 를 물으면 조사판은 '닥터포' 지만 깎기 전 판은 '닥터포이' 다.
    //   DB 에 '닥터포이' 가 있으면 그쪽에서 잡히고 조사판까지 가지 않는다.
    const kwRaw = kw;   // 깎은 판이 따로 없다 — 낱말의 글자를 깎지 않는다 (2026-09-06)
    // 🔴 **화면에 보이는 말·지난공구 조회는 손님이 친 말로 한다** (2026-09-04 실사고)
    //    조사 '이' 를 깎으면 '닥터포이' 가 '닥터포' 가 되고, 그 말로 지난공구를 찾으면
    //    **닥터포헤어**(전혀 다른 브랜드)를 권하게 된다. 검색은 깎은 판까지 써도 되지만
    //    **말을 걸 때와 지난공구를 찾을 때는 손님 말** 이어야 한다.
    let say = kwRaw || kw;
    // 🔴 **깎아서 만든 조각으로는 검색하지 않는다** (사장님 지적 2026-09-02)
    //   "오늘 하는 공구 알려줘" → 부품을 지우면 '하는', 조사 '는' 을 떼면 **'하'** 가 되어
    //   '하' 가 든 상품 20건이 나갔다. 날짜 의도('오늘')마저 무시됐다.
    //   ⚠ 목록을 늘려 막지 않는다 — 손님이 쓰는 말은 끝이 없다. 원칙으로 막는다.
    //   '김' 은 손님이 그렇게 친 말이라 통과한다(깎아서 나온 게 아니다).
    // 🔑 깎여서 나온 한 글자를 **전부** 막으면 "컵을"·"쌀이"·"김이" 까지 죽는다 (2026-09-04 실측).
        //    막아야 하는 건 용언 어간뿐이다 — "오늘 하는 공구" 의 '하' 같은 것.
        //    조사(을·를·이·가)는 명사 뒤에만 붙으므로 떼고 남은 것은 상품일 수 있다.
        const CUT_STEM = ["하","되","있","없","오","가","보","주","한","할","인","된","같","싶","나","드","쓰","서"];
        const CUT_JUNK = kwRaw !== kw && kw.length === 1 && CUT_STEM.includes(kw);
    // 수량·단위만 남은 말은 상품이 아니다 — "1박스" 가 '햇 나주배 5kg 1박스' 를 물어왔다.
    //   ⚠ '1+1' 은 실제 상품 표기라 통과한다(숫자+단위 꼴이 아니다).
    const UNITONLY = /^[0-9]+\s*(박스|개입|개|팩|봉지|봉|캔|병|장|롤|매|구|입|세트|kg|g|ml|리터|인분|단계)$/i.test(kw);
    const askable = kw.length >= 1 && !NUMONLY && !CUT_JUNK && !UNITONLY && !(kw.length === 1 && STOP1.includes(kw)) && !STOPKW.includes(kw);

    // ② 날짜 질문 (AI 해석에서도 부르므로 닫힌 함수로 둔다)
    const closeCards = async () => {
      const rows = await pick(`end_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 마감인 공구가 없어요. 아래 버튼에서 전체 일정을 볼 수 있어요!")]);
      return reply([cards(`오늘(${today.slice(5)}) 마감 공구`, rows)]);
    };
    const tomorrowCards = async () => {
      const t = addDays(today, 1);
      const rows = await pick(`open_date=eq.${t}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("내일 오픈 예정 공구가 아직 등록되지 않았어요.")]);
      return reply([cards(`내일(${t.slice(5)}) 오픈 공구`, rows)]);
    };
    // 주말: 이번 주 토·일에 오픈하는 공구 (실제 손님이 "주말 공구" 라고 묻는다)
    const weekendCards = async () => {
      const d = kst(); const dow = d.getDay();
      const sat = new Date(d); sat.setDate(d.getDate() + ((6 - dow) + 7) % 7);
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
      const rows = await pick(`open_date=gte.${ymd(sat)}&open_date=lte.${ymd(sun)}`, "order=open_date.asc", ph);
      if (!rows.length) return reply([text("이번 주말에 오픈하는 공구가 아직 없어요.\n아래 버튼에서 이번 주 일정을 볼 수 있어요!")]);
      return reply([cards("이번 주말 오픈 공구", rows)]);
    };
    const weekCards = async (): Promise<Response | null> => {
      const rows = await pick(`open_date=gte.${today}&open_date=lte.${addDays(today, 6)}`, "order=open_date.asc", ph);
      if (rows.length) return reply([cards("이번 주 오픈 공구", rows)]);
      return null;
    };

    // ① 브랜드·상품 검색 본체 — 찾으면 답(Response), 못 찾으면 null (AI 해석 뒤 같은 함수로 다시 찾는다)
    const searchReply = async (kw: string, kwRaw: string, say: string, noAbbr = false): Promise<Response | null> => {
      const AL = await aliases();
      let tries = kwRaw && kwRaw !== kw ? [kwRaw, kw] : [kw];
      // 별칭은 두 번 푼다 — 줄임말 → 정식이름 → 표기변형 (사장님 지시 2026-09-02)
      //   "넘블은 넘버블럭스 넘버블록스 다 똑같은말이야 줄임말"
      //   한 번만 풀면 넘블 → 넘버블록스 에서 멈춰 넘버블럭스 표기 상품을 못 찾는다.
      const expand = (src: string[]) => {
        const out: string[] = [];
        for (const t of src) for (const [a, b] of AL) {
          if (t.includes(a)) out.push(t.split(a).join(b));
          if (t.includes(b)) out.push(t.split(b).join(a));
        }
        return out;
      };
      const p1 = expand(tries.slice());
      tries.push(...p1);
      // 손님이 말한 그대로 + 별칭 1단계 (대표 낱말로 넓히기 **전**의 목록) — 핫딜 우선 판단에 쓴다
      //   ⚠ 2단계 확장은 여기 넣지 않는다 — 넓어져서 공구를 찾기도 전에 핫딜이 먼저 나간다(실측).
      // 🔴 조사 '이'를 떼는 규칙은 걷어냈다 (사장님 지시 2026-09-06: "단어 끝에 '이'자 맘대로 빼는 규칙은 절대 안돼")
      //   09-02~09-05 나흘간 이 자리를 여섯 번 고쳤다 — 규칙으로는 '국이'(조사)와 '종이'(낱말)를 가를 수 없다.
      //   말귀는 AI 해석 + 학습 사전이 맡는다 (scratchpad/챗봇AI도입_계획.md). 여기에 조사 규칙을 다시 넣지 말 것.
      //   ⚠ 「국이 있어?」는 AI 가 붙기 전까지 "없어요" 다 — 최근 30일 실손님 발화에 그 형태 0건.
      const specific = [...new Set(tries)];
      tries.push(...expand(p1));   // 2단계(표기변형)는 넓히기용
      // 수식어는 **사전으로** 뗀다 — 깎는 게 아니다 (사장님 지시 2026-09-02)
      //   "아기물티슈" → '물티슈' 는 정당하지만 "알테리" → '테리' 는 브랜드를 죽인다.
      //   차이는 **아는 말만 떼느냐** 다. 사전에 없는 글자는 절대 건드리지 않는다.
      //   ⚠ 넓히기 단계에만 넣는다 — 정확검색에 넣으면 '아기상어' 공구에 '상어' 가 섞인다.
      const MODIFIERS = ["신생아", "어린이", "우리아이", "유아용", "아기", "유아", "아이", "키즈", "엄마"];
      for (const t of [...new Set(tries)]) {
        for (const m of MODIFIERS) {
          if (t.startsWith(m) && t.length > m.length + 1) { tries.push(t.slice(m.length).trim()); break; }
        }
      }
      // 별칭이 여러 낱말이면 대표 낱말로도 찾는다 — 뽀사카→"뽀로로 사운드" 가 0건이던 것 (2026-09-01)
      //   그 조합의 공구가 없어도 손님이 원하는 건 그 브랜드다.
      for (const t of tries.slice(1)) {   // ⚠ 0번(손님 말 원본)은 제외 — 넣으면 첫 낱말로만 검색된다
        const parts = t.split(/\s+/).filter((w) => w.length >= 2);
        // 손님 말이 원래 한 낱말일 때만 (뽀사카→"뽀로로 사운드"→뽀로로).
        //   원래 두 낱말이면 적용하면 안 된다 — '신생아 기저귀' 이 '신생아' 로만 검색된다(실사고)
        if (parts.length >= 2 && kw.split(/\s+/).filter((w) => w.length >= 2).length < 2) tries.push(parts[0]);
      }
      // 줄임말(글자 사이 열기)은 **한글일 때만**. 영문에 쓰면 성긴 패턴이 아무 문장에나 걸린다.
      //   실사고 2026-09-02: 'Keen' → %k%e%e%n% → "Scholastic Picture Book Garden Collection"
      const hangulOnly = /^[가-힣]+$/.test(kw);
      //   🔴 AI 가 뽑은 낱말(noAbbr)엔 안 연다 — 「즈크루」가 %즈%크%루% 로 디즈니 크루즈를 물어와 사전에 정답처럼 굳었다(2026-09-06 검증)
      if (!noAbbr && hangulOnly && kw.length >= 3 && kw.length <= 5) tries.push("__ABBR__" + kw);

      // 🔴 검색 순서 (사장님 지시 2026-09-01)
      //   ① 손님이 말한 그대로·별칭 그대로 공구를 찾는다 (뽀사카 → "뽀로로 사운드")
      //   ② 없으면 **핫딜을 먼저 본다** — "공구는 없는데 오늘 공구 가격에 핫딜이 떴다" 가 손님에게 진짜 답이다
      //   ③ 그래도 없으면 대표 낱말로 넓힌다 (뽀로로 → 뮤직하우스·카메라…)
      //   ⚠ ②를 ③보다 뒤에 두면 안 된다 — 뽀사카를 물었는데 뽀로로 여행패키지가 나간다(실측 2026-09-01)
      const searchGonggu = async (list: string[]) => {
        // 표기가 달라도 같은 말이면 결과가 같아야 한다 → 후보를 전부 돌며 합친다 (중복 id 제거)
        const merged: any[] = []; const mseen = new Set<number>();
        // ⏱ 카카오는 늦으면 "폴백 스킬 오류" 를 낸다 → 1.8초 넘으면 지금까지 찾은 것으로 답한다
        const t0 = Date.now();
        for (const t of [...new Set(list)].slice(0, 8)) {   // 후보 상한 8개
          // 낱말이 둘 이상이면 낱말마다 ilike 를 AND 로 건다 (통째 매칭은 절대 안 걸린다)
          // 🔑 한 글자도 넣는다 — 빼면 "쌀 보관함" 이 '보관함' 만 검색돼 장난감 보관함이 나간다.
          //    낱말끼리는 AND 라 조건이 늘수록 좁아진다(느슨해지지 않는다).
          //    뜻 없는 한 글자(거·것·게…)만 STOP1 으로 뺀다.
          const WORD1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
          const ws = t.startsWith("__ABBR__") ? []
            : t.split(/\s+/).filter((w) => w.length >= 2 || (w.length === 1 && !WORD1.includes(w)));
          let cond: string;
          if (ws.length >= 2) {
            cond = ws.map((w) => {
              const e = encodeURIComponent("%" + w + "%");
              return `name.ilike.${e}`;
            }).join(",");
            cond = `end_date=gte.${today}&and=(${cond})`;
          } else {
            const base = ws.length === 1 ? ws[0] : t;   // 짧은 낱말이 떨어져 나가면 남은 낱말로 찾는다
            const pat = t.startsWith("__ABBR__") ? "%" + t.slice(8).split("").join("%") + "%" : `%${base}%`;
            const enc = encodeURIComponent(pat);
            // 🔴 검색은 **상품명만** 본다 (사장님 지시 2026-09-05).
            //   실사고: 「포도」 에 셀러 '포도네'(podomami) 의 흉터스틱·잇니플러스가 나갔다.
            //   셀러명·핸들을 보면 손님이 안 찾은 상품이 섞인다.
            cond = `end_date=gte.${today}&name=ilike.${enc}`;
          }
          let rows = await pick(cond, "order=open_date.asc", ph);
          // 🔴 **DB 에 아예 없는 낱말은 조건에서 뺀다** (사장님 승인 2026-09-04)
          //   실사고: "루솔 도라지배즙" 은 '루솔' 9건이 진행중인데 '도라지배즙' 이
          //   상품명 어디에도 없어 AND 가 통째로 0건이 됐다. 손님은 그냥 떠났다.
          //   ⚠ **낱말이 전부 DB 에 있으면 그대로 0건을 유지한다** —
          //     "쌀 보관함"(쌀·보관함 둘 다 있다)이 장난감 보관함을 물어오던 사고를 막는 선이 이것이다.
          //     사장님: "쌀보관함은 없으면 없는거니까 없다고 해야지"
          //   ⚠ AND 결과가 0건일 때만 돈다 → 평소 회차엔 조회 비용이 0이다.
          // ⚠ **손님이 친 말일 때만** 뺀다 (2026-09-04 실사고).
          //    별칭 확장판("휴대용 물팃")에 적용하면 우리가 만든 낱말이 빠지면서
          //    '휴대용' 만 남아 바브레 휴대용 변기가 나갔다 — 쌀보관함과 같은 유형이다.
          const ownWords = (t === kw || t === kwRaw);
          if (ownWords && !rows.length && ws.length >= 2 && ws.length <= 4 && Date.now() - t0 < 1200) {
            const keep: string[] = [];
            for (const w of ws) if (await hasWord(w, today)) keep.push(w);
            if (keep.length && keep.length < ws.length) {
              const c2 = keep.map((w) => {
                const e2 = encodeURIComponent("%" + w + "%");
                return `name.ilike.${e2}`;
              }).join(",");
              rows = await pick(`end_date=gte.${today}&and=(${c2})`, "order=open_date.asc", ph);
            }
          }
          // ⚠ 여기 있던 "낱말 하나씩이라도 찾는다" 는 주석은 사실과 달라 지웠다 (2026-09-04 검증).
          //   그 기능은 아래 502행에서 걷어냈다. 넓혀야 하는 말은 bot_alias 로 관리한다
          //   ("이유식 스푼 → 이유식기" 는 별칭 17개로 이미 들어가 있다).
          for (const r of rows) { if (!mseen.has(r.id)) { mseen.add(r.id); merged.push(r); } }
          if (merged.length >= MAX_SHOW) break;
          if (Date.now() - t0 > 1800) break;   // 시간 초과 — 늦은 답보다 지금 답이 낫다
        }
        // 🔴 여기 있던 "낱말 하나씩 OR 검색" 을 걷어냈다 (사장님 지시 2026-09-02).
        //    "쌀 보관함" 에 낱말 '보관함' 만 걸려 **아오라 장난감 보관함**이 나갔다.
        //    사장님: "없으면 없는거니까 없다고 해야지 장난감보관함을 보여주면 어케"
        //    → 없는 것은 없다고 한다. 넓혀야 하는 말은 **bot_alias** 로 관리한다
        //      ("이유식 스푼 → 이유식기" 는 이미 별칭 17개로 들어가 있다. 배포도 필요 없다).
        // 낱말을 다 만족하는 게 없어도 **손님 말에 브랜드가 들어 있으면** 그 브랜드를 보여준다.
        //   사장님 지적(2026-09-04): "프레벨롱은 명확히 있는 거고 룩트도 명확한 브랜드가 있는건데
        //   쌀보관함이랑 니가 다르게 판단해야지"
        //   ⚠ 품목 낱말로는 절대 폴백하지 않는다 — '쌀 보관함' 에 장난감 보관함이 나간 사고 그대로다.
        if (!merged.length) {
          const raw = [...new Set(list)].find((x) => !x.startsWith("__ABBR__")) || "";
          const cand = raw.split(" ").filter((w) => w.length >= 2).slice(0, 3);
          // 🔴 브랜드가 분명한 낱말(상품명 맨 앞에 온 적 있음, 기간 무관)이 있는데 지금 공구가 0이면 → 다른 낱말로 넓히지 않는다.
          //   사장님(2026-09-07): 「하베브릭스 장난감」에 리틀홈헬퍼·아오라 장난감이 나갔다 → "없다고 하는 게 낫다".
          //   (아래 notFound 가 '지난번엔 하베브릭스 모래놀이' 까지 알려준다)
          let closedBrand = false;
          if (cand.length >= 2 && Date.now() - t0 < 1200) {
            for (const w of cand) {
              const e = encodeURIComponent(w + "%");
              const everHead = await countOf(`gonggu?select=id&approved=eq.true&name=ilike.${e}&limit=1`);
              if (everHead > 0 && (await countOf(`gonggu?select=id&approved=eq.true&name=ilike.${e}&end_date=gte.${today}&limit=1`)) === 0) { closedBrand = true; break; }
            }
          }
          if (!closedBrand && cand.length >= 2 && Date.now() - t0 < 1200) {
            const scored: { w: string; ratio: number; all: number }[] = [];
            for (const w of cand) {
              if (Date.now() - t0 > 1500) break;
              const sc = await brandScore(w, today);
              // 브랜드 판정: 맨 앞에 한 번이라도 오고, 그 비율이 절반 이상
              if (sc.head >= 1 && sc.ratio >= 0.5) scored.push({ w, ratio: sc.ratio, all: sc.all });
            }
            // 브랜드가 여럿이면 더 뚜렷한 쪽(맨앞비율 높고, 그다음 더 특정적인 쪽)
            scored.sort((a, b) => (b.ratio - a.ratio) || (a.all - b.all));
            for (const { w } of scored) {
              if (Date.now() - t0 > 1700) break;
              const e = encodeURIComponent("%" + w + "%");
              const r2 = await pick(`end_date=gte.${today}&name=ilike.${e}`, "order=open_date.asc", ph);
              for (const r of r2) { if (!mseen.has(r.id)) { mseen.add(r.id); merged.push(r); } }
              if (merged.length >= MAX_SHOW) break;
            }
          }
        }
        if (!merged.length) return null;
        // 손님이 친 낱말이 **상품명**에 있는 것을 먼저 보여준다.
        //   실사고 2026-09-02: '우유' 를 물었는데 셀러 '우유맘' 의 리프팅크림이 1번으로 나갔다.
        //   ⚠ 2026-09-05: 검색이 상품명만 보게 되어 셀러명은 애초에 집합에 안 들어온다.
        //      "우유맘 공구 알려줘" 는 이제 0건이다 — 사장님 지시("셀러명은 무조건 빼야하고"). 되돌리지 말 것.
        const qw = ([...new Set(list)].find((x) => !x.startsWith("__ABBR__")) || "")
          .split(" ").filter((w) => w.length >= 2).map((w) => norm(w));
        // 손님 낱말을 **몇 개나 맞췄는지**로 센다. 낱말이 통째로 있으면 2점,
        //   앞부분만 겹쳐도 1점('사운드북' ↔ '사운드카드'). 브랜드 폴백에서 순서를 가른다.
        //   실사고 2026-09-04: '뽀로로 사운드북' 1번이 "경주 켄싱턴+뽀로로 PKG 특가" 였다.
        const wordScore = (g: any) => {
          const nm = norm(g.name); let sc = 0;
          for (const w of qw) {
            if (nm.includes(w)) { sc += 2; continue; }
            for (let L = w.length - 1; L >= 2; L--) { if (nm.includes(w.slice(0, L))) { sc += 1; break; } }
          }
          return sc;
        };
        // 맘캘린더·이웃셀러 공구는 무조건 맨 앞 (사장님 규칙) — 합치면서 섞이므로 다시 세운다
        merged.sort((a, b) =>
          ((a.__p ? 0 : 1) - (b.__p ? 0 : 1)) || (wordScore(b) - wordScore(a)));
        return merged.slice(0, MAX_SHOW);
      };

      const exact = await searchGonggu(specific.length ? specific : tries);
      if (exact) return reply([cards(`'${say}' 공구 일정`, exact)]);

      // ② 핫딜 — 공구가 없으면 **핫딜에 있는지 본다** (사장님 지시 2026-09-02)
      //   🔴 2026-09-02: 뽀사카 하드코딩을 걷어냈다 (사장님 지시 "핫딜에 있으면 있다고 알려줘").
      //   핫딜에 멀쩡히 있는데 "공구 없어요" 가 나가고 있었다 —
      //   해담옥(손님이 9번 물음)·삼다수·칠성사이다·일리윤·한예지 전부 그랬다.
      {
        // 별칭 푼 말까지 넣는다. 손님이 친 말 그대로가 먼저다.
        const hdWords = [...new Set([kwRaw, kw, ...specific])].filter((x) => x && !String(x).startsWith("__ABBR__"));
        const hdCard = await findHotdeal(hdWords, today);
        if (hdCard) return reply([hdCard]);
      }

      // ③ 대표 낱말까지 넓혀서 다시
      const wide = await searchGonggu(tries);
      if (wide) return reply([cards(`'${say}' 공구 일정`, wide)]);
      return null;
    };
    // 못 찾았을 때의 안내 (되묻기·지난 공구 포함)
    const notFound = async (say: string, kw: string): Promise<Response> => {
      // 못 찾은 검색어를 쌓는다 — 이걸 보고 bot_alias 와 위 말버릇 목록을 채운다 (학습 루프)
      // ⚠ 우리 로봇(bot_learn=BOTLEARN · bot_guard=BOTGUARD)이 되물은 것은 쌓지 않는다.
      //   2026-09-07 실측: 6시간 미스 1,724건 중 로봇 호출이 절반(1,630/3,264) — 학습기가 자기 되묻기를 다시 '못 찾은 말'로 세어
      //   "닥터포이가 있어? (54회)" 처럼 사장님께 가짜 횟수를 보고했다.
      //   우리 로봇 uid 는 전부 BOT+대문자(BOTLEARN·BOTGUARD·BOTPROBE·BOTWATCH) — 검증자 지적(2026-09-07): LE/GU 만 걸러
      //   탐침(BOTPROBE, 회차마다 ~20건)이 계속 쌓였다. 카카오 실제 user id 는 소문자·숫자라 BOT+대문자와 겹치지 않는다.
      const robot = /^BOT[A-Z]/.test(uid);
      try {
        if (!robot) fetch(`${SB}/rest/v1/events`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ event_type: "kakao_bot_miss", event_data: `${kw} <= ${u}`.slice(0, 70) }) });
      } catch (_) { /* 무시 */ }
      // 🔴 총 마감 — AI(≤2초) 뒤에 재검색까지 하면 여기 올 때 3초를 넘기도 한다(검증 실측 4.9초).
      //   카카오 5초를 지키려고 3초를 넘겼으면 되묻기·지난공구 조회(각 ~1초)를 건너뛰고 바로 답한다.
      const rushed = Date.now() - tReq > 3000;
      // 없다고만 하지 않고 "혹시 이거?" 로 되묻는다 (bot_guess RPC — 오타·긴말 대응, 2026-09-01)
      let hint = "";
      if (!rushed) try {
        const g = await fetch(`${SB}/rest/v1/rpc/bot_guess`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_kw: kw }) });
        const gw = ((await g.json()) as any[]).map((x) => x.word).filter(Boolean).slice(0, 3);
        if (gw.length) hint = `

혹시 ${gw.map((w) => `'${w}'`).join(" · ")} 찾으셨을까요? 그대로 한번 보내보세요!`;
      } catch (_) { /* 되묻기 실패해도 안내는 나간다 */ }
      // 진행 중이 없어도 **다룬 적이 있으면** 그렇게 말한다 (2026-09-02)
      //   "선풍기" 는 DB 에 44건 있는데 전부 마감이라 손님에겐 "없어요" 만 나갔다.
      //   사이트는 이미 지난 공구를 보여준다(showPastResults) — 챗봇만 빠져 있었다.
      //   ⚠ 카드로 주지 않는다. 마감된 것을 눌러 들어가면 헛걸음이 된다 → 이름·날짜만 글로.
      try {
        // 🔴 손님 말로 먼저 찾는다. kw(깎은 말)로 찾으면 닥터포 → **닥터포헤어** 가 된다.
        //   손님 말로 0건이면 깎은 말로 한 번 더 — 단 **낱말로 서 있을 때만**("선풍기가" → 선풍기).
        const pastBy = async (w: string) => await q(
          `gonggu?select=name,influencer,open_date&approved=eq.true&name=ilike.${encodeURIComponent("%" + w + "%")}`
          + `&end_date=lt.${today}&order=open_date.desc&limit=3`);
        // 🔴 낱말 경계에서 걸린 것만 보여준다 — 안 그러면 '쌀이' 가 **좁쌀이불** 을 물어온다.
        //   토큰이 그 말로 시작하거나 끝나야 한다: 무선선풍기(끝) ✅ · 실리만(전체) ✅ · 좁쌀이불(중간) 🚫
        const okTok = (nm: string, w: string) =>
          String(nm || "").split(" ").some((t) => t.startsWith(w) || t.endsWith(w));
        const pick3 = (rows: any, w: string) =>
          Array.isArray(rows) ? rows.filter((p: any) => okTok(p.name, w)) : [];
        let past = rushed ? [] : pick3(await pastBy(say), say);
        // 손님 말로 못 찾으면 조사를 뗀 말로 한 번 더 ("선풍기가" → 선풍기)
        if (!rushed && !past.length && kw && kw !== say && kw.length >= 2) past = pick3(await pastBy(kw), kw);
        if (Array.isArray(past) && past.length) {
          const li = past.map((p: any) => {
            const d = String(p.open_date || "").slice(5).replace("-", "/");
            return `· ${p.name}${p.influencer ? " — " + p.influencer : ""}${d ? " (" + d + ")" : ""}`;
          }).join("\n");
          return reply([text(`'${say}' 공구는 지금 진행 중인 게 없어요.\n\n지난번에는 이런 게 있었어요\n${li}\n\n다시 열리면 맘캘린더에 바로 올라와요!`)]);
        }
      } catch (_) { /* 실패해도 아래 기본 안내가 나간다 */ }
      return reply([text(`'${say}' 공구는 지금 진행 중이거나 예정인 게 없어요.
아래 버튼으로 전체 일정에서 찾아보실 수 있어요!${hint}`)]);

    };

    // 🧠 해석 결과(사전·AI) → 기존 답변 경로로 보낸다. 답이 없으면 null.
    const routeIntent = async (it: Interp, ruleDone = true): Promise<Response | null> => {
      // 🔴 상품이 있으면 핫딜 안내가 아니라 검색이다 (2026-09-06 「기저귀 싸게 파는데 없나」가 핫딜로 분류돼 카드를 못 줬다)
      if (it.intent === "hotdeal" && String(it.q || "").trim()) it = { ...it, intent: "search" };
      switch (it.intent) {
        case "search": {
          const qq = String(it.q || "").trim();
          if (!qq) return null;
          if (ruleDone && askable && qq === kw) return null;   // 규칙이 이미 그 말로 찾아봤다
          return await searchReply(qq, qq, qq, true);   // AI 낱말은 이미 깨끗하다 — 줄임말 열기 금지
        }
        case "today": return await todayCards();
        case "tomorrow": return await tomorrowCards();
        case "week": return (await weekCards()) ?? (await todayCards());
        case "weekend": return await weekendCards();
        case "closing": return await closeCards();
        case "popular": return await topCards();
        case "hotdeal": return reply([text("핫딜은 아직 챗봇에서는 안 알려드려요 🙏\n맘캘린더 사이트 '🔥 핫딜' 탭에서 오늘 올라온 특가를 모아 보실 수 있어요!")]);
        case "greeting": case "thanks": {
          // AI 가 모르는 브랜드를 인사로 오해한다 — 이치비야·뮤이·도들 에 도움말이 나갔다(실손님). 상품명에 그 말이 있으면 검색이다.
          if (kw.length >= 2 && (await countOf(`gonggu?select=id&name=ilike.${encodeURIComponent("%" + kw + "%")}`)) > 0) {
            return await searchReply(kw, kw, kw, true);
          }
          return reply([text(it.intent === "greeting" ? HELP : ANS.thanks)]);
        }
        default: return null;
      }
    };

    // ⓪' 핫딜·특가 + 상품 낱말 → 공구 카드 → (없으면) 핫딜 카드 → (그래도 없으면) 안내. searchReply 정의 뒤라 여기서 처리한다.
    if (hdAsk) { const r = await searchReply(hdWord, hdWord, hdWord); return r ?? reply([text(HD_GUIDE)]); }
    if (wantAny) return await todayCards();   // 「아무거나」= 오늘 공구 (사장님 확정 2026-09-07)
    // 🧠 ① 해석 사전 — 이 말을 전에 풀어둔 적 있으면 그대로 답한다 (0원)
    const learned = await interpLookup(u);
    let hitPending = false;   // 사전 해석이 "규칙이 같은 말로 찾을 차례" 라 null 을 준 경우 — 규칙 결과를 보고 ok_cards 를 찍는다
    if (learned) {
      const r = await routeIntent(learned);
      if (r) { interpHit(u, true); return r; }
      // ⚠ 여기서 바로 interpHit(u,false) 를 찍으면 규칙이 카드를 찾아도 ok_cards=false 로 남아
      //   "hits 많고 ok_cards=false → 재해석 후보" 통계가 오염된다 (f9 세션 검증 지적 2026-09-06)
      hitPending = true;
    }
    if (wantTop) { const r = await topCards(); if (r) return r; }
    // 🧠 ③-a 문장형은 규칙보다 AI 먼저 (2026-09-06 실측: 「이번 주말에 오픈하는 거 알려줘」를 규칙이 '말에 하는 거' 로 잘라
    //    "말하는 인형" 카드를 내놓았고, 규칙이 카드를 찾았으니 AI 는 불리지도 않았다).
    //    낱말 3개 이상이거나 12자 이상이면 문장으로 본다. 짧은 브랜드·품목은 그대로 규칙 먼저(0원).
    //    AI 가 못 하면(키 없음·2.5초 초과) 아래 규칙으로 그대로 내려간다.
    const sentenceLike = u.trim().split(/\s+/).length >= 3 || u.trim().length >= 12;
    let ai: Interp | null = null;
    // 규칙 검색은 AI 와 **동시에** 시작한다 — AI 가 마감을 넘기면 이미 끝난 규칙 답을 바로 내보낸다(답장 시간 단축, 2026-09-08)
    const ruleP: Promise<Response | null> = askable ? searchReply(kw, kwRaw, say).catch(() => null) : Promise.resolve(null);
    if (!learned && sentenceLike) {
      ai = await withDeadline(interpAI(u, tReq), AI_DEADLINE_MS, u);
      // ⚠ ruleDone=false — 규칙이 아직 안 돌았으니 "규칙이 이미 찾아봤다" 건너뛰기를 하면 안 된다
      //   (2026-09-06 실측: 「물티슈 공구 궁금해요!」가 그 건너뛰기에 걸려 '없어요' 로 나갔다)
      if (ai) { const r = await routeIntent(ai, false); if (r) return r; }
    }
    // ② 규칙 검색 (손님이 친 말 그대로 + 별칭) — 위에서 이미 돌고 있다
    if (askable) { const r = await ruleP; if (r) { if (hitPending) interpHit(u, true); return r; } }
    if (hitPending) interpHit(u, false);
    // 🧠 ③-b 규칙이 못 찾았다 → AI 해석(키 없으면 건너뜀) → 사전 저장 → 그 해석으로 다시 찾는다
    //    ⚠ kw 가 빈 발화(말버릇만 남은 「오늘 핫한 공구머있어」)는 AI 를 안 태운다 — 원칙 ①대로 오늘 공구다 (f9 검증 지적)
    if (!learned && !sentenceLike && kw.length >= 1) {
      ai = await withDeadline(interpAI(u, tReq), Math.max(400, Math.min(AI_DEADLINE_MS, 3600 - (Date.now() - tReq))), u);
      if (ai) { const r = await routeIntent(ai, true); if (r) return r; }
    }
    // AI 가 "이걸 찾는다" 고 했는데 어디에도 없다 → 그 낱말로 없어요 안내 (문장 통째가 아니라)
    const itp = ai ?? learned;   // 2회째(사전)도 1회째(AI)와 같은 낱말로 없어요 안내 (검증 지적)
    if (itp && itp.intent === "search" && itp.q) return await notFound(itp.q, itp.q);
    if (askable) return await notFound(say, kw);

    // ②' 날짜 질문 (브랜드가 없을 때)
    if (wantClose) return await closeCards();
    if (wantTomorrow) return await tomorrowCards();
    if (wantWeekend) return await weekendCards();
    if (wantWeek) { const r = await weekCards(); if (r) return r; }
    // ③ 말버릇만 남은 질문("오늘 핫한 공구머있어") = 오늘 공구
    return await todayCards();
  } catch (_) {
    return reply([text("일시적으로 조회가 안 되고 있어요. 잠시 뒤 다시 물어봐 주세요!")]);
  }
}
Deno.serve(async (req) => {
  const res = await handle(req);
  const line = REPLY_LOG.get(res);
  if (line) {
    try {
      fetch(`${SB}/rest/v1/events`, { method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ event_type: "kakao_bot", event_data: line }) }).catch(() => {});
    } catch (_) { /* 기록 실패는 무시 */ }
  }
  return res;
});

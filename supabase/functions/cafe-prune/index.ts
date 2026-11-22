// ═════════════════════════════════════════════════
//  cafe-prune  —  카페에서 지운 글을 커뮤니티 탭(community_posts)에서도 뺀다 (사장님 2026-11-07 「재검 삼검 교차검증, 없어진 글만 그대로 빼」)
//
//  왜 따로 두나  cafe-feed 는 목록을 받아 덮어쓰기만 해서 카페에서 지워진 글이 30일간 남았다(스팸 글 44088 도 손으로 지웠다).
//
//  지우는 기준(전부 맞아야 한다 — 하나라도 어긋나면 그 글은 그대로 둔다)
//   ① 글 하나하나를 카페 글 조회 API(cafe-articleapi v2.1)로 직접 확인한다. errorCode "4003"(삭제되었거나 존재하지 않는 게시글) 만 「없음」이다.
//      "0004"(로그인 필요) = 회원 전용 글이라 살아 있다 · 그 밖의 오류·시간초과·모양이 다른 응답 = 판단 보류(세지 않는다).
//   ② 「없음」을 25분 이상 간격으로 3번 연속 봐야 한다(pg_cron 30분 간격 → 최소 약 1시간). 중간에 한 번이라도 살아 있으면 횟수가 0 으로 돌아간다.
//   ③ 3번째 때 카페 게시판 목록(cafe-boardlist-api)을 글이 쓰인 시각까지 거슬러 읽어, 목록에 그 글이 있으면 반증으로 보고 되돌린다.
//      목록이 글 시각까지 닿지 못하면(너무 오래된 글) 의심 6번(약 2시간 30분)까지 기다린다.
//   ④ 카나리아: 매 회차 시작에 (a) 지금 목록 맨 위 글 2개가 「살아 있음」으로 나오고 (b) 있을 수 없는 글 번호가 「없음」으로 나와야 한다.
//      아니면 카페 응답 모양이 바뀐 것이니 이번 회차는 아무것도 쓰지 않는다.
//   ⑤ 한 회차에 새로 「없음」이 된 글이 max(8, 확인한 수의 15%) 를 넘으면 통째로 이상한 것으로 보고 아무것도 쓰지 않는다. 한 회차 삭제 상한 10건.
//   ⑥ DB 함수(cafe_prune_apply)가 의심 3번 이상·마지막 의심 6시간 안인 글만 받아 보관표(community_posts_removed)로 복사한 뒤 지운다(되살리기 가능).
//
//  확인 순서(회차당 요청 약 450개 이하): 의심 중인 글 → 24시간 안 글(4시간마다) → 1~3일 글(하루 한 번) → 3일 이상 글(5일에 한 번)
//  호출  POST /functions/v1/cafe-prune   헤더 x-cron-secret   ?dry=1 이면 아무것도 쓰지 않고 결과만(시험용)
//  주기  pg_cron `cafe-prune` 30분마다 — supabase/sql/cafe_prune_139.sql
// ═════════════════════════════════════════════════
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const CLUB = 31499187;
const ART = (id: number) => `https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/${CLUB}/articles/${id}?useCafeId=true&requestFrom=A`;
const LIST = (menuid: number, page: number, per: number) =>
  `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${CLUB}/menus/${menuid}/articles?page=${page}&pageSize=${per}&sortBy=TIME&viewType=L`;
const H = { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}` };
const BUDGET_MS = 110_000;
const MAX_DELETE = 10;
const MIN_GAP_MIN = 25;

type Verdict = "ok" | "login" | "gone" | "unknown";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H1 = 3600_000, D1 = 86400_000;

async function check(id: number): Promise<Verdict> {
  try {
    const r = await fetch(ART(id), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    const j = JSON.parse(await r.text());
    const res = j?.result;
    if (!res || typeof res !== "object") return "unknown";
    const code = String(res.errorCode ?? "");
    if (code === "4003" && /삭제되었거나 존재하지 않는/.test(String(res.reason || res.message || ""))) return "gone";
    if (code === "0004") return "login";
    if (code) return "unknown";
    if (res.article && Number(res.article.id) === id) return "ok";
    return "unknown";
  } catch { return "unknown"; }
}

async function sbGet(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path.slice(0, 60)} ${r.status}`);
  return await r.json();
}
async function rpc(name: string, body: unknown): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`rpc ${name} ${r.status} ${(await r.text()).slice(0, 100)}`);
  return await r.json().catch(() => null);
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>, deadline: number): Promise<Map<T, R>> {
  const out = new Map<T, R>(); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length && Date.now() < deadline) { const x = items[i++]; out.set(x, await fn(x)); await sleep(120); }
  }));
  return out;
}

// 카페 게시판 목록을 글 시각까지 거슬러 읽어 글 번호 집합과 「어디까지 읽었나」를 돌려준다
async function boardIds(menuid: number, needBack: number): Promise<{ ids: Set<number>; reachedMs: number; ok: boolean }> {
  const ids = new Set<number>(); let reached = Date.now(); let ok = true;
  for (let page = 1; page <= 12; page++) {
    try {
      const r = await fetch(LIST(menuid, page, 50), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) { ok = false; break; }
      const arr = ((await r.json())?.result?.articleList || []).map((x: any) => x?.item).filter(Boolean);
      if (!arr.length) { if (page === 1) ok = false; break; }   // 첫 쪽이 비면 응답 모양이 바뀐 것 → 목록을 못 읽은 것으로 본다(반증 불가 = 지우지 않는다)
      for (const a of arr) { const t = Number(a.writeDateTimestamp || 0); if (a.articleId) ids.add(Number(a.articleId)); if (t && t < reached) reached = t; }
      if (reached < needBack) break;
    } catch { ok = false; break; }
    await sleep(120);
  }
  return { ids, reachedMs: reached, ok };
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const t0 = Date.now(), deadline = t0 + BUDGET_MS;
  const out: Record<string, unknown> = { dry };
  const done = (o: Record<string, unknown>) => new Response(JSON.stringify({ ...out, ...o, ms: Date.now() - t0 }), { headers: { "Content-Type": "application/json" } });
  try {
    // ④ 카나리아
    const top = await (await fetch(LIST(14, 1, 5), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) })).json().catch(() => null);
    const topIds: number[] = (top?.result?.articleList || []).map((x: any) => Number(x?.item?.articleId)).filter(Boolean).slice(0, 2);
    if (topIds.length < 2) return done({ aborted: "canary: 목록을 못 읽음" });
    const alive = await Promise.all(topIds.map(check));
    const dead = await check(99999999);
    out.canary = { alive, dead };
    if (!alive.every((v) => v === "ok" || v === "login") || dead !== "gone") return done({ aborted: "canary: 카페 응답이 예상과 다름" });

    // 확인 대상 고르기
    const cols = "article_id,board_id,posted_at,gone_strikes,gone_last_at,checked_at";
    const qs = [
      `community_posts?select=${cols}&gone_strikes=gt.0&gone_last_at=lt.${iso(MIN_GAP_MIN * 60_000)}&limit=100`,
      `community_posts?select=${cols}&posted_at=gte.${iso(D1)}&or=(checked_at.is.null,checked_at.lt.${iso(4 * H1)})&order=checked_at.asc.nullsfirst&limit=200`,
      `community_posts?select=${cols}&posted_at=lt.${iso(D1)}&posted_at=gte.${iso(3 * D1)}&or=(checked_at.is.null,checked_at.lt.${iso(D1)})&order=checked_at.asc.nullsfirst&limit=80`,
      `community_posts?select=${cols}&posted_at=lt.${iso(3 * D1)}&or=(checked_at.is.null,checked_at.lt.${iso(5 * D1)})&order=checked_at.asc.nullsfirst&limit=120`,
    ];
    const rows = new Map<number, any>();
    for (const q of qs) for (const r of await sbGet(q)) rows.set(Number(r.article_id), r);
    const targets = [...rows.keys()];
    const res = await pool(targets, 5, check, deadline);
    const seen: number[] = [], gone: number[] = [], unknown: number[] = [];
    // 의심 중인 글이 이번에 판단 보류(unknown)면 연속이 끊긴 것이므로 의심을 0 으로 되돌린다(연속 3번만 인정)
    for (const [id, v] of res) (v === "gone" ? gone : v === "unknown" && !(rows.get(id)?.gone_strikes > 0) ? unknown : seen).push(id);
    const newGone = gone.filter((id) => !(rows.get(id)?.gone_strikes > 0));
    out.checked = res.size; out.targets = targets.length; out.alive = seen.length; out.gone = gone.length; out.unknown = unknown.length; out.newGone = newGone.length;

    // ⑤ 통째로 이상하면 아무것도 쓰지 않는다
    if (newGone.length > Math.max(8, Math.ceil(res.size * 0.15))) return done({ aborted: "새로 없음이 너무 많음", sample: newGone.slice(0, 5) });
    if (dry) return done({ sampleGone: gone.slice(0, 10), pendingNow: [...rows.values()].filter((r) => r.gone_strikes > 0).length });

    await rpc("cafe_prune_mark", { p_seen: seen, p_gone: gone });

    // 3번 이상 의심된 글 → ③ 목록 반증 확인 → 빼기
    const pend = await sbGet(`community_posts?select=article_id,board_id,posted_at,gone_strikes&gone_strikes=gte.3&gone_last_at=gte.${iso(6 * H1)}&limit=40`);
    const oldest = new Map<number, number>();                            // 게시판별 가장 오래된 의심 글 시각 → 거기까지 목록을 읽는다
    for (const p of pend) { const b = Number(p.board_id), t = Date.parse(p.posted_at); oldest.set(b, Math.min(oldest.get(b) ?? Infinity, t)); }
    const lists = new Map<number, Awaited<ReturnType<typeof boardIds>>>();
    for (const [b, t] of oldest) lists.set(b, await boardIds(b, t - 60_000));
    const confirmed: number[] = [], reset: number[] = [], waiting: number[] = [];
    for (const p of pend) {
      const id = Number(p.article_id), bid = Number(p.board_id), pt = Date.parse(p.posted_at);
      const ls = lists.get(bid)!;
      if (!ls.ok) { waiting.push(id); continue; }                       // 목록을 못 읽으면 판단 보류
      if (ls.ids.has(id)) { reset.push(id); continue; }                  // 반증: 목록에 있다
      if (ls.reachedMs <= pt - 60_000 || Number(p.gone_strikes) >= 6) confirmed.push(id);   // 목록이 글 시각까지 닿았고 없다 / 닿지 못해도 6번 의심
      else waiting.push(id);
    }
    if (reset.length) await rpc("cafe_prune_reset", { p_ids: reset });
    let removed: number[] = [];
    if (confirmed.length) removed = (await rpc("cafe_prune_apply", { p_ids: confirmed.slice(0, MAX_DELETE), p_min: 3 })) || [];
    return done({ pending: pend.length, reset: reset.length, waiting: waiting.length, confirmed: confirmed.length, removed });
  } catch (e) {
    return done({ error: String(e).slice(0, 200) });
  }
});

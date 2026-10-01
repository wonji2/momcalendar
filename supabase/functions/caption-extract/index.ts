/**
 * 🧠 caption-extract — 인스타 캡션에서 **공구 여부와 상품명**을 읽는다 (Haiku 4.5)
 *
 * 사장님 지시 2026-10-01: *"공구팡팡처럼 실시간으로 깔끔하게 상품명만 뽑아서 가져와봐"*
 *
 * 왜 AI 인가 (실측):
 *   `ig_feed_to_table.mjs` 의 `normalizeName` 은 상품명이 **`brand_vocab.txt` 에 있는 브랜드로
 *   시작해야** 통과시킨다. 그래서 **새 브랜드는 영원히 못 들어온다** —
 *   하루 ~700건이 「상품명 불확실」로 버려지고, 그 안에 `360도 진공 밀폐 유리용기`·
 *   `JVR 슬라이드랙 2종`·`아이젠베르그 플라잉팬`·`직화불닭발, 알곱창, 간장찜닭` 이 다 있었다.
 *   규칙을 느슨하게 하면 2026-09-08 문장조각 12건 사고가 되돌아온다 → **캡션을 읽는 수밖에 없다.**
 *
 * 돈은 학습으로 쌓인다 (메모리 ai-spend-must-accumulate):
 *   · 같은 캡션은 두 번 묻지 않는다 — `caption_ai` 표에 sha 로 캐시한다.
 *   · 「공구 아님」도 배운 답이다 — 다시 묻지 않는다.
 *   · AI 가 뽑은 상품명의 첫 낱말은 나중에 `brand_vocab.txt` 로 들어간다 → **규칙이 스스로 좋아진다.**
 *
 * 🔑 날짜는 AI 가 **계산하지 않는다.** 셀러가 쓴 문자열("10/1 ~ 10/4")을 그대로 받아
 *    우리 normDate·월별 일수 검사에 넣는다 — 월 넘김·「~10/7일」을 AI 가 틀리는 길을 막는다.
 *
 * 호출: POST { items:[{id, insta, cap}], dry?:true }
 * 응답: { results:[{id, cap_sha, is_gonggu, product, date_text, note, cached}], usage, errors }
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.124.0";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.124.0/helpers/zod";

const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const ANON = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ANON;
const MODEL = Deno.env.get("CAPTION_AI_MODEL") || "claude-haiku-4-5";
const CAP_CHARS = 600;      // 상품명·날짜는 캡션 머리에 있다. 길게 보내면 돈만 든다
const PER_CALL = 8;         // 한 번에 8건 — 시스템 프롬프트 값을 나눠 쓴다
const MAX_ITEMS = 120;      // 한 요청 상한 (무인 회차가 폭주하지 않게)

const sha = async (s: string) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

// 🔑 프롬프트 — 오늘 실측한 결함을 그대로 막는다:
//    · 공구 여부를 **먼저** 묻는다 (훅 문장으로 시작하는 글이 많다)
//    · 상품명은 **캡션에 적힌 표기 그대로** — 우리 추출기는 브랜드로 잘라먹었다(「세이펜」·「베르베린」)
//    · 날짜는 **셀러가 쓴 문자열 그대로** — 계산 금지
const SYSTEM = [
  "너는 인스타 공동구매 게시물을 읽어 사이트에 올릴 정보를 뽑는다. 한국 육아·리빙·식품 공구 시장이다.",
  "",
  "각 게시물에 대해 판단하라.",
  "",
  "1) is_gonggu — 이 글이 **지금 또는 곧 파는 글**인가?",
  "   맞다: 공동구매·공구·오픈·예고·주문·링크 안내가 있고 **파는 물건이 있는** 글.",
  '         "공구"라는 낱말이 없어도 파는 글이면 맞다.',
  "   아니다: 후기·사용담만 있는 글, 레시피·일상, 마감·품절 안내, 체험단·협찬·광고 모집,",
  "           자기 프로필 링크 안내만 있는 글, 행사·진료·수강 일정.",
  "",
  "2) product — 파는 물건의 이름. **캡션에 적힌 표기 그대로** 쓴다.",
  "   · 브랜드 + 품목을 **둘 다** 넣는다. 브랜드만 쓰거나 품목만 쓰지 않는다.",
  "   · 판촉어는 뺀다: 최저가·특가·초특가·단독·앵콜·리오더·N차·역대급·무배·모음전·기획전·선착순·한정.",
  "   · 가격·날짜·시각·이모지·해시태그는 넣지 않는다.",
  "   · 20자 이내. 여러 품목이면 가장 앞에 나온 대표 품목 하나.",
  "   · 모르겠으면 빈 문자열.",
  "",
  "3) date_text — 공구 기간으로 **셀러가 적어 놓은 문자열을 그대로** 옮긴다.",
  '   예: "10/1 ~ 10/4", "9/30(화) 11시 오픈", "10월 2일부터".',
  "   🔴 **날짜를 계산하거나 연도를 붙이지 마라.** 적힌 그대로만. 없으면 빈 문자열.",
  "",
  "4) note — 공구가 아니라고 본 이유를 5자 이내로 (후기·레시피·마감·협찬·일상·프로필안내 등).",
  "   공구면 빈 문자열.",
  "",
  "보기:",
  '  "세이보카 3300 × 5세대 세이펜 세이톡 공구 10/1(수) 오픈"',
  '    → product="세이보카 3300 세이펜"  (「세이펜」만 쓰면 틀린 답이다)',
  '  "파이토좀 베르베린 공구 10/2~10/5"',
  '    → product="파이토좀 베르베린"  (「베르베린」만 쓰면 품목으로 잘린 것이다)',
  '  "아이언츄 철분제 2차 공구 10/2~10/6"',
  '    → product="아이언츄 철분제"  (「2차」는 판촉어)',
  '  "맛있는데 살도 빠지는 초간단 매콤 새우 파스타 레시피 바로 갈게요"',
  '    → is_gonggu=false, product="", note="레시피"',
].join("\n");

const Item = z.object({
  idx: z.number().describe("입력에 적힌 번호"),
  is_gonggu: z.boolean(),
  product: z.string(),
  date_text: z.string(),
  note: z.string(),
});
const Batch = z.object({ items: z.array(Item) });

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // 🔴🔴 2026-10-01 검증자 지적: 이 함수는 `verify_jwt:false` 로 배포됐고 핸들러에 인증이 **한 줄도 없었다.**
  //    헤더 하나 없이 POST 하면 200 이 떨어졌다 — **누구나 우리 Anthropic 돈을 쓸 수 있는 상태**였다.
  //    anon 키는 index.html 에 공개돼 있어 키 검사로는 못 막는다 → **별도 비밀 토큰**을 본다.
  //    토큰은 Supabase 시크릿 `CAPTION_AI_TOKEN` 에만 둔다(디스크·레포에 두지 않는다).
  //    🔑 토큰이 설정돼 있지 않으면 **함수를 아예 닫는다**(fail-closed) — 열어두는 쪽으로 기울지 않는다.
  const want = Deno.env.get("CAPTION_AI_TOKEN");
  if (!want) return json({ error: "CAPTION_AI_TOKEN 미설정 — 함수를 닫는다" }, 503);
  //    ⚠ `crypto.timingSafeEqual` 은 Deno 표준에 없다 — 부르면 런타임에서 터져 500 이 된다(더 나쁘다).
  //       길이를 먼저 보고, 같은 길이면 전체를 XOR 로 훑어 비교한다(조기 종료 없음).
  const got = req.headers.get("x-caption-token") || "";
  let diff = got.length === want.length ? 0 : 1;
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    diff |= (got.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  }
  if (diff !== 0) return json({ error: "unauthorized" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length) return json({ error: "items 가 비었다" }, 400);
  if (raw.length > MAX_ITEMS) return json({ error: `한 번에 ${MAX_ITEMS}건까지` }, 400);

  // ── 준비: 캡션 자르고 sha
  // 🔴 2026-10-01 실측: `slice()` 가 **이모지의 서로게이트 쌍을 반으로 잘라** 요청 본문이 깨졌다.
  //    3회 호출 중 1회가 400 으로 죽고 8건이 조용히 「판독못함」이 됐다. 캡션은 이모지로 가득하다.
  //    → 자른 뒤 **짝 없는 서로게이트를 걷어낸다.** (JSON.stringify 는 이걸 통과시킨다 — 서버가 거부한다)
  const cut = (s: string) => s.slice(0, CAP_CHARS).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  const items: { id: string; insta: string; cap: string; sha: string }[] = [];
  for (const it of raw) {
    const cap = cut(String(it?.cap || "")).trim();
    if (!cap) continue;
    items.push({ id: String(it?.id ?? items.length), insta: String(it?.insta || ""), cap, sha: await sha(cap) });
  }
  if (!items.length) return json({ error: "쓸 만한 캡션이 없다" }, 400);

  // ── ① 캐시 먼저 — 같은 캡션에 두 번 돈을 쓰지 않는다
  const out = new Map<string, any>();
  const shas = [...new Set(items.map((x) => x.sha))];
  try {
    for (let i = 0; i < shas.length; i += 50) {
      const q = `${SB}/rest/v1/caption_ai?select=cap_sha,is_gonggu,product,date_text,note&cap_sha=in.(${shas.slice(i, i + 50).join(",")})`;
      const r = await fetch(q, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
      if (!r.ok) break;
      for (const row of await r.json()) out.set(row.cap_sha, { ...row, cached: true });
    }
  } catch { /* 캐시 실패는 AI 로 가면 된다 */ }

  const todo = items.filter((x) => !out.has(x.sha));
  // 같은 캡션이 여러 건 들어온 경우 한 번만 묻는다
  const uniq = [...new Map(todo.map((x) => [x.sha, x])).values()];

  if (body?.dry) {
    return json({ dry: true, total: items.length, cached: items.length - todo.length,
      would_call: uniq.length, calls: Math.ceil(uniq.length / PER_CALL) });
  }

  // ── 🔴 일일 지출 상한 — 우리 회차가 폭주해도 돈이 새지 않게 (사장님 "최소 비용")
  //    상한은 Supabase 시크릿 CAPTION_AI_DAILY_USD 로 바꾼다. 기본 $0.50/일 (≈ $15/월 중 AI 몫)
  //    🔑 상한을 **넘었는지 모르는 상태로는 호출하지 않는다** — 조회가 실패하면 멈춘다(열어두지 않는다).
  const CAP_USD = +(Deno.env.get("CAPTION_AI_DAILY_USD") || "0.5");
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/caption_ai_spend`, {
      method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ days: 1 }),
    });
    if (!r.ok) return json({ error: `지출 조회 실패 ${r.status} — 상한을 모르는 채로는 호출하지 않는다` }, 503);
    const rows = await r.json();
    const today = (rows || [])[0]?.usd ?? 0;
    if (+today >= CAP_USD) {
      return json({ error: `오늘 AI 지출 $${today} ≥ 상한 $${CAP_USD} — 멈춘다`, spent_today: +today, cap: CAP_USD,
                    results: items.map((x) => ({ id: x.id, insta: x.insta, ...(out.get(x.sha) || { cap_sha: x.sha, is_gonggu: false, product: "", date_text: "", note: "상한초과", cached: false }) })) }, 429);
    }
  } catch (e) {
    return json({ error: `지출 조회 오류 ${String((e as any)?.message || e).slice(0, 80)} — 멈춘다` }, 503);
  }

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "ANTHROPIC_API_KEY 없음 — Supabase 시크릿을 확인하라" }, 503);
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60000 });

  let inTok = 0, outTok = 0, calls = 0;
  const errs: string[] = [];
  // 🔴 한 묶음이 실패하면 **쪼개 다시 묻는다** — 캡션 한 건 때문에 8건을 잃지 않게.
  //    (2026-10-01: 400 한 번에 8건이 통째로 「판독못함」이 됐다)
  const chunks: typeof uniq[] = [];
  for (let i = 0; i < uniq.length; i += PER_CALL) chunks.push(uniq.slice(i, i + PER_CALL));
  while (chunks.length) {
    const chunk = chunks.shift()!;
    const user = chunk.map((x, n) => `[${n}] @${x.insta}\n${x.cap}`).join("\n\n---\n\n");
    try {
      const res = await client.messages.parse({
        model: MODEL, max_tokens: 1200, system: SYSTEM,
        messages: [{ role: "user", content: user }],
        output_config: { format: zodOutputFormat(Batch) },
      });
      calls++;
      inTok += res.usage?.input_tokens ?? 0;
      outTok += res.usage?.output_tokens ?? 0;
      const got = res.parsed_output?.items || [];
      // 🔴 2026-10-01 실측: 빈 문자열을 달라고 했는데 **문자열 "null"** 을 넣어 왔다
      //    (`아이보 브로우밤` 날짜 "null"). 그대로 두면 날짜 파서에 "null" 이 들어간다.
      const nz = (s: unknown) => { const t = String(s ?? "").trim(); return /^(null|undefined|none|없음|미정|-|n\/a)$/i.test(t) ? "" : t; };
      for (const g of got) {
        const src = chunk[g.idx];
        if (!src) continue;        // 번호가 어긋나면 버린다 — 엉뚱한 캡션에 붙이지 않는다
        out.set(src.sha, {
          cap_sha: src.sha,
          is_gonggu: !!g.is_gonggu,
          product: nz(g.product).slice(0, 60),
          date_text: nz(g.date_text).slice(0, 60),
          note: nz(g.note).slice(0, 20),
          cached: false,
        });
      }
      // 🔴 답이 안 온 건을 **조용히 넘기지 않는다** — 호출처가 알아야 한다
      const answered = new Set(got.map((g) => g.idx));
      for (let n = 0; n < chunk.length; n++) if (!answered.has(n)) errs.push(`무응답 @${chunk[n].insta}`);
    } catch (e) {
      const msg = String((e as any)?.message || e).replace(/\s+/g, " ").slice(0, 200);
      if (chunk.length > 1) {                               // 쪼개 다시 — 한 건이 나머지를 죽이지 않게
        const h = Math.ceil(chunk.length / 2);
        chunks.unshift(chunk.slice(0, h), chunk.slice(h));
        errs.push(`쪼개 재시도(${chunk.length}→${h}) ${msg}`);
      } else {
        errs.push(`호출실패 @${chunk[0].insta} ${msg}`);     // 1건까지 쪼갰는데도 실패 — 그 캡션이 문제다
      }
    }
  }

  // ── ② 저장 (학습 누적). 저장 실패해도 결과는 돌려주되 **errors 에 남긴다**
  const fresh = [...out.values()].filter((v) => !v.cached);
  if (fresh.length) {
    const byS = new Map(uniq.map((x) => [x.sha, x]));
    const per = Math.max(fresh.length, 1);
    const rows = fresh.map((v) => ({
      cap_sha: v.cap_sha,
      insta: byS.get(v.cap_sha)?.insta || null,
      is_gonggu: v.is_gonggu,
      product: v.product || null,
      date_text: v.date_text || null,
      note: v.note || null,
      model: MODEL,
      in_tok: Math.round(inTok / per),
      out_tok: Math.round(outTok / per),
    }));
    try {
      const r = await fetch(`${SB}/rest/v1/caption_ai`, {
        method: "POST",
        headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json",
                   Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) errs.push(`캐시저장 실패 ${r.status} ${(await r.text()).slice(0, 120)}`);
    } catch (e) { errs.push(`캐시저장 오류 ${String((e as any)?.message || e).slice(0, 80)}`); }
  }

  const results = items.map((x) => ({
    id: x.id, insta: x.insta,
    ...(out.get(x.sha) || { cap_sha: x.sha, is_gonggu: false, product: "", date_text: "", note: "판독못함", cached: false }),
  }));
  return json({
    results,
    usage: { calls, in: inTok, out: outTok, cached: items.length - todo.length,
             usd: +((inTok / 1e6) * 1.0 + (outTok / 1e6) * 5.0).toFixed(5) },
    errors: errs.slice(0, 20),
  });
});

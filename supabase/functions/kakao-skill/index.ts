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
const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";
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
async function rpc(fn: string) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok ? await r.json() : [];
}
async function aliases(): Promise<[string, string][]> {
  const rows = await q("bot_alias?select=term,expand");
  return (rows as any[]).map((r) => [String(r.term), String(r.expand)] as [string, string]);
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
  /[?？!！~.,ㅋㅎㅠㅜ\s]+$/,
  /(뭐|머|모)\s*있(어요|어|엉|음|나요|나|니|냐고|냐)?$/,
  /있(어요|어|엉|음|나요|나|니|냐고|냐|는지)?$/,
  /없(어요|어|엉|음|나요|나|니)?$/,
  /알려\s*(주세요|주라|줄래|줘|죠|줭)?$/,
  /보여\s*(주세요|주라|줘|죠|줭)?$/,
  /말해\s*(봐|바|줘)?$/,
  /얘기\s*(해|해줘)?$/,
  /추천\s*(해)?\s*(주세요|줘|죠|줭)?$/,
  /찾아\s*(주세요|줘|죠|봐)?$/,
  /해\s*(주세요|주라|줘|죠|줭)$/,
  /(뭐야|머야|뭐임|뭔데|뭐가|머가|뭐|머)$/,
  /(종류|모음|관련|같은거|같은\s*거)$/,
  /(언제|어때|어떤|얼마|어디)$/,
  /(냐고|라고|다고|인데|는데|건데|이야|임|이지|잖아)$/,
  /(좀|요|용|넹|넵|야)$/,
];
function stripTail(s: string) {
  let prev = "";
  for (let i = 0; i < 8 && s !== prev; i++) {
    prev = s;
    for (const re of TAILS) s = s.replace(re, "").trim();
  }
  return s;
}
function keyword(u: string) {
  let s = stripTail(u);
  // 여기서 지우는 것은 **문장 부품**뿐이다. 브랜드가 될 수 있는 낱말은 절대 건드리지 않는다.
  //   ⚠ 전역 치환은 낱말 속까지 먹는다 — 머그컵→'그컵', 해담옥→'담옥' 사고(2026-09-01).
  //     그래서 어미·감탄사는 stripTail 이 **문장 끝에서만** 처리하고, 여기선 안전한 것만 지운다.
  s = s
    .replace(/이번\s*주에?|이번주|주간|오늘|내일|요즘|지금|현재/g, " ")
    .replace(/공동구매|공구|일정|소식|목록|리스트/g, " ")
    .replace(/핫한|인기\s*있는|인기|괜찮은|새로운|저렴한/g, " ")
    .replace(/마감|끝나는|종료|오픈/g, " ")
    .replace(/바부야|바보야|아니고|아니라|말고|그리고|근데|좀/g, " ")
    .replace(/[?？!！.,~·\-_/]/g, " ")
    .replace(/\s+/g, " ").trim();
  return stripTail(s);   // 부품을 지운 뒤 다시 말끝 정리 ("소고기 뭐" → "소고기")
}


Deno.serve(async (req) => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  // ⚠ reply 는 body 파싱보다 먼저 정의되므로 u/uid 는 let 으로 미리 선언한다 (2026-09-01: 전 요청 500 사고)
  let u = "", uid = "?";
  const reply = (outputs: any[]) => {
    try {
      const last = outputs[outputs.length - 1] as any;
      const kind = Object.keys(last || {})[0] || "?";
      const n = last?.carousel?.items?.length ?? 0;
      fetch(`${SB}/rest/v1/events`, { method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ event_type: "kakao_bot", event_data: `${u.slice(0, 40)} | uid=${uid} | ${kind}${n ? "x" + n : ""}` }) });
    } catch (_) { /* 기록 실패는 무시 */ }
    return json({ version: "2.0", template: { outputs } });
  };
  try {
    const body = await req.json().catch(() => ({}));
    u = String(body?.userRequest?.utterance ?? "").trim();
    uid = String(body?.userRequest?.user?.id ?? "?").slice(0, 6) + ":" + String(body?.userRequest?.user?.type ?? "?").slice(0, 4)
        + ":" + String(req.headers.get("user-agent") ?? "?").slice(0, 14);
    const today = ymd(kst());

    if (/^(안녕|하이|하잉|반가|헬로|hi|hello|도움|사용법|메뉴|뭐해|누구)/i.test(u) || u.length < 2) return reply([text(HELP)]);

    // 인기 질문 ("젤 인기있는", "젤 핫한거", "조회수 많은거", "오늘의 탑텐") — 조회수+찜 합산 순
    const wantTop = /인기|젤\s|제일|가장|탑\s*텐|탑10|탑\s*10|top\s*10|톱텐|조회수|많이\s*본|베스트|best|순위|랭킹/i.test(u);
    const wantClose = /마감|끝나|종료/.test(u);
    const wantTomorrow = /내일|낼/.test(u);
    const wantWeek = /이번\s*주|이번주|주간/.test(u);
    const kw = keyword(u);
    const ph = await partnerHandles();

    const todayCards = async () => {
      const rows = await pick(`open_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요. 아래 버튼에서 이번 주 일정을 볼 수 있어요!")]);
      return reply([cards(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    };

    // ⓪-0 이스터에그 (사장님 지시 2026-09-01)
    if (/송중기/.test(u)) {
      return reply([text("TMI 방장아들은 1초 송중기를 닮았다 맘캘 VIP 회원님 감사합니다 🙂")]);
    }

    // ⓪ 핫딜은 아직 챗봇에서 못 다룬다 → 사이트로 안내 (사장님 지시 2026-09-01)
    if (/핫딜|특가|할인|세일|최저가|딜\b/.test(u)) {
      return reply([text("핫딜은 아직 챗봇에서는 안 알려드려요 🙏\n맘캘린더 사이트 '🔥 핫딜' 탭에서 오늘 올라온 특가를 모아 보실 수 있어요!")]);
    }

    // ⓪-b 인기 질문 ("젤 인기있는", "젤 핫한거", "조회수 많은거", "오늘의 탑텐") = 조회수 + 찜 합산 순
    if (wantTop) {
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
    }

    // ① 브랜드·상품·셀러 검색 (말버릇을 걷어내고 남은 낱말이 있을 때만)
    if (kw.length >= 2) {
      const AL = await aliases();
      const tries = [kw];
      for (const [a, b] of AL) { if (kw.includes(a)) tries.push(kw.split(a).join(b)); if (kw.includes(b)) tries.push(kw.split(b).join(a)); }
      if (kw.length >= 3 && kw.length <= 5) tries.push("__ABBR__" + kw);   // 줄임말: 글자 사이를 연다
      for (const t of [...new Set(tries)]) {
        const pat = t.startsWith("__ABBR__") ? "%" + t.slice(8).split("").join("%") + "%" : `%${t}%`;
        const enc = encodeURIComponent(pat);
        const rows = await pick(`end_date=gte.${today}&or=(name.ilike.${enc},influencer.ilike.${enc},insta.ilike.${enc})`, "order=open_date.asc", ph);
        if (rows.length) return reply([cards(`'${kw}' 공구 일정`, rows)]);
      }
      // 못 찾은 검색어를 쌓는다 — 이걸 보고 bot_alias 와 위 말버릇 목록을 채운다 (학습 루프)
      try {
        fetch(`${SB}/rest/v1/events`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ event_type: "kakao_bot_miss", event_data: `${kw} <= ${u}`.slice(0, 70) }) });
      } catch (_) { /* 무시 */ }
      return reply([text(`'${kw}' 공구는 지금 진행 중이거나 예정인 게 없어요.\n아래 버튼으로 전체 일정에서 찾아보실 수 있어요!`)]);
    }

    // ② 날짜 질문
    if (wantClose) {
      const rows = await pick(`end_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 마감인 공구가 없어요. 아래 버튼에서 전체 일정을 볼 수 있어요!")]);
      return reply([cards(`오늘(${today.slice(5)}) 마감 공구`, rows)]);
    }
    if (wantTomorrow) {
      const t = addDays(today, 1);
      const rows = await pick(`open_date=eq.${t}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("내일 오픈 예정 공구가 아직 등록되지 않았어요.")]);
      return reply([cards(`내일(${t.slice(5)}) 오픈 공구`, rows)]);
    }
    if (wantWeek) {
      const rows = await pick(`open_date=gte.${today}&open_date=lte.${addDays(today, 6)}`, "order=open_date.asc", ph);
      if (rows.length) return reply([cards("이번 주 오픈 공구", rows)]);
    }
    // ③ 말버릇만 남은 질문("오늘 핫한 공구머있어") = 오늘 공구
    return await todayCards();
  } catch (_) {
    return reply([text("일시적으로 조회가 안 되고 있어요. 잠시 뒤 다시 물어봐 주세요!")]);
  }
});

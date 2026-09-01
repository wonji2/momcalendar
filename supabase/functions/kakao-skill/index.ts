// 카카오톡 채널 챗봇 스킬 서버 (사장님 지시 2026-09-01)
//
//   손님이 채널에서 자연스럽게 물으면 우리 gonggu DB 로 답한다.
//   "오늘 공구 뭐있어?" "오늘 마감 공구 알려줘" "오늘 뽀사카 공구있어?" 다 알아듣는다.
//
//   🔑 의도 판정 순서가 핵심이다 — **브랜드 낱말이 있으면 그게 최우선**이다.
//      ('오늘' 을 먼저 보면 "오늘 뽀사카 공구있어?" 가 오늘 전체 목록으로 새어나간다. 실제로 그랬다.)
//   🔴 맘캘린더·맘캘 이웃셀러 공구는 **무조건 맨 앞** + 💜 (사장님 지시).
//      ⚠ 전체를 받아 정렬하면 안 된다 — 오늘 오픈만 348건이라 파트너가 상위 N 밖으로 밀린다.
//        파트너를 insta=in.(핸들) 로 **따로 조회해 앞에 붙인다.**
//   ⚠ 카카오 챗봇은 카카오톡 **채널**에서만 동작한다(오픈채팅 봇 API 없음).
//   ⚠ 호출은 events(kakao_bot) 에 기록된다 — 연결 확인·사용 통계용.
const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";
const HELP = ["맘캘린더예요! 공구 일정을 알려드려요", "", "· 오늘 공구 뭐있어?", "· 오늘 마감 공구 알려줘", "· 이번주 공구", "· 브랜드 이름 (예: 뽀사카 공구있어?)", "", "전체 일정은 " + SITE].join("\n");
const MAX_SHOW = 20;   // 캐러셀 5장 × 4건 (카카오 최대치)

const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const norm = (x: unknown) => String(x || "").toLowerCase().replace("@", "").trim();
const MOMCAL = ["momcal_", "momcalendar", "momcal", "momcalendar_"];
const COLS = "id,name,influencer,insta,open_date,end_date,pay_link";

// 손님이 쓰는 말 ↔ DB 표기. 🔑 코드가 아니라 **DB(bot_alias)** 에 둔다 —
//   재배포 없이 늘릴 수 있고, 못 찾은 질문(events.kakao_bot_miss)을 보고 채워 넣는 학습 루프의 저장소다.
async function aliases(): Promise<[string, string][]> {
  const rows = await q("bot_alias?select=term,expand");
  return (rows as any[]).map((r) => [String(r.term), String(r.expand)] as [string, string]);
}

async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? await r.json() : [];
}

async function partnerHandles(): Promise<string[]> {
  const rows = await q("sellers?select=insta&is_partner=eq.true&active=eq.true");
  const set = new Set<string>(MOMCAL);
  for (const r of rows as any[]) { const h = norm(r.insta); if (h) set.add(h); }
  return [...set];
}

// 조건에 맞는 공구를 파트너 먼저 모은다
async function pick(cond: string, order: string, ph: string[]) {
  const inList = `(${ph.map((h) => `"${h}"`).join(",")})`;
  const partner = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&insta=in.${inList}&${order}&limit=15`);
  const rest = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&${order}&limit=35`);
  const seen = new Set((partner as any[]).map((g) => g.id));
  const out = [...(partner as any[]).map((g) => ({ ...g, __p: true }))];
  for (const g of rest as any[]) { if (!seen.has(g.id)) out.push({ ...g, __p: false }); if (out.length >= MAX_SHOW) break; }
  return out.slice(0, MAX_SHOW);
}

// ⚠ simpleText 안의 URL 은 눌러도 잘 안 열린다(사장님 지적) → **버튼이 달린 카드**로 답한다.
const text = (t: string) => ({
  textCard: { text: t, buttons: [{ action: "webLink", label: "맘캘린더 바로가기", webLinkUrl: SITE }] },
});
const one = (title: string, items: any[]) => ({
  header: { title },
  items: items.map((g: any) => ({
    title: (g.__p ? "💜 " : "") + String(g.name || "").slice(0, 34),
    description: `${g.influencer || g.insta || ""} · ${String(g.open_date).slice(5)}~${String(g.end_date).slice(5)}`.replace(/^ · /, ""),
    // 사이트 카드와 같은 규칙: 결제·카페 링크 → 셀러 인스타 → 맘캘린더
    link: { web: String(g.pay_link || "").startsWith("http") ? String(g.pay_link) : (g.insta ? `https://instagram.com/${norm(g.insta)}` : SITE) },
  })),
  buttons: [{ label: "전체 일정 보기", action: "webLink", webLinkUrl: SITE }],
});
// 카카오 규격: 캐러셀 **최대 5장**, 캐러셀 안 listCard 는 **항목 4개**까지(단일 카드는 5개).
//   ⚠ 어기면 "말풍선 가이드 위반" 으로 응답이 통째로 버려져 손님에게 아무것도 안 간다 (2026-09-01 실사고).
const CARD_MAX = 5, PER_CARD = 4;
function cards(title: string, rows: any[]) {
  if (rows.length <= 5) return { listCard: one(title, rows) };          // 단일 카드는 5개까지
  const ch: any[][] = [];
  for (let i = 0; i < rows.length && ch.length < CARD_MAX; i += PER_CARD) ch.push(rows.slice(i, i + PER_CARD));
  return { carousel: { type: "listCard", items: ch.map((c, i) => one(`${title} ${i + 1}/${ch.length}`, c)) } };
}

Deno.serve(async (req) => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  // 호출 기록 — 누가(uid) 무엇을 묻고 어떤 형태로 답했는지 남긴다.
  //   ⚠ reply 는 body 파싱보다 먼저 정의되므로 u/uid 를 **let 으로 미리 선언**해야 한다.
  //     (2026-09-01: body 를 직접 참조하게 만들었다가 전 요청이 500 으로 죽었다)
  let u = "", uid = "?";
  const reply = (outputs: any[]) => {
    try {
      const kind = Object.keys(outputs[0] || {})[0] || "?";
      const n = outputs[0]?.carousel?.items?.length ?? 0;
      fetch(`${SB}/rest/v1/events`, { method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ event_type: "kakao_bot", event_data: `${u.slice(0, 40)} | uid=${uid} | ${kind}${n ? "x" + n : ""}` }) });
    } catch (_) { /* 기록 실패는 무시 */ }
    return json({ version: "2.0", template: { outputs } });
  };
  try {
    const body = await req.json().catch(() => ({}));
    u = String(body?.userRequest?.utterance ?? "").trim();
    uid = String(body?.userRequest?.user?.id ?? "?").slice(0, 8) + ":" + String(body?.userRequest?.user?.type ?? "?");
    const today = ymd(kst());


    if (/^(안녕|하이|하잉|반가|헬로|hi|hello|도움|사용법|메뉴|뭐해|누구)/i.test(u) || u.length < 2) {
      return reply([text(HELP)]);
    }

    const wantClose = /마감|끝나|종료/.test(u);
    const wantToday = /오늘|투데이/.test(u);
    const wantTomorrow = /내일|낼/.test(u);
    const wantWeek = /이번\s*주|이번주|주간|이번주에/.test(u);

    // 시간어·명령어·조사를 걷어내고 남는 것이 있으면 그게 찾는 브랜드다
    const kw = u
      .replace(/이번\s*주에?|이번주|주간|오늘|내일|낼|투데이/g, " ")
      .replace(/마감|끝나는|종료|오픈|시작/g, " ")
      .replace(/공구|공동구매|일정|정보/g, " ")
      .replace(/뭐\s*있|있나요|있어요|있어|있니|없어|알려\s*줘|알려주세요|보여\s*줘|찾아\s*줘|해\s*줘|해줭|언제|뭐야|뭐|좀|해|요|는|은|이|가|에|의|도|만|\?|？|!|~|\./g, " ")
      .replace(/\s+/g, " ").trim();

    const ph = await partnerHandles();

    // ── ① 브랜드·상품·셀러 검색 (시간어보다 우선) ──
    if (kw.length >= 2) {
      // 별칭까지 넓혀 순서대로 찾는다
      const AL = await aliases();
      const tries = [kw];
      for (const [a, b] of AL) { if (kw.includes(a)) tries.push(kw.split(a).join(b)); if (kw.includes(b)) tries.push(kw.split(b).join(a)); }
      // 줄임말 폴백: 글자 사이를 열어 찾는다 (뽀사카 → %뽀%사%카% = "뽀로로 사운드카드")
      if (kw.length >= 3 && kw.length <= 5) tries.push("__ABBR__" + kw);
      for (const t of [...new Set(tries)]) {
        const enc = encodeURIComponent(`%${t}%`);
        let cond = `end_date=gte.${today}&or=(name.ilike.${enc},influencer.ilike.${enc},insta.ilike.${enc})`;
        if (wantToday) cond += `&open_date=lte.${today}`;                     // "오늘 OO 공구있어?" = 지금 진행중인 것
        const rows = await pick(cond, "order=open_date.asc", ph);
        if (rows.length) return reply([cards(`'${kw}' 공구 일정`, rows)]);
      }
      // 못 찾은 질문을 쌓는다 — 이걸 보고 bot_alias 를 채워 넣는 학습 루프
      try {
        fetch(`${SB}/rest/v1/events`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ event_type: "kakao_bot_miss", event_data: kw.slice(0, 60) }) });
      } catch (_) { /* 기록 실패는 무시 */ }
      return reply([text(`'${kw}' 공구는 지금 진행 중이거나 예정인 게 없어요.
아래 버튼으로 전체 일정에서 찾아보실 수 있어요!`)]);
    }

    // ── ② 날짜 질문 ──
    if (wantClose) {
      const rows = await pick(`end_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 마감인 공구가 없어요.\n" + SITE)]);
      return reply([cards(`오늘(${today.slice(5)}) 마감 공구`, rows)]);
    }
    if (wantTomorrow) {
      const t = addDays(today, 1);
      const rows = await pick(`open_date=eq.${t}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("내일 오픈 예정 공구가 아직 등록되지 않았어요.\n" + SITE)]);
      return reply([cards(`내일(${t.slice(5)}) 오픈 공구`, rows)]);
    }
    if (wantWeek) {
      const end = addDays(today, 6);
      const rows = await pick(`open_date=gte.${today}&open_date=lte.${end}`, "order=open_date.asc", ph);
      if (!rows.length) return reply([text("이번 주 공구 일정을 불러오지 못했어요.\n" + SITE)]);
      return reply([cards("이번 주 오픈 공구", rows)]);
    }
    if (wantToday) {
      const rows = await pick(`open_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요.\n" + SITE)]);
      return reply([cards(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    }
    return reply([text(HELP)]);
  } catch (_) {
    return reply([text("일시적으로 조회가 안 되고 있어요. 잠시 뒤 다시 물어봐 주세요!\n" + SITE)]);
  }
});

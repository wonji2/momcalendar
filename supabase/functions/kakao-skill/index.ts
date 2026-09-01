// 카카오톡 채널 챗봇 스킬 서버 (사장님 지시 2026-09-01)
//
//   손님이 채널에서 "오늘 공구", "바크 공구 언제" 라고 물으면 우리 gonggu DB 로 답한다.
//
//   🔴 맘캘린더·맘캘 이웃셀러 공구는 **무조건 맨 앞**에 넣는다 (사장님 지시).
//      ⚠ 전체를 한 번에 받아 정렬하면 안 된다 — 오늘 오픈만 348건이라 파트너 건이
//        상위 N 밖으로 밀려 사라진다. **파트너를 따로 조회해 앞에 붙인다.**
//   ⚠ 카카오 챗봇은 카카오톡 **채널**에서만 동작한다(오픈채팅 봇 API 없음).
//   ⚠ 호출은 events(kakao_bot) 에 기록된다 — 연결 확인·사용 통계용.
//
//   오픈빌더: 스킬 URL 에 이 주소를 넣고 폴백 블록 응답을 '스킬데이터'로 연결.
const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";
const HELP = ["맘캘린더예요! 공구 일정을 알려드려요", "", "· 오늘 공구", "· 내일 공구", "· 이번주 공구", "· 오늘 마감", "· 브랜드명 (예: 바크 공구)", "", "전체 일정은 " + SITE].join("\n");

const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const norm = (x: unknown) => String(x || "").toLowerCase().replace("@", "").trim();
const MOMCAL = ["momcal_", "momcalendar", "momcal", "momcalendar_"];
const COLS = "id,name,influencer,insta,open_date,end_date";

async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? await r.json() : [];
}

// 파트너(맘캘린더 본인 + 이웃셀러) 핸들 목록
async function partnerHandles(): Promise<string[]> {
  const rows = await q("sellers?select=insta&is_partner=eq.true&active=eq.true");
  const set = new Set<string>(MOMCAL);
  for (const r of rows as any[]) { const h = norm(r.insta); if (h) set.add(h); }
  return [...set];
}

// 조건(cond)에 맞는 공구를 **파트너 먼저** 최대 5건으로 모은다
async function pick(cond: string, order: string, ph: string[]) {
  const inList = `(${ph.map((h) => `"${h}"`).join(",")})`;
  const partner = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&insta=in.${inList}&${order}&limit=10`);
  const rest = await q(`gonggu?select=${COLS}&approved=eq.true&${cond}&${order}&limit=20`);
  const seen = new Set((partner as any[]).map((g) => g.id));
  const out = [...(partner as any[]).map((g) => ({ ...g, __p: true }))];
  for (const g of rest as any[]) { if (!seen.has(g.id)) out.push({ ...g, __p: false }); if (out.length >= MAX_SHOW) break; }
  return out.slice(0, MAX_SHOW);
}

const text = (s: string) => ({ simpleText: { text: s } });
// 카카오 listCard 는 **한 장에 5건**이 한계다 → 5건씩 잘라 좌우로 넘기는 캐러셀로 만든다 (최대 15건)
const MAX_SHOW = 15;
const one = (title: string, items: any[]) => ({
  header: { title },
  items: items.map((g: any) => ({
    title: (g.__p ? "💜 " : "") + String(g.name || "").slice(0, 34),
    description: `${g.influencer || g.insta || ""} · ${String(g.open_date).slice(5)}~${String(g.end_date).slice(5)}`.replace(/^ · /, ""),
    link: { web: g.insta ? `https://instagram.com/${norm(g.insta)}` : SITE },
  })),
  buttons: [{ label: "전체 일정 보기", action: "webLink", webLinkUrl: SITE }],
});
function cards(title: string, rows: any[]) {
  const ch: any[][] = [];
  for (let i = 0; i < rows.length; i += 5) ch.push(rows.slice(i, i + 5));
  if (ch.length <= 1) return { listCard: one(title, ch[0] || []) };
  return { carousel: { type: "listCard", items: ch.map((c, i) => one(`${title} (${i + 1}/${ch.length})`, c)) } };
}

Deno.serve(async (req) => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  const reply = (outputs: any[]) => json({ version: "2.0", template: { outputs } });
  try {
    const body = await req.json().catch(() => ({}));
    const u = String(body?.userRequest?.utterance ?? "").trim();
    const today = ymd(kst());

    // 호출 기록 (연결 확인 + 무엇을 많이 묻는지 통계)
    try {
      fetch(`${SB}/rest/v1/events`, { method: "POST",
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ event_type: "kakao_bot", event_data: u.slice(0, 80) }) });
    } catch (_) { /* 기록 실패는 무시 */ }

    if (/^(안녕|하이|하잉|반가|헬로|hi|hello|도움|사용법|메뉴|뭐해|누구)/i.test(u) || u.length < 2) {
      return reply([text(HELP)]);
    }

    const ph = await partnerHandles();

    if (/마감/.test(u)) {
      const rows = await pick(`end_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 마감인 공구가 없어요.\n" + SITE)]);
      return reply([cards(`오늘(${today.slice(5)}) 마감 공구`, rows)]);
    }
    if (/오늘/.test(u)) {
      const rows = await pick(`open_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요.\n" + SITE)]);
      return reply([cards(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    }
    if (/내일/.test(u)) {
      const t = addDays(today, 1);
      const rows = await pick(`open_date=eq.${t}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("내일 오픈 예정 공구가 아직 등록되지 않았어요.\n" + SITE)]);
      return reply([cards(`내일(${t.slice(5)}) 오픈 공구`, rows)]);
    }
    if (/이번\s*주|주간/.test(u)) {
      const end = addDays(today, 6);
      const rows = await pick(`open_date=gte.${today}&open_date=lte.${end}`, "order=open_date.asc", ph);
      if (!rows.length) return reply([text("이번 주 공구 일정을 불러오지 못했어요.\n" + SITE)]);
      return reply([cards("이번 주 오픈 공구", rows)]);
    }

    // 브랜드·상품·셀러 검색
    const kw = u.replace(/공구|일정|언제|알려줘|해줘|있어|있나요|\?|？/g, "").trim();
    if (kw.length >= 2) {
      const enc = encodeURIComponent(`%${kw}%`);
      const cond = `end_date=gte.${today}&or=(name.ilike.${enc},influencer.ilike.${enc},insta.ilike.${enc})`;
      const rows = await pick(cond, "order=open_date.asc", ph);
      if (rows.length) return reply([cards(`'${kw}' 공구 일정`, rows)]);
      return reply([text(`'${kw}' 로 진행 중이거나 예정인 공구를 못 찾았어요.\n맘캘린더에서 직접 검색해 보세요!\n${SITE}`)]);
    }
    return reply([text(HELP)]);
  } catch (_) {
    return reply([text("일시적으로 조회가 안 되고 있어요. 잠시 뒤 다시 물어봐 주세요!\n" + SITE)]);
  }
});

// 카카오톡 채널 챗봇 스킬 서버 (사장님 지시 2026-09-01)
//
//   손님이 채널에서 "오늘 공구", "바크 공구 언제", "이번주 공구" 라고 물으면
//   우리 gonggu DB 를 읽어 카카오 응답(listCard)으로 돌려준다.
//
//   ⚠ 카카오 챗봇은 **카카오톡 채널** 에서만 동작한다. 오픈채팅(단톡방)은 카카오가 봇 API 를 안 연다.
//   ⚠ 오픈빌더 설정: 스킬 URL 에 이 함수 주소를 넣고, 폴백 블록(빠짐없이 받기)에 연결한다.
//
//   테스트:  curl -X POST <url> -H 'content-type: application/json' \
//              -d '{"userRequest":{"utterance":"오늘 공구"}}'
const SB = "https://hycaqsqeogjtbscmzrtm.supabase.co";
const KEY = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE";
const SITE = "https://momcalendar.com";
const HELP = ["맘캘린더예요! 공구 일정을 알려드려요","","· 오늘 공구","· 내일 공구","· 이번주 공구","· 오늘 마감","· 브랜드명 (예: 바크 공구)","","전체 일정은 " + SITE].join("\n");

const kst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

async function q(path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return r.ok ? await r.json() : [];
}

// 카카오 응답 조각
const text = (s: string) => ({ simpleText: { text: s } });
const listCard = (title: string, items: any[], more?: string) => ({
  listCard: {
    header: { title },
    items: items.slice(0, 5).map((g: any) => ({
      title: String(g.name || "").slice(0, 36),
      description: `${g.influencer || g.insta || ""} · ${g.open_date?.slice(5)}~${g.end_date?.slice(5)}`.replace(/^ · /, ""),
      link: { web: g.insta ? `https://instagram.com/${String(g.insta).replace("@", "")}` : SITE },
    })),
    buttons: [{ label: more || "전체 일정 보기", action: "webLink", webLinkUrl: SITE }],
  },
});

Deno.serve(async (req) => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "Content-Type": "application/json" } });
  const reply = (outputs: any[]) => json({ version: "2.0", template: { outputs } });
  try {
    const body = await req.json().catch(() => ({}));
    const u = String(body?.userRequest?.utterance ?? "").trim();
    const today = ymd(kst());

    // ── ① 오늘/내일 오픈 ──
    if (/오늘/.test(u) && !/마감/.test(u)) {
      const rows = await q(`gonggu?select=name,influencer,insta,open_date,end_date&approved=eq.true&open_date=eq.${today}&order=id.desc&limit=5`);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요. 맘캘린더에서 이번 주 일정을 확인해 보세요!\n" + SITE)]);
      return reply([listCard(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    }
    if (/내일/.test(u)) {
      const t = addDays(today, 1);
      const rows = await q(`gonggu?select=name,influencer,insta,open_date,end_date&approved=eq.true&open_date=eq.${t}&order=id.desc&limit=5`);
      if (!rows.length) return reply([text("내일 오픈 예정 공구가 아직 등록되지 않았어요.\n" + SITE)]);
      return reply([listCard(`내일(${t.slice(5)}) 오픈 공구`, rows)]);
    }
    // ── ② 오늘 마감 ──
    if (/마감/.test(u)) {
      const rows = await q(`gonggu?select=name,influencer,insta,open_date,end_date&approved=eq.true&end_date=eq.${today}&order=id.desc&limit=5`);
      if (!rows.length) return reply([text("오늘 마감인 공구가 없어요.\n" + SITE)]);
      return reply([listCard(`오늘(${today.slice(5)}) 마감 공구`, rows)]);
    }
    // ── ③ 이번주 ──
    if (/이번\s*주|이번주|주간/.test(u)) {
      const end = addDays(today, 6);
      const rows = await q(`gonggu?select=name,influencer,insta,open_date,end_date&approved=eq.true&open_date=gte.${today}&open_date=lte.${end}&order=open_date.asc&limit=5`);
      if (!rows.length) return reply([text("이번 주 공구 일정을 불러오지 못했어요.\n" + SITE)]);
      return reply([listCard("이번 주 오픈 공구", rows)]);
    }

    // ── ③-b 인사·도움말 (검색으로 새지 않게 먼저 거른다) ──
    if (/^(안녕|하이|하잉|반가|헬로|hi|hello|도움|사용법|메뉴|뭐해|누구)/i.test(u) || u.length < 2) {
      return reply([text(HELP)]);
    }

    // ── ④ 브랜드·상품·셀러 검색 (그 외 모든 발화) ──
    const kw = u.replace(/공구|일정|언제|알려줘|해줘|있어|있나요|\?|？/g, "").trim();
    if (kw.length >= 2) {
      const enc = encodeURIComponent(`%${kw}%`);
      const rows = await q(`gonggu?select=name,influencer,insta,open_date,end_date&approved=eq.true&end_date=gte.${today}`
        + `&or=(name.ilike.${enc},influencer.ilike.${enc},insta.ilike.${enc})&order=open_date.asc&limit=5`);
      if (rows.length) return reply([listCard(`'${kw}' 공구 일정`, rows)]);
      return reply([text(`'${kw}' 로 진행 중이거나 예정인 공구를 못 찾았어요.\n맘캘린더에서 직접 검색해 보세요!\n${SITE}`)]);
    }
    // ── ⑤ 안내 ──
    return reply([text(
      "맘캘린더예요! 이렇게 물어보실 수 있어요 🙂\n\n· 오늘 공구\n· 내일 공구\n· 이번주 공구\n· 오늘 마감\n· (브랜드명) 예) 바크 공구\n\n전체 일정은 " + SITE,
    )]);
  } catch (e) {
    return reply([text("일시적으로 조회가 안 되고 있어요. 잠시 뒤 다시 물어봐 주세요!\n" + SITE)]);
  }
});

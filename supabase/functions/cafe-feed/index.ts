// ═════════════════════════════════════════════════
//  cafe-feed  —  맘캘린더 네이버 카페(clubid 31499187) 14개 게시판의 최신 글 목록을 community_posts 에 쌓는다
//                (사장님 2026-10-23 앱 디벨롭 결정: 커뮤니티 탭 = 카페 게시판, 글 많은 순으로 정렬, 제목+댓글수)
//
//  흐름  게시판마다 카페 새 목록 API(cafe-boardlist-api v1, 로그인 불필요) 두 번 → upsert(cafe_id, article_id)
//          ① viewType=L : 제목·닉네임·댓글수·조회수·시각 + summary(본문 앞부분)
//          ② viewType=I : 사진 있는 글만 · representImage(대표 사진 주소)
//        (2026-10-24 v2 — 옛 ArticleListV2 엔 본문이 없어 「등급이 막는다」로 적었던 것은 틀렸다. 사장님 「앱 짜놓은대로 본문 두 줄」)
//        summary 끝에 카페가 자동으로 붙이는 꼬리(「-----」 줄 · 「▪ 맘캘린더[…]」 키워드 줄)는 잘라 낸다
//        사진은 다른 사이트에서 부르면 네이버가 403 을 준다 → 화면은 referrerpolicy=no-referrer + ?type=f160_160(약 30KB)로 쓴다
//  호출  POST /functions/v1/cafe-feed   헤더 x-cron-secret      ?boards=14,127  일부만   ?per=20 게시판당 건수   ?dry=1 저장 안 하고 견본만
//  주기  pg_cron `cafe-feed` 30분마다 — supabase/sql/community_posts_90.sql (칸 추가 102)
//  한도  호출당 요청 28개 · 행 420개 upsert. 표는 30일 지난 글을 크론에서 지운다(0-L: 하루 +400행 → 30일 12,000행 상한).
//  ⚠ 0건 = 게시판이 비었다는 뜻이 아니다 — API 모양이 바뀌었는지 원문(JSON)을 열어 본다.
// ═════════════════════════════════════════════════
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
const CLUB = 31499187;
// 게시판 id → 이름 (2026-10-23 SideMenuList 실측)
const BOARDS: Record<number, string> = { 14: "자유수다", 127: "살까말까", 21: "육아수다", 85: "이유식·유아식", 126: "책육아", 70: "임신수다", 92: "뷰티·다욧", 91: "리빙·인테리어", 118: "초중고딩", 122: "가십·유머", 123: "여행·문화", 124: "반려동물", 120: "축하·위로", 20: "오늘의 식탁" };
const LIST = (menuid: number, per: number, vt: "L" | "I") =>
  `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${CLUB}/menus/${menuid}/articles?page=1&pageSize=${per}&sortBy=TIME&viewType=${vt}`;
// 본문 앞부분: 「-----」 줄로 나뉜 조각 중 카페 자동 꼬리(「▪ 맘캘린더[…]」)를 빼고, 남은 것 중 **마지막 조각**(게시판 안내 머리글 뒤의 실제 본문)을 쓴다
//   (검증자 2026-10-24: 첫 「-----」 에서 자르면 「잠깐! 질문글 올리기 전…」 머리글만 남고 본문이 버려졌다 — 글 42488)
const cleanSummary = (s: unknown) => {
  const parts = String(s || "").split(/\n\s*-{5,}\s*(?:\n|$)/).map((p) => p.replace(/▪\s*맘캘린더\s*\[[\s\S]*$/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return (parts[parts.length - 1] || "").slice(0, 200) || null;
};

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const u = new URL(req.url);
  const per = Math.min(50, Number(u.searchParams.get("per") || 30));
  const dry = u.searchParams.get("dry") === "1";
  const only = (u.searchParams.get("boards") || "").split(",").map((x) => Number(x)).filter(Boolean);
  const ids = only.length ? only : Object.keys(BOARDS).map(Number);
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const get = async (url: string) => {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error(`http ${r.status}`);
    const j = await r.json();
    return ((j?.result?.articleList || []) as any[]).map((x) => x?.item).filter(Boolean);
  };
  for (const menuid of ids) {
    try {
      const list = await get(LIST(menuid, per, "L"));
      if (!list.length) errors.push(`${menuid}: 0건`);
      const img: Record<number, string> = {};
      try { for (const a of await get(LIST(menuid, per, "I"))) if (a.representImage) img[Number(a.articleId)] = String(a.representImage); }
      catch (e) { errors.push(`${menuid} 사진: ${String(e).slice(0, 60)}`); }
      for (const a of list) {
        const aid = Number(a.articleId); if (!aid) continue;
        if (a.blindArticle === true || a.openArticle === false) continue;   // 블라인드·비공개 글은 안 담는다
        rows.push({
          cafe_id: CLUB, article_id: aid, board_id: menuid, board: BOARDS[menuid] || String(a.menuName || menuid),
          title: String(a.subject || "").slice(0, 200), nick: String(a.writerInfo?.nickName || "").slice(0, 40), writer_level: Number(a.writerInfo?.memberLevel) || null,   // 카페 회원 등급(1 새싹·110 신입·120 성실·130 열심·140 VIP·150 맘캘이웃·999 방장) — 닉네임 옆 등급 아이콘 (2026-10-25)
          comments: Number(a.commentCount || 0), views: Number(a.readCount || 0), likes: Number(a.likeCount || 0),
          has_image: a.hasImage === true || !!img[aid], is_notice: a.popular === true,
          summary: cleanSummary(a.summary), image_url: img[aid] || null,
          posted_at: new Date(Number(a.writeDateTimestamp || Date.now())).toISOString(),
          url: `https://cafe.naver.com/momcal/${aid}`, fetched_at: new Date().toISOString(),
        });
      }
    } catch (e) { errors.push(`${menuid}: ${String(e).slice(0, 80)}`); }
  }
  if (dry) return new Response(JSON.stringify({ dry: true, rows: rows.length, withSummary: rows.filter((r) => r.summary).length, withImage: rows.filter((r) => r.image_url).length, errors, sample: rows.slice(0, 4) }), { headers: { "Content-Type": "application/json" } });
  let saved = 0;
  if (rows.length) {
    const r = await fetch(`${SB_URL}/rest/v1/community_posts?on_conflict=cafe_id,article_id`, {
      method: "POST", headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!r.ok) errors.push(`upsert ${r.status} ${(await r.text()).slice(0, 120)}`); else saved = rows.length;
  }
  return new Response(JSON.stringify({ boards: ids.length, rows: rows.length, saved, errors }), { headers: { "Content-Type": "application/json" } });
});

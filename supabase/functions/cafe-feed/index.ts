// ═════════════════════════════════════════════════
//  cafe-feed  —  맘캘린더 네이버 카페(clubid 31499187) 14개 게시판의 최신 글 목록을 community_posts 에 쌓는다
//                (사장님 2026-10-23 앱 디벨롭 결정: 커뮤니티 탭 = 카페 게시판, 글 많은 순으로 정렬, 제목+댓글수)
//
//  흐름  게시판마다 공개 목록 API(ArticleListV2.json, 로그인 불필요) 1쪽(30건) → upsert(cafe_id, article_id)
//        본문·사진은 회원 등급이 막아 못 읽는다(메모리 gongtok-body-needs-grade) → 제목·닉네임·댓글수·조회수·시각만.
//  호출  POST /functions/v1/cafe-feed   헤더 x-cron-secret      ?boards=14,127  일부만   ?per=20 게시판당 건수
//  주기  pg_cron `cafe-feed` 30분마다 — supabase/sql/community_posts_90.sql
//  한도  호출당 요청 14개 · 행 420개 upsert. 표는 30일 지난 글을 크론에서 지운다(0-L: 하루 +400행 → 30일 12,000행 상한).
//  ⚠ 0건 = 게시판이 비었다는 뜻이 아니다 — API 모양이 바뀌었는지 원문(JSON)을 열어 본다.
// ═════════════════════════════════════════════════
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const CLUB = 31499187;
// 게시판 id → 이름 (2026-10-23 SideMenuList 실측)
const BOARDS: Record<number, string> = { 14: "자유수다", 127: "살까말까", 21: "육아수다", 85: "이유식·유아식", 126: "책육아", 70: "임신수다", 92: "뷰티·다욧", 91: "리빙·인테리어", 118: "초중고딩", 122: "가십·유머", 123: "여행·문화", 124: "반려동물", 120: "축하·위로", 20: "오늘의 식탁" };

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("forbidden", { status: 403 });
  const u = new URL(req.url);
  const per = Math.min(50, Number(u.searchParams.get("per") || 30));
  const only = (u.searchParams.get("boards") || "").split(",").map((x) => Number(x)).filter(Boolean);
  const ids = only.length ? only : Object.keys(BOARDS).map(Number);
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const menuid of ids) {
    try {
      const r = await fetch(`https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json?search.clubid=${CLUB}&search.menuid=${menuid}&search.page=1&search.perPage=${per}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!r.ok) { errors.push(`${menuid}: http ${r.status}`); continue; }
      const j = await r.json();
      const list = j?.message?.result?.articleList || [];
      if (!list.length) errors.push(`${menuid}: 0건`);
      for (const a of list) {
        const aid = Number(a.articleId); if (!aid) continue;
        if (String(a.blindArticle) === "True" || String(a.openArticle) === "False") continue;   // 블라인드·비공개 글은 안 담는다
        rows.push({
          cafe_id: CLUB, article_id: aid, board_id: menuid, board: BOARDS[menuid] || String(a.menuName || menuid),
          title: String(a.subject || "").slice(0, 200), nick: String(a.writerNickname || "").slice(0, 40),
          comments: Number(a.commentCount || 0), views: Number(a.readCount || 0), likes: Number(a.likeItCount || 0),
          has_image: String(a.attachImage) === "True", is_notice: String(a.popular) === "True",
          posted_at: new Date(Number(a.writeDateTimestamp || Date.now())).toISOString(),
          url: `https://cafe.naver.com/momcal/${aid}`, fetched_at: new Date().toISOString(),
        });
      }
    } catch (e) { errors.push(`${menuid}: ${String(e).slice(0, 80)}`); }
  }
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

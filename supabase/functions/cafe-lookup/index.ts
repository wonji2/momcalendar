// 우리 카페 글 번호 찾기 (사장님 지시 2026-08-10)
//
// 왜: 관리자에서 카페 목록을 붙여넣을 때 글 번호 줄이 같이 복사되지 않으면
//   pay_link 가 비어 "연결할 곳이 없어요" 로 전부 막힌다.
//   카페에는 글이 그대로 있으니 제목을 대조해 번호를 찾아 주면 된다.
//
// ⚠ 네이버 카페 API 는 CORS 헤더를 주지 않아 브라우저에서 직접 못 부른다 → 여기서 대신 부른다.
//   조회 대상은 **맘캘린더 카페 하나로 고정**한다(임의 카페를 긁는 통로가 되면 안 된다).
const CAFE_ID = 31499187;   // cafe.naver.com/momcal

function cors(origin: string | null) {
  const ok = ["https://momcalendar.com", "https://www.momcalendar.com"];
  const o = origin && ok.includes(origin) ? origin : "https://momcalendar.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type,authorization,apikey",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
}

Deno.serve(async (req) => {
  const H = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...H, "Content-Type": "application/json" } });

  try {
    const u = new URL(req.url);
    const pages = Math.min(Math.max(Number(u.searchParams.get("pages") ?? 6), 1), 10);
    const out: { id: number; subj: string }[] = [];
    for (let p = 1; p <= pages; p++) {
      const r = await fetch(
        `https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json` +
        `?search.clubid=${CAFE_ID}&search.boardtype=L&search.page=${p}&search.perPage=50`,
        { headers: { Referer: "https://cafe.naver.com/momcal", "User-Agent": "Mozilla/5.0" } },
      );
      if (!r.ok) break;
      const j = await r.json().catch(() => null);
      const arr = j?.message?.result?.articleList ?? [];
      if (!arr.length) break;
      for (const a of arr) out.push({ id: Number(a.articleId), subj: String(a.subject ?? "") });
    }
    return json({ ok: true, count: out.length, items: out });
  } catch (e) {
    return json({ error: String(e).slice(0, 150) }, 500);
  }
});

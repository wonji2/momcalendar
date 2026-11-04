// 링크프라이스 클릭 주소를 서버에서 한 번 따라가 「http 로 이어지는 마지막 이동」을 https 로 올려 돌려준다 (사장님 2026-11-04 갤럭시 앱 11번가 ERR_CLEARTEXT_NOT_PERMITTED)
//   왜: 11번가 링크프라이스 길은 click.linkprice.com → http://www.11st.co.kr/connect/Gateway… 로 이어져, 평문 http 를 막는 앱 웹뷰(옛 앱 판)가 못 연다.
//   새 앱은 앱 코드가 올려 주지만 옛 앱은 이 함수가 대신 올려 준다. 추적 값(apInfo)은 그대로 넘어가므로 수익 귀속은 같다.
//   안전: 시작 주소는 https://click.linkprice.com/click.php? 로 시작해야만 받는다(아무 주소로 보내 주는 길 금지). 실패하면 원래 주소로 보낸다.
const ALLOW = /^https:\/\/click\.linkprice\.com\/click\.php\?/;
const go = (to: string) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
Deno.serve(async (req) => {
  const u = new URL(req.url).searchParams.get("u") || "";
  if (!ALLOW.test(u)) return new Response("bad request", { status: 400 });
  try {
    let cur = u;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(cur, { redirect: "manual", headers: { "user-agent": req.headers.get("user-agent") || "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36" } });
      const loc = r.headers.get("location");
      if (!(r.status >= 300 && r.status < 400) || !loc) break;
      const next = new URL(loc, cur).href.replace(/^http:\/\//i, "https://");
      if (!/^https:\/\//i.test(next)) break;
      if (!/^https:\/\/click\.linkprice\.com\//i.test(next)) return go(next);   // 링크프라이스를 벗어난 첫 주소 = 도착지
      cur = next;
    }
  } catch (_) { /* 아래에서 원래 주소로 */ }
  return go(u);
});

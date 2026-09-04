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
// 핫딜에 사진이 없을 때 쓸 기본 이미지 — basicCard 는 thumbnail 이 비면 규격 위반이다
const FALLBACK_THUMB = "https://momcalendar.com/momcal-appicon.png";
// 카카오가 읽는 것은 jpg·png 다. webp 를 넣었다가 또 규격 위반이 나면 말풍선이 통째로 안 나간다.
const thumbOf = (u: unknown) => {
  let s = String(u || "").trim();
  if (!s) return FALLBACK_THUMB;
  // 카카오는 https 만 받는다. 판매처 CDN 은 http 로 저장된 게 있어 올려준다(실측: 대부분 https 로도 200)
  if (s.startsWith("http://")) s = "https://" + s.slice(7);
  if (!s.startsWith("https://")) return FALLBACK_THUMB;
  // ⚠ 확장자로 거르지 않는다 — 쿠팡·지마켓은 확장자가 없어도 jpeg 이고,
  //    webp 를 .jpg 로 바꾸면 오히려 404 가 되는 경로가 있다(2026-09-02 실측으로 4건 깨뜨렸다).
  return s;
};
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
/** 그 낱말이 진행중 공구 어딘가(상품명·셀러명·핸들)에 실제로 있나.
 *  ⚠ 조회에 실패하면 true 를 준다 — 확실하지 않으면 낱말을 빼지 않는다(안전측). */
async function hasWord(w: string, today: string): Promise<boolean> {
  try {
    const e = encodeURIComponent("%" + w + "%");
    const r = await q(`gonggu?select=id&approved=eq.true&end_date=gte.${today}&or=(name.ilike.${e},influencer.ilike.${e},insta.ilike.${e})&limit=1`);
    return Array.isArray(r) ? r.length > 0 : true;
  } catch { return true; }
}
/** 그 낱말이 상품명에 몇 건이나 있나. 폴백에서 "어느 낱말이 핵심인가" 를 가르는 데 쓴다. */
async function countName(w: string, today: string): Promise<number> {
  try {
    const e = encodeURIComponent("%" + w + "%");
    const r = await fetch(
      `${SB}/rest/v1/gonggu?select=id&approved=eq.true&end_date=gte.${today}&name=ilike.${e}&limit=1`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" } });
    const cr = r.headers.get("content-range") || "";     // "0-0/37" 형식
    const n = Number(cr.split("/")[1]);
    return Number.isFinite(n) ? n : 9999;
  } catch { return 9999; }
}
/** 조건에 맞는 건수만 센다 (본문은 안 받는다). 못 세면 -1. */
async function countOf(path: string): Promise<number> {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" } });
    const cr = r.headers.get("content-range") || "";     // "0-0/37"
    const n = Number(cr.split("/")[1]);
    return Number.isFinite(n) ? n : -1;
  } catch { return -1; }
}
/**
 * 그 낱말이 **브랜드**인가 품목인가.
 * 🔑 브랜드는 상품명 **맨 앞**에 오고 품목은 안 온다 — 실측(2026-09-04):
 *      프레벨롱 10/10(100%) · 룩트 2/2 · 래폴드 1/1 · 뽀로로 5/8(63%)
 *      쌀 2/9(22%) · 휴대용 2/15(13%) · 물티슈·유산균·보관함·수납장·기저귀·간식 0%
 * 이 값으로 "쌀 보관함"(품목 폴백 금지)과 "프레벨롱 유산균"(브랜드 폴백 허용)이 갈린다.
 */
async function brandScore(w: string, today: string) {
  const base = `gonggu?select=id&approved=eq.true&end_date=gte.${today}&limit=1`;
  const all = await countOf(`${base}&name=ilike.${encodeURIComponent("%" + w + "%")}`);
  if (all <= 0) return { all, head: 0, ratio: 0 };
  const head = await countOf(`${base}&name=ilike.${encodeURIComponent(w + "%")}`);
  return { all, head, ratio: head > 0 ? head / all : 0 };
}
async function rpc(fn: string) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok ? await r.json() : [];
}
/**
 * 공구가 없을 때 핫딜에서 찾는다 (사장님 지시 2026-09-01)
 *   "뽀사카 공구는 없는데 오늘 공구 가격에 핫딜이 떴다" — 손님에게 그대로 쓸모 있는 답이다.
 * ⚠ 기간 지난 딜은 절대 안 보낸다(expires_at). 가격이 바뀌면 판매처 추적기가 그 카드를 만료시키므로 여기서 자동으로 빠진다.
 * 낱말이 여러 개면 제목에 **전부 들어간** 것만 (뽀로로 AND 사운드 → 사운드카드 딜만 잡힌다).
 */
async function findHotdeal(words: string[], today: string) {
  const nowIso = new Date().toISOString();
  const cands = [...new Set(words.map((w) => (w || "").trim()).filter((w) => w.length >= 2))].slice(0, 3);
  for (const phrase of cands) {
  // 🔑 공구 검색과 같은 이유로 한 글자도 넣는다 — 빼면 "쌀 보관함" 이 보관함만 걸려
  //    벨베이비 자석블럭(이름에 보관함이 들어간다)이 핫딜로 나갔다. 낱말끼리 AND 라 좁아진다.
  const HD1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
    const ws = phrase.split(/\s+/).filter((w) => w.length >= 2 || (w.length === 1 && !HD1.includes(w)));
    if (!ws.length) continue;
    const and = ws.map((w) => `title.ilike.${encodeURIComponent("%" + w + "%")}`).join(",");
    const cond = ws.length >= 2 ? `and=(${and})` : `title=ilike.${encodeURIComponent("%" + ws[0] + "%")}`;
    const hd = await q(`hotdeals?select=id,title,price,price_before,mall,link,deal_day,img_url&${cond}` +
      `&or=(expires_at.is.null,expires_at.gt.${nowIso})&order=id.desc&limit=1`) as any[];
    if (Array.isArray(hd) && hd.length && hd[0].link) {
      const d = hd[0];
      const won = (n: number) => Number(n || 0).toLocaleString("ko-KR") + "원";
      const isToday = String(d.deal_day || "") === today;
      return {
        basicCard: {
          // ⚠ thumbnail 은 카카오 basicCard 필수 항목이다 — 빠지면 말풍선이 미발송 처리된다(2026-09-02 실경고)
          thumbnail: { imageUrl: thumbOf(d.img_url) },
          title: "공구는 없지만 핫딜이 떴어요! 🔥",
          description: `${isToday ? "오늘 올라온 핫딜이에요\n\n" : ""}${d.title}\n${won(d.price)}${d.price_before ? ` (원래 ${won(d.price_before)})` : ""} · ${d.mall || ""}\n\n공구로는 안 열렸지만 이 값이면 공구 가격이에요.`.slice(0, 400),
          buttons: [
            { action: "webLink", label: "핫딜 보러가기", webLinkUrl: String(d.link) },
            { action: "webLink", label: "맘캘린더", webLinkUrl: SITE },
          ],
        },
      };
    }
  }
  return null;
}
async function aliases(): Promise<[string, string][]> {
  const rows = await q("bot_alias?select=term,expand");
  return (rows as any[]).map((r) => [String(r.term), String(r.expand)] as [string, string]);
}
// 사장님이 관리자 화면에서 확정한 말투 — 재배포 없이 즉시 반영된다 (bot_review_48.sql)
//   자동 학습은 오타만 배운다. "고마웡" 같은 말투는 사람이 판정해야 하고, 그 창구가 이것이다.
async function phrases(): Promise<[string, string][]> {
  const rows = await q("bot_phrase?select=term,kind");
  return (rows as any[]).map((r) => [String(r.term), String(r.kind)] as [string, string]);
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
  /(?:[?？!！~.,ㅋㅎㅠㅜ\s]|z{2,}|Z{2,})+$/,   // zzz=ㅋㅋㅋ (z 2개 이상만 — kidz 같은 브랜드 보호)
  /(뭐|머|모)\s*(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐)?$/,   // 오타 잇어 포함 (실제 손님)
  /(있|잇|읻)(어요|어|엉|음|나요|나|니|냐고|냐|는지)?$/,
  /(없|업)(어요|어|엉|음|나요|나|니)?$/,
  /알려\s*(주세요|주라|줄래|줘|죠|줭)?$/,
  /보여\s*(주세요|주라|줘|죠|줭)?$/,
  /말해\s*(봐|바|줘)?$/,
  /얘기\s*(해|해줘)?$/,
  /추천\s*(해)?\s*(주세요|줘|죠|줭)?$/,
  /찾아\s*(주세요|줘|죠|봐)?$/,
  /해\s*(주세요|주라|줘|죠|줭)$/,
  /(뭐야|머야|뭐임|뭔데|뭐가|머가|뭐|머)$/,
  /(종류|모음|관련|같은거|같은\s*거)$/,
  /(언제|어때|어떤|얼마|어디)\s*(해요|해용|하나요|하나|한대요|한대|함|해|야)?$/,   // "물티슈 언제해요?"
  /(냐고|라고|다고|인데|는데|건데|이야|임|이지|잖아)$/,
  /궁금\s*(해요|해용|해영|한데|하다|해|행)?$/,          // "물티슈 공구궁금해요!" (실제 손님)
  /(알고|보고|사고)\s*싶(어요|어|다|은데)?$/,
  /(어떤가요|어떨까요|없을까요|있을까요|될까요)$/,
  /(주세요|주라|줄래|줘요|줘)$/,
  /[♡♥❤️🩷💜🙏😊😀ㅡ]+$/,                                  // "…궁금해♡" 처럼 붙는 기호
  // ⚠ 이·만 은 넣지 말 것 — 브랜드 끝 글자를 조사로 먹는다 (2026-09-02, 닥터포이→닥터포)
  //   '이' 끝 16종 104건: 미스티파이·꼬메모이·돌잡이·팁토이조이·리즈파이·대발이·마더케이·길쭉담이 …
  //   '만' 끝: 실리만 → '실리' 로 깎이면 실리콘 상품까지 섞여 나온다
  //   어제 inpock_harvest 관형형 검사에서 고친 것과 같은 뿌리다(모윰 쪽쪽이 드롭 사고)
  // ⚠ 조사·짧은꼬리는 여기 두지 않는다 — 아래 CUT_TAILS 로 뺐다 (2026-09-02)
  //    브랜드 끝 글자를 먹기 때문이다. **깎기 전 판으로 먼저 찾고** 없을 때만 이걸 쓴다.
  /(인거|인것|하는거|되는거|인가|인가요|이야|예요|에요)$/,
  //   메쉬넵→메쉬 (2026-09-01) · 이치비야→이치비 (2026-09-02, 사장님 지적)
  //   "야" 로 끝나는 브랜드 8종: 이치비야·밧드야·하코야·요거모야·꽃게야·코코이찌방야·고새야
  //   "뭐야"·"얼마야" 는 위쪽 규칙이 이미 잡는다.
];
// 🔴 **말을 깎지 않는다** (사장님 지시 2026-09-02)
//   조사·짧은꼬리는 브랜드 끝 글자와 구별이 안 된다 — '닥터포이'→'닥터포' · '실리만'→'실리' 사고.
//   그래서 이것만 따로 뺐다. **깎기 전 판으로 먼저 찾고, 그래도 없을 때만** 이걸 쓴다.
//   규칙으로 자르는 게 아니라 DB 에 무엇이 있는지 보고 정한다 = 문맥 파악.
const CUT_TAILS: RegExp[] = [
  /(가|은|는|을|를|도)$/,   // "일정이" 에서 일정을 지운 뒤 남는 조사
  /(좀|요|용)$/,            // ⚠ 넵·넹·야 는 넣지 말 것 — 메쉬넵→메쉬 · 이치비야→이치비
];
// 말끝에 ㅇ 을 붙이는 말투를 벗긴다 — 고마웡→고마워 · 안뇽→안녕(X, 이건 목록) · 감사해용→감사해요 · 있엉→있어
//   ⚠ 마지막 글자에만 쓴다. 문장 전체에 쓰면 티니핑→티니피 처럼 브랜드가 깨진다 (사장님 지적한 유형)
function deJong(s: string) {
  const t = s.trim(); if (!t) return t;
  const c = t.charCodeAt(t.length - 1) - 0xAC00;
  if (c < 0 || c > 11171) return t;
  if (c % 28 !== 21) return t;                       // 21 = 받침 ㅇ
  return t.slice(0, -1) + String.fromCharCode(0xAC00 + (c - 21));
}

function stripTail(s: string, cut = true) {
  const list = cut ? [...TAILS, ...CUT_TAILS] : TAILS;
  let prev = "";
  for (let i = 0; i < 8 && s !== prev; i++) {
    prev = s;
    for (const re of list) s = s.replace(re, "").trim();
  }
  return s;
}
// cut=false 면 **조사를 안 뗀 판**을 준다 — 손님이 친 말에 더 가까운 쪽이다.
function keyword(u: string, cut = true) {
  let s = stripTail(u, cut);
  // 여기서 지우는 것은 **문장 부품**뿐이다. 브랜드가 될 수 있는 낱말은 절대 건드리지 않는다.
  //   ⚠ 전역 치환은 낱말 속까지 먹는다 — 머그컵→'그컵', 해담옥→'담옥' 사고(2026-09-01).
  //     그래서 어미·감탄사는 stripTail 이 **문장 끝에서만** 처리하고, 여기선 안전한 것만 지운다.
  s = s
    .replace(/이번\s*주에?|이번주|주간|오늘|내일|낼모레|낼|모레|요즘|지금|현재/g, " ")
    // 공궤·공귀 = 공구 오타 (2026-09-02 실제 손님: "노리터보드 공궤" → 못 찾고 다시 쳤다)
    .replace(/공동구매|공구|공궤|공귀|일정|소식|목록|리스트/g, " ")
    // 실제 손님 발화에서 나온 말 (2026-09-01: "오늘 공구 진행중인 제품 알려줘")
    .replace(/진행\s*중인|진행중|진행|하는\s*중|중인/g, " ")
    .replace(/제품|상품|물건|아이템|템/g, " ")
    .replace(/핫한|인기\s*있는|인기|괜찮은|새로운|저렴한/g, " ")
    .replace(/마지막\s*날|막날|마감|끝나는|끝나|종료|임박|오픈/g, " ")
    .replace(/바부야|바보야|아니고|아니라|말고|그리고|근데|좀/g, " ")
    .replace(/하는\s*곳|파는\s*곳|사는\s*곳|어디서|어디에|어디/g, " ")   // "공구하는곳 있어?" (실제 손님)
    .replace(/[?？!！.,~·\-_/]/g, " ")
    .replace(/\s+/g, " ").trim();
  // 🔴 여기서 cut 을 안 넘겨 **깎기 전 판(kwRaw)이 사실은 깎인 판**이었다 (2026-09-02)
  //    그래서 "오늘 하는 공구" → '하는' → 조사 '는' 이 떨어져 **'하'** 로 검색됐다.
  //    kwRaw 도 이 줄을 지나므로 우선검색·CUT_JUNK 가 통째로 무력했다.
  return stripTail(s, cut);   // 부품을 지운 뒤 다시 말끝 정리 ("소고기 뭐" → "소고기")
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
    const uz = deJong(u);   // 말끝 ㅇ 을 벗긴 판정용 사본 (고마웡→고마워)
    //   ⚠ uz 는 아래 인사 판정보다 먼저 정의해야 한다 — 늦게 두면 TDZ 로 전 요청 500 (2026-09-01 실사고, 2번째)
    const today = ymd(kst());

    if ((x=>/^(안녕|안뇽|안냥|하이|하잉|하영|헬로|할롱|hi|hello|반가|방가|도움|사용법|메뉴|뭐해|누구|넵|넹)/i.test(x))(u) || (x=>/^(안녕|안뇽|안냥|하이|하잉|하영|헬로|할롱|hi|hello|반가|방가|도움|사용법|메뉴|뭐해|누구|넵|넹)/i.test(x))(uz) || u.length < 1) return reply([text(HELP)]);

    // 인기 질문 ("젤 인기있는", "젤 핫한거", "조회수 많은거", "오늘의 탑텐") — 조회수+찜 합산 순
    const wantTop = /인기|젤\s|제일|가장|탑\s*텐|탑10|탑\s*10|top\s*10|톱텐|조회수|많이\s*본|베스트|best|순위|랭킹/i.test(u);
    const wantClose = /마감|끝나|종료|임박|막차|마지막\s*날/.test(u);
    const wantTomorrow = /내일|낼/.test(u);
    const wantWeek = /이번\s*주|이번주|주간/.test(u);
    const wantWeekend = /주말|토요일|일요일|토일/.test(u);
    const kw = keyword(u);
    const ph = await partnerHandles();

    const todayCards = async () => {
      const rows = await pick(`open_date=eq.${today}`, "order=id.desc", ph);
      if (!rows.length) return reply([text("오늘 오픈하는 공구가 아직 없어요. 아래 버튼에서 이번 주 일정을 볼 수 있어요!")]);
      return reply([cards(`오늘(${today.slice(5)}) 오픈 공구`, rows)]);
    };

    // ⓪-0 사장님이 판정해 둔 말투가 있으면 그것부터 (관리자 화면 🙋 검토)
    const ANS: Record<string, string> = {
      hello:  HELP,
      thanks: "도움이 됐다니 저도 좋아요 🙂\n공구 궁금할 땐 언제든 물어봐 주세요!",
      praise: "헤헤 감사합니다 🙂\n찾으시는 브랜드 이름을 말해주시면 공구 일정을 바로 알려드려요!",
      bye:    "네! 또 필요하면 불러주세요 🙂",
      love:   "나도 사랑해애액 ㅎㅎ 💜\n맘캘린더 많이 써주셔서 감사해요!",
    };
    try {
      const uu = u.replace(/\s/g, "").toLowerCase(), uzz = uz.replace(/\s/g, "").toLowerCase();
      for (const [term, kind] of await phrases()) {
        const t = term.replace(/\s/g, "").toLowerCase();
        if (t && (uu === t || uzz === t || uu.includes(t)) && ANS[kind]) return reply([text(ANS[kind])]);
      }
    } catch (_) { /* 못 읽어도 아래 기본 규칙으로 답한다 */ }

    // ⓪-a 인사·감사·칭찬에는 사람처럼 답한다 (손님이 실제로 이렇게 말한다)
    if ((x=>/고마워|고마와|고맙|감사|땡스|땡큐|thank|ㄱㅅ/i.test(x))(u) || (x=>/고마워|고마와|고맙|감사|땡스|땡큐|thank|ㄱㅅ/i.test(x))(uz)) {
      return reply([text("도움이 됐다니 저도 좋아요 🙂\n공구 궁금할 땐 언제든 물어봐 주세요!")]);
    }
    if ((x=>/우와|우왕|와우|대박|쩐다|좋다|좋아요|최고|짱|잘한다|똑똑|귀엽|신기/i.test(x))(u) || (x=>/우와|우왕|와우|대박|쩐다|좋다|좋아요|최고|짱|잘한다|똑똑|귀엽|신기/i.test(x))(uz)) {
      return reply([text("헤헤 감사합니다 🙂\n찾으시는 브랜드 이름을 말해주시면 공구 일정을 바로 알려드려요!")]);
    }
    if ((x=>/잘가|안녕히|바이|수고|굿밤|잘자|들어가|담에 봐|다음에 봐/i.test(x))(u) || (x=>/잘가|안녕히|바이|수고|굿밤|잘자|들어가|담에 봐|다음에 봐/i.test(x))(uz)) {
      return reply([text("네! 또 필요하면 불러주세요 🙂")]);
    }
    // 실제 손님이 이렇게 말했다 (2026-09-01 첫날 로그: "맘방사랑해") — 사장님 지시로 이스터에그
    if ((x=>/사랑해|사랑행|사랑합니다|좋아해|팬이|잘쓰고|잘 쓰고/i.test(x))(u) || (x=>/사랑해|사랑행|사랑합니다|좋아해|팬이|잘쓰고|잘 쓰고/i.test(x))(uz)) {
      return reply([text("나도 사랑해애액 ㅎㅎ 💜\n맘캘린더 많이 써주셔서 감사해요!")]);
    }

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
    // 한 글자("김")도 찾는다. 다만 한 글자는 셀러명까지 보면 오탐이 크니 상품명만 본다.
    const STOP1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
    // 문장 부품을 지우고 남은 찌꺼기는 브랜드가 아니다 — 이걸 검색하면 엉뚱한 안내가 나간다
    const STOPKW = ["되는거","하는거","되는것","하는것","되는","하는","임박","주말","토요일","일요일","평일","이번","다음","우리","그거","이거","저거","해줘","하는곳","파는곳","어디","언제","얼마","가격","알려","보여","추천"];
    // 부품을 지우고 숫자·기호만 남으면 브랜드가 아니다 (2026-09-02)
    //   "없는브랜드12345" 가 '5' 로 줄어 '5' 가 든 상품 20건을 뿌렸다 — 손님에겐 뜻 없는 답이다.
    //   '5차'(한글 있음)·'1+1'(3글자) 은 그대로 통과한다.
    const NUMONLY = kw.length <= 2 && !/[가-힣a-zA-Z]/.test(kw);
    // 🔴 **깎기 전 판을 맨 앞에 둔다** (사장님 지시 2026-09-02: "말을 깎는건 절대 안 된다")
    //   "닥터포이" 를 물으면 조사판은 '닥터포' 지만 깎기 전 판은 '닥터포이' 다.
    //   DB 에 '닥터포이' 가 있으면 그쪽에서 잡히고 조사판까지 가지 않는다.
    const kwRaw = keyword(u, false);
    // 🔴 **깎아서 만든 조각으로는 검색하지 않는다** (사장님 지적 2026-09-02)
    //   "오늘 하는 공구 알려줘" → 부품을 지우면 '하는', 조사 '는' 을 떼면 **'하'** 가 되어
    //   '하' 가 든 상품 20건이 나갔다. 날짜 의도('오늘')마저 무시됐다.
    //   ⚠ 목록을 늘려 막지 않는다 — 손님이 쓰는 말은 끝이 없다. 원칙으로 막는다.
    //   '김' 은 손님이 그렇게 친 말이라 통과한다(깎아서 나온 게 아니다).
    const CUT_JUNK = kw.length <= 2 && kwRaw !== kw;
    // 수량·단위만 남은 말은 상품이 아니다 — "1박스" 가 '햇 나주배 5kg 1박스' 를 물어왔다.
    //   ⚠ '1+1' 은 실제 상품 표기라 통과한다(숫자+단위 꼴이 아니다).
    const UNITONLY = /^[0-9]+\s*(박스|개입|개|팩|봉지|봉|캔|병|장|롤|매|구|입|세트|kg|g|ml|리터|인분|단계)$/i.test(kw);
    if (kw.length >= 1 && !NUMONLY && !CUT_JUNK && !UNITONLY && !(kw.length === 1 && STOP1.includes(kw)) && !STOPKW.includes(kw)) {
      const AL = await aliases();
      const tries = kwRaw && kwRaw !== kw ? [kwRaw, kw] : [kw];
      // 별칭은 두 번 푼다 — 줄임말 → 정식이름 → 표기변형 (사장님 지시 2026-09-02)
      //   "넘블은 넘버블럭스 넘버블록스 다 똑같은말이야 줄임말"
      //   한 번만 풀면 넘블 → 넘버블록스 에서 멈춰 넘버블럭스 표기 상품을 못 찾는다.
      const expand = (src: string[]) => {
        const out: string[] = [];
        for (const t of src) for (const [a, b] of AL) {
          if (t.includes(a)) out.push(t.split(a).join(b));
          if (t.includes(b)) out.push(t.split(b).join(a));
        }
        return out;
      };
      const p1 = expand(tries.slice());
      tries.push(...p1);
      // 손님이 말한 그대로 + 별칭 1단계 (대표 낱말로 넓히기 **전**의 목록) — 핫딜 우선 판단에 쓴다
      //   ⚠ 2단계 확장은 여기 넣지 않는다 — 넓어져서 공구를 찾기도 전에 핫딜이 먼저 나간다(실측).
      const specific = [...new Set(tries)];
      tries.push(...expand(p1));   // 2단계(표기변형)는 넓히기용
      // 수식어는 **사전으로** 뗀다 — 깎는 게 아니다 (사장님 지시 2026-09-02)
      //   "아기물티슈" → '물티슈' 는 정당하지만 "알테리" → '테리' 는 브랜드를 죽인다.
      //   차이는 **아는 말만 떼느냐** 다. 사전에 없는 글자는 절대 건드리지 않는다.
      //   ⚠ 넓히기 단계에만 넣는다 — 정확검색에 넣으면 '아기상어' 공구에 '상어' 가 섞인다.
      const MODIFIERS = ["신생아", "어린이", "우리아이", "유아용", "아기", "유아", "아이", "키즈", "엄마"];
      for (const t of [...new Set(tries)]) {
        for (const m of MODIFIERS) {
          if (t.startsWith(m) && t.length > m.length + 1) { tries.push(t.slice(m.length).trim()); break; }
        }
      }
      // 별칭이 여러 낱말이면 대표 낱말로도 찾는다 — 뽀사카→"뽀로로 사운드" 가 0건이던 것 (2026-09-01)
      //   그 조합의 공구가 없어도 손님이 원하는 건 그 브랜드다.
      for (const t of tries.slice(1)) {   // ⚠ 0번(손님 말 원본)은 제외 — 넣으면 첫 낱말로만 검색된다
        const parts = t.split(/\s+/).filter((w) => w.length >= 2);
        // 손님 말이 원래 한 낱말일 때만 (뽀사카→"뽀로로 사운드"→뽀로로).
        //   원래 두 낱말이면 적용하면 안 된다 — '신생아 기저귀' 이 '신생아' 로만 검색된다(실사고)
        if (parts.length >= 2 && kw.split(/\s+/).filter((w) => w.length >= 2).length < 2) tries.push(parts[0]);
      }
      // 줄임말(글자 사이 열기)은 **한글일 때만**. 영문에 쓰면 성긴 패턴이 아무 문장에나 걸린다.
      //   실사고 2026-09-02: 'Keen' → %k%e%e%n% → "Scholastic Picture Book Garden Collection"
      const hangulOnly = /^[가-힣]+$/.test(kw);
      if (hangulOnly && kw.length >= 3 && kw.length <= 5) tries.push("__ABBR__" + kw);

      // 🔴 검색 순서 (사장님 지시 2026-09-01)
      //   ① 손님이 말한 그대로·별칭 그대로 공구를 찾는다 (뽀사카 → "뽀로로 사운드")
      //   ② 없으면 **핫딜을 먼저 본다** — "공구는 없는데 오늘 공구 가격에 핫딜이 떴다" 가 손님에게 진짜 답이다
      //   ③ 그래도 없으면 대표 낱말로 넓힌다 (뽀로로 → 뮤직하우스·카메라…)
      //   ⚠ ②를 ③보다 뒤에 두면 안 된다 — 뽀사카를 물었는데 뽀로로 여행패키지가 나간다(실측 2026-09-01)
      const searchGonggu = async (list: string[]) => {
        // 표기가 달라도 같은 말이면 결과가 같아야 한다 → 후보를 전부 돌며 합친다 (중복 id 제거)
        const merged: any[] = []; const mseen = new Set<number>();
        // ⏱ 카카오는 늦으면 "폴백 스킬 오류" 를 낸다 → 1.8초 넘으면 지금까지 찾은 것으로 답한다
        const t0 = Date.now();
        for (const t of [...new Set(list)].slice(0, 8)) {   // 후보 상한 8개
          // 낱말이 둘 이상이면 낱말마다 ilike 를 AND 로 건다 (통째 매칭은 절대 안 걸린다)
          // 🔑 한 글자도 넣는다 — 빼면 "쌀 보관함" 이 '보관함' 만 검색돼 장난감 보관함이 나간다.
          //    낱말끼리는 AND 라 조건이 늘수록 좁아진다(느슨해지지 않는다).
          //    뜻 없는 한 글자(거·것·게…)만 STOP1 으로 뺀다.
          const WORD1 = ["거","것","걸","게","요","좀","수","때","분","개","중","등","및","이","그","저"];
          const ws = t.startsWith("__ABBR__") ? []
            : t.split(/\s+/).filter((w) => w.length >= 2 || (w.length === 1 && !WORD1.includes(w)));
          let cond: string;
          if (ws.length >= 2) {
            cond = ws.map((w) => {
              const e = encodeURIComponent("%" + w + "%");
              return `or(name.ilike.${e},influencer.ilike.${e},insta.ilike.${e})`;
            }).join(",");
            cond = `end_date=gte.${today}&and=(${cond})`;
          } else {
            const base = ws.length === 1 ? ws[0] : t;   // 짧은 낱말이 떨어져 나가면 남은 낱말로 찾는다
            const pat = t.startsWith("__ABBR__") ? "%" + t.slice(8).split("").join("%") + "%" : `%${base}%`;
            const enc = encodeURIComponent(pat);
            // 줄임말(__ABBR__)은 글자 사이를 여는 성긴 패턴이라 셀러 핸들에 걸면 엉뚱한 게 잡힌다.
            //   실사고 2026-09-02: 'Keen' → %K%e%e%n% → insta 'keepgoing_becky' → 자숙문어
            const nameOnly = base.length <= 1 || t.startsWith("__ABBR__");
            cond = nameOnly
              ? `end_date=gte.${today}&name=ilike.${enc}`
              : `end_date=gte.${today}&or=(name.ilike.${enc},influencer.ilike.${enc},insta.ilike.${enc})`;
          }
          let rows = await pick(cond, "order=open_date.asc", ph);
          // 🔴 **DB 에 아예 없는 낱말은 조건에서 뺀다** (사장님 승인 2026-09-04)
          //   실사고: "루솔 도라지배즙" 은 '루솔' 9건이 진행중인데 '도라지배즙' 이
          //   상품명 어디에도 없어 AND 가 통째로 0건이 됐다. 손님은 그냥 떠났다.
          //   ⚠ **낱말이 전부 DB 에 있으면 그대로 0건을 유지한다** —
          //     "쌀 보관함"(쌀·보관함 둘 다 있다)이 장난감 보관함을 물어오던 사고를 막는 선이 이것이다.
          //     사장님: "쌀보관함은 없으면 없는거니까 없다고 해야지"
          //   ⚠ AND 결과가 0건일 때만 돈다 → 평소 회차엔 조회 비용이 0이다.
          // ⚠ **손님이 친 말일 때만** 뺀다 (2026-09-04 실사고).
          //    별칭 확장판("휴대용 물팃")에 적용하면 우리가 만든 낱말이 빠지면서
          //    '휴대용' 만 남아 바브레 휴대용 변기가 나갔다 — 쌀보관함과 같은 유형이다.
          const ownWords = (t === kw || t === kwRaw);
          if (ownWords && !rows.length && ws.length >= 2 && ws.length <= 4 && Date.now() - t0 < 1200) {
            const keep: string[] = [];
            for (const w of ws) if (await hasWord(w, today)) keep.push(w);
            if (keep.length && keep.length < ws.length) {
              const c2 = keep.map((w) => {
                const e2 = encodeURIComponent("%" + w + "%");
                return `or(name.ilike.${e2},influencer.ilike.${e2},insta.ilike.${e2})`;
              }).join(",");
              rows = await pick(`end_date=gte.${today}&and=(${c2})`, "order=open_date.asc", ph);
            }
          }
          // 낱말을 다 만족하는 게 없으면 **낱말 하나씩이라도** 걸리는 것을 찾는다 (사장님 지시 2026-09-02)
          //   "이유식 스푼" 은 그런 상품명이 없지만 손님이 찾는 건 이유식기다 — 없다고 하면 안 된다.
          for (const r of rows) { if (!mseen.has(r.id)) { mseen.add(r.id); merged.push(r); } }
          if (merged.length >= MAX_SHOW) break;
          if (Date.now() - t0 > 1800) break;   // 시간 초과 — 늦은 답보다 지금 답이 낫다
        }
        // 🔴 여기 있던 "낱말 하나씩 OR 검색" 을 걷어냈다 (사장님 지시 2026-09-02).
        //    "쌀 보관함" 에 낱말 '보관함' 만 걸려 **아오라 장난감 보관함**이 나갔다.
        //    사장님: "없으면 없는거니까 없다고 해야지 장난감보관함을 보여주면 어케"
        //    → 없는 것은 없다고 한다. 넓혀야 하는 말은 **bot_alias** 로 관리한다
        //      ("이유식 스푼 → 이유식기" 는 이미 별칭 17개로 들어가 있다. 배포도 필요 없다).
        // 낱말을 다 만족하는 게 없어도 **손님 말에 브랜드가 들어 있으면** 그 브랜드를 보여준다.
        //   사장님 지적(2026-09-04): "프레벨롱은 명확히 있는 거고 룩트도 명확한 브랜드가 있는건데
        //   쌀보관함이랑 니가 다르게 판단해야지"
        //   ⚠ 품목 낱말로는 절대 폴백하지 않는다 — '쌀 보관함' 에 장난감 보관함이 나간 사고 그대로다.
        if (!merged.length) {
          const raw = [...new Set(list)].find((x) => !x.startsWith("__ABBR__")) || "";
          const cand = raw.split(" ").filter((w) => w.length >= 2).slice(0, 3);
          if (cand.length >= 2 && Date.now() - t0 < 1200) {
            const scored: { w: string; ratio: number; all: number }[] = [];
            for (const w of cand) {
              if (Date.now() - t0 > 1500) break;
              const sc = await brandScore(w, today);
              // 브랜드 판정: 맨 앞에 한 번이라도 오고, 그 비율이 절반 이상
              if (sc.head >= 1 && sc.ratio >= 0.5) scored.push({ w, ratio: sc.ratio, all: sc.all });
            }
            // 브랜드가 여럿이면 더 뚜렷한 쪽(맨앞비율 높고, 그다음 더 특정적인 쪽)
            scored.sort((a, b) => (b.ratio - a.ratio) || (a.all - b.all));
            for (const { w } of scored) {
              if (Date.now() - t0 > 1700) break;
              const e = encodeURIComponent("%" + w + "%");
              const r2 = await pick(`end_date=gte.${today}&name=ilike.${e}`, "order=open_date.asc", ph);
              for (const r of r2) { if (!mseen.has(r.id)) { mseen.add(r.id); merged.push(r); } }
              if (merged.length >= MAX_SHOW) break;
            }
          }
        }
        if (!merged.length) return null;
        // 손님이 친 낱말이 **상품명**에 있는 것을 먼저 보여준다.
        //   실사고 2026-09-02: '우유' 를 물었는데 셀러 '우유맘' 의 리프팅크림이 1번으로 나갔다.
        //   ⚠ 집합에서 빼지는 않는다 — "우유맘 공구 알려줘" 는 계속 되어야 하므로 순서만 세운다.
        const qw = ([...new Set(list)].find((x) => !x.startsWith("__ABBR__")) || "")
          .split(" ").filter((w) => w.length >= 2).map((w) => norm(w));
        // 손님 낱말을 **몇 개나 맞췄는지**로 센다. 낱말이 통째로 있으면 2점,
        //   앞부분만 겹쳐도 1점('사운드북' ↔ '사운드카드'). 브랜드 폴백에서 순서를 가른다.
        //   실사고 2026-09-04: '뽀로로 사운드북' 1번이 "경주 켄싱턴+뽀로로 PKG 특가" 였다.
        const wordScore = (g: any) => {
          const nm = norm(g.name); let sc = 0;
          for (const w of qw) {
            if (nm.includes(w)) { sc += 2; continue; }
            for (let L = w.length - 1; L >= 2; L--) { if (nm.includes(w.slice(0, L))) { sc += 1; break; } }
          }
          return sc;
        };
        // 맘캘린더·이웃셀러 공구는 무조건 맨 앞 (사장님 규칙) — 합치면서 섞이므로 다시 세운다
        merged.sort((a, b) =>
          ((a.__p ? 0 : 1) - (b.__p ? 0 : 1)) || (wordScore(b) - wordScore(a)));
        return merged.slice(0, MAX_SHOW);
      };

      const exact = await searchGonggu(specific.length ? specific : tries);
      if (exact) return reply([cards(`'${kw}' 공구 일정`, exact)]);

      // ② 핫딜 — 공구가 없으면 **핫딜에 있는지 본다** (사장님 지시 2026-09-02)
      //   🔴 2026-09-02: 뽀사카 하드코딩을 걷어냈다 (사장님 지시 "핫딜에 있으면 있다고 알려줘").
      //   핫딜에 멀쩡히 있는데 "공구 없어요" 가 나가고 있었다 —
      //   해담옥(손님이 9번 물음)·삼다수·칠성사이다·일리윤·한예지 전부 그랬다.
      {
        // 별칭 푼 말까지 넣는다. 손님이 친 말 그대로가 먼저다.
        const hdWords = [...new Set([kwRaw, kw, ...specific])].filter((x) => x && !String(x).startsWith("__ABBR__"));
        const hdCard = await findHotdeal(hdWords, today);
        if (hdCard) return reply([hdCard]);
      }

      // ③ 대표 낱말까지 넓혀서 다시
      const wide = await searchGonggu(tries);
      if (wide) return reply([cards(`'${kw}' 공구 일정`, wide)]);
      // 🔴 여기 있던 `bot_subword`(글자 조각 검색)를 걷어냈다 (사장님 지시 2026-09-02)
      //    "말을 깎는건 절대 해서는 안되는거야 문맥을 파악해야지"
      //    알테리→'테리' · 머그컵→'컵' 처럼 브랜드가 통째로 죽었다.
      //    합성어(아기곰탕→곰탕)는 **bot_alias 로** 관리한다 — 한 곳에서 보고 재배포도 필요 없다.

      // ⚠ 여기 있던 "뒤 낱말 재시도" 는 걷어냈다 (2026-09-02 검증).
      //    "이유식 스푼" 에서 뒤 낱말 스푼 을 고르니 애플스푼 배도라지즙·스푼풀 오메가3 가 나갔다 —
      //    브랜드명에 그 글자가 든 것까지 걸린다. 손님이 바꿔 쳐서 성공한 말은 이유식기(앞 낱말)였다.
      //    그 자리를 대신하던 낱말 OR 합집합도 2026-09-02 에 걷어냈다(엉뚱한 답을 냈다).
      //    지금 이 일을 하는 것은 **bot_alias** 하나뿐이다 — 넓힐 말은 거기에 넣는다.

      // 못 찾은 검색어를 쌓는다 — 이걸 보고 bot_alias 와 위 말버릇 목록을 채운다 (학습 루프)
      try {
        fetch(`${SB}/rest/v1/events`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ event_type: "kakao_bot_miss", event_data: `${kw} <= ${u}`.slice(0, 70) }) });
      } catch (_) { /* 무시 */ }
      // 없다고만 하지 않고 "혹시 이거?" 로 되묻는다 (bot_guess RPC — 오타·긴말 대응, 2026-09-01)
      let hint = "";
      try {
        const g = await fetch(`${SB}/rest/v1/rpc/bot_guess`, { method: "POST",
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_kw: kw }) });
        const gw = ((await g.json()) as any[]).map((x) => x.word).filter(Boolean).slice(0, 3);
        if (gw.length) hint = `

혹시 ${gw.map((w) => `'${w}'`).join(" · ")} 찾으셨을까요? 그대로 한번 보내보세요!`;
      } catch (_) { /* 되묻기 실패해도 안내는 나간다 */ }
      // 진행 중이 없어도 **다룬 적이 있으면** 그렇게 말한다 (2026-09-02)
      //   "선풍기" 는 DB 에 44건 있는데 전부 마감이라 손님에겐 "없어요" 만 나갔다.
      //   사이트는 이미 지난 공구를 보여준다(showPastResults) — 챗봇만 빠져 있었다.
      //   ⚠ 카드로 주지 않는다. 마감된 것을 눌러 들어가면 헛걸음이 된다 → 이름·날짜만 글로.
      try {
        const ep = encodeURIComponent("%" + kw + "%");
        const past = await q(`gonggu?select=name,influencer,open_date&approved=eq.true&name=ilike.${ep}`
          + `&end_date=lt.${today}&order=open_date.desc&limit=3`);
        if (Array.isArray(past) && past.length) {
          const li = past.map((p: any) => {
            const d = String(p.open_date || "").slice(5).replace("-", "/");
            return `· ${p.name}${p.influencer ? " — " + p.influencer : ""}${d ? " (" + d + ")" : ""}`;
          }).join("\n");
          return reply([text(`'${kw}' 공구는 지금 진행 중인 게 없어요.\n\n지난번에는 이런 게 있었어요\n${li}\n\n다시 열리면 맘캘린더에 바로 올라와요!`)]);
        }
      } catch (_) { /* 실패해도 아래 기본 안내가 나간다 */ }
      return reply([text(`'${kw}' 공구는 지금 진행 중이거나 예정인 게 없어요.
아래 버튼으로 전체 일정에서 찾아보실 수 있어요!${hint}`)]);
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
    // 주말: 이번 주 토·일에 오픈하는 공구 (실제 손님이 "주말 공구" 라고 묻는다)
    if (wantWeekend) {
      const d = kst(); const dow = d.getDay();
      const sat = new Date(d); sat.setDate(d.getDate() + ((6 - dow) + 7) % 7);
      const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
      const rows = await pick(`open_date=gte.${ymd(sat)}&open_date=lte.${ymd(sun)}`, "order=open_date.asc", ph);
      if (!rows.length) return reply([text("이번 주말에 오픈하는 공구가 아직 없어요.\n아래 버튼에서 이번 주 일정을 볼 수 있어요!")]);
      return reply([cards("이번 주말 오픈 공구", rows)]);
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

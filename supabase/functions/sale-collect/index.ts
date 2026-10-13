// ══════════════════════════════════════════════════════════
//  sale-collect  —  인터넷 뉴스에서 세일·행사 일정 「후보」를 모아 sale_events 에 쌓는다 (2026-10-13 사장님 지시
//                   "내가 보낸 거 외에 니가 더 인터넷에서 끌어서 모아봐, 앞으로 주기적으로")
//
//  흐름  브랜드별 구글뉴스 RSS(최근 N일) → 기사 원문 주소 복호화(batchexecute) → 본문 문장에서
//        「브랜드 + 기간(M월 D일~M월 D일 · N일부터 M일까지 · 10.12~10.21)」 추출 → 기존 행과 중복 제거 → 후보 저장
//  규칙  날짜는 정규식만(AI 비용 없음). 연·월은 기사 발행일로 푼다. 명시적 기간(시작·끝 둘 다)이 있는 문장만 인정.
//  🔴 저장은 항상 approved=false — 기사에서 뽑은 날짜는 사실이 아니라 「후보」다. 사이트·푸시에 안 나간다.
//     note 에 근거 문장·기사 주소·근거 기사 수가 들어간다. 승인: update public.sale_events set approved=true where id in (…)
//     (사장님이 직접 넣은 행과 겹치면(같은 브랜드·시작 ±3일 또는 종료일 같음) 넣지 않는다)
//  호출  POST /functions/v1/sale-collect   헤더 x-cron-secret
//        ?dry=1            저장하지 않고 후보 표만 돌려준다 (첫 실행은 반드시 dry)
//        ?batch=0&of=4     브랜드를 of 개 묶음으로 나눠 batch 번째만 (Edge CPU 제한 때문에 크론은 4번 나눠 부른다)
//        ?brands=올리브영,무신사   지정한 브랜드만   ?n=3 브랜드당 기사 수   ?days=14 기간
//  주기  pg_cron `sale-collect-0..3` 매일 UTC 15:20/15:25/15:30/15:35 (한국 00:20~) — supabase/sql/sale_collect_87.sql
//  ⚠ 0건 = 패턴을 못 맞춘 것일 수 있다 — 기사 원문을 열어 확인할 것(수확기 0건 ≠ 일정 없음).
//  ⚠ 구글뉴스 복호화(batchexecute)는 비공식 경로다. 막히면 errors 에 decode 실패가 쌓인다 → tools/daily 로 옮길 것.
// ══════════════════════════════════════════════════════════
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

type Brand = { name: string; slug: string; alias: string[]; url: string; aff?: string };
// 이름 정규화(별칭 → 대표명)·공식 주소·수익링크 머천트(링크프라이스 통과 확인분만)
const BRANDS: Brand[] = [
  { name: "올리브영", slug: "oliveyoung", alias: ["올리브영", "올영", "CJ올리브영"], url: "https://www.oliveyoung.co.kr/" },
  { name: "무신사", slug: "musinsa", alias: ["무신사"], url: "https://www.musinsa.com/" },
  { name: "지그재그", slug: "zigzag", alias: ["지그재그"], url: "https://zigzag.kr/" },
  { name: "에이블리", slug: "ably", alias: ["에이블리"], url: "https://a-bly.com/" },
  { name: "자라", slug: "zara", alias: ["자라", "ZARA", "Zara"], url: "https://www.zara.com/kr/" },
  { name: "유니클로", slug: "uniqlo", alias: ["유니클로"], url: "https://www.uniqlo.com/kr/ko/" },
  { name: "탑텐", slug: "topten", alias: ["탑텐", "탑텐몰"], url: "https://topten10.goodwearmall.com/" },
  { name: "에잇세컨즈", slug: "8seconds", alias: ["에잇세컨즈"], url: "https://www.ssfshop.com/8seconds/main" },
  { name: "롯데온", slug: "lotteon", alias: ["롯데온"], url: "https://www.lotteon.com/", aff: "lotteon" },
  { name: "11번가", slug: "11st", alias: ["11번가"], url: "https://www.11st.co.kr/", aff: "11st" },
  { name: "G마켓", slug: "gmarket", alias: ["G마켓", "지마켓"], url: "https://www.gmarket.co.kr/", aff: "gmarket" },
  { name: "옥션", slug: "auction", alias: ["옥션"], url: "https://www.auction.co.kr/", aff: "auction" },
  { name: "SSG닷컴", slug: "ssg", alias: ["SSG닷컴", "SSG.COM", "쓱닷컴", "신세계"], url: "https://www.ssg.com/" },
  { name: "쿠팡", slug: "coupang", alias: ["쿠팡"], url: "https://www.coupang.com/" },
  { name: "컬리", slug: "kurly", alias: ["컬리", "마켓컬리"], url: "https://www.kurly.com/" },
  { name: "이마트", slug: "emart", alias: ["이마트", "이마트몰"], url: "https://www.emart.com/" },
  { name: "홈플러스", slug: "homeplus", alias: ["홈플러스"], url: "https://www.homeplus.co.kr/" },
  { name: "롯데마트", slug: "lottemart", alias: ["롯데마트"], url: "https://www.lottemart.com/" },
  { name: "다이소", slug: "daiso", alias: ["다이소"], url: "https://www.daisomall.co.kr/" },
  { name: "H&M", slug: "hm", alias: ["H&M", "에이치앤엠"], url: "https://www2.hm.com/ko_kr/" },
  { name: "스파오", slug: "spao", alias: ["스파오"], url: "https://spao.com/" },
  { name: "아디다스", slug: "adidas", alias: ["아디다스"], url: "https://www.adidas.co.kr/" },
  { name: "나이키", slug: "nike", alias: ["나이키"], url: "https://www.nike.com/kr/" },
  { name: "네이버쇼핑", slug: "naver", alias: ["네이버쇼핑", "네이버 쇼핑", "네이버플러스 스토어"], url: "https://shopping.naver.com/" },
];
// 기사에서 행사 이름·성격을 알아보는 낱말
const CUE = /(세일|페스타|페스티벌|데이|위크|특가|할인|감사제|축제|기획전|프로모션|이벤트|블랙프라이데이|블프|쇼핑|결산|빅세일|대전|행사)/;
const NAMECUE = /(세일|페스타|페스티벌|데이|위크|특가|감사제|축제|기획전|블랙프라이데이|블프|쇼핑|결산|딜|대전|시즌오프|프라이데이)/;

// 행사 이름으로 직접 찾는 검색어 — 브랜드명이 문장에 없어도 별칭 사전으로 브랜드를 가린다
const EVENT_QUERIES = ["올영세일", "올리브영 올영데이", "무신사 무진장 블랙프라이데이", "11번가 십일절", "빅스마일데이", "쓱데이", "쿠팡 로켓 와우 세일", "컬리 블랙프라이데이", "코리아세일페스타", "블랙프라이데이 국내 세일 일정", "11월 쇼핑 행사 일정 이커머스", "연말 세일 일정 유통", "광군제 이커머스 행사"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const todayKST = () => ymd(kst(new Date()));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
function validYMD(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return ymd(dt);
}
const decodeEnt = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&nbsp;/g, " ");

// ── 구글뉴스 RSS ──
type Item = { title: string; link: string; pub: string; source: string };
async function rss(q: string, days: number): Promise<Item[]> {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=ko&gl=KR&ceid=KR:ko`;
  const r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error("rss " + r.status);
  const x = await r.text();
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const g = (t: string) => decodeEnt((m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "");
    return { title: g("title"), link: g("link"), pub: g("pubDate"), source: g("source") };
  });
}
// 구글뉴스 링크 → 언론사 원문 주소
async function decode(link: string): Promise<string> {
  const id = (link.match(/articles\/([^?/]+)/) || [])[1];
  if (!id) throw new Error("no id");
  const page = await (await fetch(`https://news.google.com/rss/articles/${id}?hl=ko&gl=KR&ceid=KR:ko`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) })).text();
  const sg = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) throw new Error("decode: sg/ts 없음(구글 응답 형식 바뀜?)");
  const inner = `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`;
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA }, body, signal: AbortSignal.timeout(8000),
  });
  const t = await r.text();
  const m = t.match(/garturlres[^h]*(https?:\/\/[^"\\]+)/);
  if (!m) throw new Error("decode: url 없음");
  return m[1];
}
// 본문 텍스트 — <p> 만 모아 CPU 를 아낀다(없으면 앞 150KB 를 통째로)
async function articleText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error("article " + r.status);
  const h = (await r.text()).slice(0, 400000);
  const ps = [...h.matchAll(/<p[\s>][\s\S]*?<\/p>/g)].map((m) => m[0]);
  const raw = ps.length >= 3 ? ps.join("\n") : h.slice(0, 150000);
  return decodeEnt(raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "\n"));
}

// ── 문장에서 기간 뽑기 ──
type Range = { start: string; end: string; raw: string };
function extractRanges(sentence: string, pub: Date): Range[] {
  const out: Range[] = [];
  const pk = kst(pub), py = pk.getUTCFullYear(), pm = pk.getUTCMonth() + 1, pd = pk.getUTCDate();
  const pubStr = ymd(pk);
  const push = (sy: number, sm: number, sd: number, em: number, ed: number, raw: string) => {
    let s = validYMD(sy, sm, sd); if (!s) return;
    // 발행일보다 두 달 넘게 과거면 다음 해 이야기(12월 기사의 1월 세일)
    if (dayDiff(s, pubStr) < -60) { s = validYMD(sy + 1, sm, sd); if (!s) return; }
    const sy2 = Number(s.slice(0, 4));
    let ey = sy2; if (em < sm) ey = sy2 + 1;
    const e = validYMD(ey, em, ed); if (!e || e < s) return;
    out.push({ start: s, end: e, raw });
  };
  let m: RegExpExecArray | null;
  // ① 12일부터 21일까지 / 12일~21일 (월 없음 → 발행 월)
  const R2 = /(?<![\d월.\/])(\d{1,2})일\s*(?:\([^)]{1,4}\))?\s*(?:부터|~|∼|-|–)\s*(\d{1,2})일(?!\s*째)/g;
  // ② 10월 12일(월)~10월 21일 / 11월 1일부터 11일까지
  const R1 = /(\d{1,2})월\s*(\d{1,2})일\s*(?:\([^)]{1,4}\))?\s*(?:부터|~|∼|-|–)\s*(?:(\d{1,2})월\s*)?(\d{1,2})일/g;
  // ③ 10.12~10.21 / 10/12~10/21 (가격·소수 오인을 줄이려 앞뒤 숫자 금지)
  const R3 = /(?<![\d.])(\d{1,2})[./](\d{1,2})\s*(?:\([^)]{1,4}\))?\s*(?:~|∼|-|–)\s*(?:(\d{1,2})[./])?(\d{1,2})(?![\d.])/g;
  const used: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) => used.some(([x, y]) => a < y && b > x);
  while ((m = R1.exec(sentence))) {
    used.push([m.index, m.index + m[0].length]);
    const sm = +m[1], sd = +m[2], em = m[3] ? +m[3] : sm, ed = +m[4];
    push(py, sm, sd, em, ed, m[0]);
  }
  while ((m = R3.exec(sentence))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const sm = +m[1], sd = +m[2], em = m[3] ? +m[3] : sm, ed = +m[4];
    if (sm > 12 || em > 12) continue;
    used.push([m.index, m.index + m[0].length]);
    push(py, sm, sd, em, ed, m[0]);
  }
  while ((m = R2.exec(sentence))) {
    if (overlaps(m.index, m.index + m[0].length)) continue;
    const sd = +m[1], ed = +m[2];
    if (ed < sd) { push(py, pm === 12 ? 12 : pm, sd, pm === 12 ? 12 : pm + 1, ed, m[0]); continue; }
    // 발행일보다 한참 앞선 일(20일↑)은 다음 달 이야기
    let sm = pm, sy = py;
    if (sd < pd - 20) { sm = pm + 1; if (sm > 12) { sm = 1; sy = py + 1; } }
    push(sy, sm, sd, sm, ed, m[0]);
  }
  return out;
}
function eventName(sentence: string, brand: Brand): string {
  const q = [...sentence.matchAll(/[‘'“"「『<《]([^’'”"」』>》]{2,26})[’'”"」』>》]/g)].map((x) => x[1].trim());
  const hit = q.find((x) => NAMECUE.test(x) && !brand.alias.includes(x));
  if (hit) return hit.replace(new RegExp("^(" + brand.alias.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\s*"), "").trim() || hit;
  // 낱말 하나(세일·페스타·데이 …로 끝남) + 앞에 계절어가 있으면 같이: 「하반기 넾다세일」 → 「하반기 넾다세일」, 「스토어의 하반기 넾다세일」 → 「하반기 넾다세일」
  const m = sentence.match(/((?:상반기|하반기|가을|겨울|봄|여름|연말|신학기|추석|설|블랙|블프)\s)?([가-힣A-Za-z0-9]{2,10}(?:세일|페스타|페스티벌|데이|위크|감사제|축제|특가전|기획전|프라이데이))/);
  if (m) {
    const n = ((m[1] || "") + m[2]).trim();
    if (!brand.alias.includes(n) && n.length >= 2) return n;
  }
  return "행사";
}
function splitSentences(text: string): string[] {
  return text.split(/\n+|(?<=[.?!”’")\]])\s+(?=[가-힣A-Z0-9“‘"'\[])/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 10 && s.length <= 400);
}

type Cand = { brand: Brand; title: string; start: string; end: string; evidence: string; url: string; pubTitle: string; srcKey: string };

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) return json({ ok: false, msg: "unauthorized" }, 401);
  const u = new URL(req.url);
  const dry = u.searchParams.get("dry") === "1";
  const days = Math.min(30, Math.max(3, Number(u.searchParams.get("days") || 14)));
  const nArt = Math.min(6, Math.max(1, Number(u.searchParams.get("n") || 3)));
  const batch = Number(u.searchParams.get("batch") || 0), of = Math.max(1, Number(u.searchParams.get("of") || 1));
  const only = (u.searchParams.get("brands") || "").split(",").map((s) => s.trim()).filter(Boolean);
  let list = BRANDS.filter((_, i) => i % of === batch % of);
  if (only.length) list = BRANDS.filter((b) => only.some((o) => b.alias.includes(o) || b.name === o));
  const today = todayKST();
  const errors: string[] = [];
  const debug = u.searchParams.get("debug") === "1";
  const trace: string[] = [];
  const stat = { brands: list.length, rss: 0, articles: 0, decoded: 0, textOk: 0, sentences: 0, ranges: 0 };

  // 기존 행(사장님이 넣은 것 포함) — 중복 판단용
  let existing: { brand: string; start_date: string; end_date: string }[] = [];
  try {
    const r = await fetch(`${SB_URL}/rest/v1/sale_events?select=brand,start_date,end_date&limit=1000`, { headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}` } });
    existing = await r.json();
  } catch (e) { errors.push("existing: " + String(e).slice(0, 80)); }
  const aliasToName = (b: string) => BRANDS.find((x) => x.alias.includes(b) || x.name === b)?.name || b;
  const dupOfExisting = (name: string, s: string, e: string) =>
    existing.some((x) => aliasToName(x.brand) === name && x.start_date && (Math.abs(dayDiff(x.start_date, s)) <= 3 || (x.end_date && x.end_date === e)));

  const cands: Cand[] = [];
  const seenArticle = new Set<string>();
  // b 가 null 이면(행사명 검색) 문장에 나온 별칭으로 브랜드를 가린다
  async function doQuery(label: string, q: string, b: Brand | null, take: number) {
    let items: Item[] = [];
    try { items = await rss(q, days); stat.rss++; } catch (e) { errors.push(`${label} rss: ${String(e).slice(0, 60)}`); return; }
    const pick = items.filter((i) => i.link && !seenArticle.has(i.link)).slice(0, take);
    for (const it of pick) {
      seenArticle.add(it.link); stat.articles++;
      let url = "", text = "";
      try { url = await decode(it.link); stat.decoded++; } catch (e) { errors.push(`${label} decode: ${String(e).slice(0, 70)}`); continue; }
      try { text = await articleText(url); stat.textOk++; } catch (e) { errors.push(`${label} article: ${String(e).slice(0, 60)}`); continue; }
      const pubDate = new Date(it.pub || Date.now());
      const sents = splitSentences(text); stat.sentences += sents.length;
      for (const s of sents) {
        if (!CUE.test(s)) continue;
        const bb = b ? (b.alias.some((a) => s.includes(a)) ? b : null) : (BRANDS.find((x) => x.alias.some((a) => s.includes(a))) || null);
        if (!bb) continue;
        for (const r of extractRanges(s, pubDate)) {
          stat.ranges++;
          const why = r.end < today ? "이미끝남" : dayDiff(r.start, today) > 75 ? "너무먼미래" : dayDiff(r.end, r.start) > 45 ? "기간김" : "";
          if (debug && trace.length < 40) trace.push(`${bb.name} | ${r.start}~${r.end} | ${why || "통과"} | ${s.slice(0, 90)}`);
          if (why) continue;
          cands.push({ brand: bb, title: eventName(s, bb), start: r.start, end: r.end, evidence: s.slice(0, 140), url, pubTitle: it.title.slice(0, 60), srcKey: new URL(url).hostname });
        }
      }
    }
  }
  // 동시 4개씩 — 브랜드별 검색, 그리고 (첫 묶음에서만) 행사 이름 검색
  // 브랜드별 검색은 그 브랜드 문장만 인정
  const brandJobs: Array<() => Promise<void>> = list.map((b) => () => doQuery(b.name, `"${b.name}" (세일 OR 페스타 OR 할인 OR 행사 OR 특가)`, b, nArt));
  const eventJobs: Array<() => Promise<void>> = (batch % of === 0 && !only.length) ? EVENT_QUERIES.map((q) => () => doQuery("행사:" + q, q, null, 4)) : [];
  const queue = [...brandJobs, ...eventJobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const j = queue.shift()!; await j(); } }));

  // 같은 (브랜드, 시작±3일 또는 끝 같음) 묶기 → 근거 기사 수
  type Grp = { c: Cand; hosts: Set<string>; n: number };
  const groups: Grp[] = [];
  for (const c of cands) {
    const g = groups.find((x) => x.c.brand.name === c.brand.name && (Math.abs(dayDiff(x.c.start, c.start)) <= 3 || x.c.end === c.end));
    if (g) { g.n++; g.hosts.add(c.srcKey); if (g.c.title === "행사" && c.title !== "행사") g.c = { ...c, start: g.c.start, end: g.c.end }; }
    else groups.push({ c, hosts: new Set([c.srcKey]), n: 1 });
  }
  const fresh = groups.filter((g) => !dupOfExisting(g.c.brand.name, g.c.start, g.c.end));
  const table = fresh.map((g) => ({
    brand: g.c.brand.name, title: g.c.title, start: g.c.start, end: g.c.end, sources: g.hosts.size, mentions: g.n,
    evidence: g.c.evidence, url: g.c.url,
  }));

  let inserted = 0;
  if (!dry && fresh.length) {
    const rows = fresh.map((g) => ({
      brand: g.c.brand.name, slug: g.c.brand.slug, title: g.c.title.slice(0, 40), tag: "", start_date: g.c.start, end_date: g.c.end,
      url: g.c.brand.url, aff_merchant: g.c.brand.aff || "", approved: false,
      note: `자동수집 · 기사 ${g.hosts.size}곳 · “${g.c.evidence.slice(0, 110)}” · ${g.c.url}`.slice(0, 480),
    }));
    const r = await fetch(`${SB_URL}/rest/v1/sale_events`, {
      method: "POST", headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(rows),
    });
    if (r.ok) {
      const saved: Array<{ id: number; brand: string; title: string; start_date: string; end_date: string }> = await r.json();
      inserted = saved.length;
      // 사장님이 놓치지 않게 운영 알림에 남긴다 (health_alerts → 운영 현황판)
      try {
        const lines = saved.map((s) => `#${s.id} ${s.brand} ${s.title} ${s.start_date}~${s.end_date}`).join(" / ");
        await fetch(`${SB_URL}/rest/v1/health_alerts`, {
          method: "POST", headers: { apikey: SB_SRV, Authorization: `Bearer ${SB_SRV}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ kind: "세일후보", detail: `새 세일 후보 ${saved.length}건(미승인) — ${lines} · 승인: update public.sale_events set approved=true where id in (…)`.slice(0, 900) }),
        });
      } catch (e) { errors.push("alert: " + String(e).slice(0, 60)); }
    } else errors.push("insert " + r.status + " " + (await r.text()).slice(0, 120));
  }
  return json({ ok: true, dry, today, ms: Date.now() - t0, stat, candidates: table.length, inserted, table, errors: errors.slice(0, 12), ...(debug ? { trace } : {}) });
});

// 🏷️ 몰 상품 페이지에서 **상품명·가격·사진·품절**을 실측해 JSON 으로 내놓는다 (2026-10-08 신설)
//
// 왜 — bbhd 회차가 「브라우저 되는 세션에서 가격만 실측하면 된다」고 적고 넘어가는 일이 많았다.
//   최근 7일 89회차 중 지마켓 11·오늘의집 7 회차가 그렇게 끝나 15~20건이 유실됐다(사장님 "베이비핫딜 자동화해놔").
//   세션마다 playwright 코드를 새로 짜지 않고 이 도구를 부르면 끝나게 만든다.
//
// 🔑 핵심: **창을 띄우는 크롬**이어야 읽힌다. headless 는 옥션·지마켓에서 봇체크에 막힌다.
//   창은 `--window-position=-3000,-3000` 으로 **화면 밖**에 띄워 사장님 화면을 가리지 않는다.
//
// 실행:  node tools/daily/mall_price.mjs --url "https://itempage3.auction.co.kr/DetailView.aspx?itemno=..."
//        node tools/daily/mall_price.mjs --url "..." --url "..."        (여러 개도 된다)
//        --headless 를 주면 창 없이 시도한다(빠르지만 옥션·지마켓은 막힌다)
// 출력:  한 줄 JSON — { ok, url, mall, name, price, before, img, soldout, note }
//
// 몰별 실측 (2026-10-08):
//   🟢 옥션  — 창 모드면 읽힌다 (가격 7,920원 확인)
//   🟢 지마켓 — **2026-10-13 되살림.** playwright 가 직접 띄운 크롬은 막히지만, 자동화 표식 없는 「그냥 크롬」+CDP(real_chrome.mjs)는 열린다.
//              (2026-10-08 의 「되살리지 말 것」은 이 방식을 몰랐을 때의 결론이었다)
//   🟢 11번가·롯데온 — JSON-LD / DOM 으로 읽힌다
import { openRealChrome } from './real_chrome.mjs';

const argv = process.argv.slice(2);
const urls = argv.reduce((a, v, i) => (v === '--url' && argv[i + 1] ? [...a, argv[i + 1]] : a), []);
const HEADLESS = argv.includes('--headless');
if (!urls.length) { console.error('쓰기: node tools/daily/mall_price.mjs --url "<상품주소>" [--url ...] [--headless]'); process.exit(1); }

const mallOf = (u) => /auction\.co\.kr/.test(u) ? '옥션'
  : /gmarket/.test(u) ? '지마켓'
  : /11st/.test(u) ? '11번가'
  : /lotteon/.test(u) ? '롯데온'
  : /coupang/.test(u) ? '쿠팡'
  : /ohou\.se/.test(u) ? '오늘의집' : '기타';

// 자동화 표식 없는 실제 크롬(프로필은 디스크에 남아 로그인이 유지된다) — 창은 화면 밖
const rc = await openRealChrome({ visible: false });
const ctx = rc.ctx;

let _n = 0;
for (const url of urls) {
  // 지마켓은 같은 세션에서 연달아 열면 두 번째부터 봇체크에 걸린다(2026-10-13 실측) — 간격을 둔다
  if (_n++ > 0 && /gmarket/.test(url)) await new Promise((r) => setTimeout(r, 9000));
  const mall = mallOf(url);
  const out = { ok: false, url, mall, name: null, price: null, before: null, img: null, soldout: false, note: '' };
  const pg = await ctx.newPage();
  try {
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 「잠시만 기다리십시오…」 중간 페이지를 넘어갈 때까지 기다린다
    let passed = false;
    for (let i = 0; i < 25; i++) {
      await pg.waitForTimeout(1000);
      const t = await pg.title().catch(() => '');
      if (t && !/잠시만|기다리/.test(t)) { passed = true; break; }
    }
    if (!passed) { out.note = '봇체크 중간 페이지에서 막혔다(「잠시만 기다리십시오…」)'; console.log(JSON.stringify(out)); await pg.close().catch(() => {}); continue; }
    await pg.waitForTimeout(2000);

    // 🔴🔴 **상품 페이지에 실제로 도착했는지 먼저 확인한다** — 이게 없으면 가짜 가격을 등록한다.
    //   2026-10-08 사고: 옥션 상품 주소를 열었는데 `auction.co.kr/?redirect=1` **메인으로 튕겼고**,
    //   메인 배너에 있던 **딴 상품** 가격(25,900→7,920)을 그 상품 가격으로 읽어 「옥션은 읽힌다」고 오판했다.
    //   상품번호가 최종 주소에도 없고 본문에도 없으면 **그 페이지는 그 상품이 아니다.**
    const idInUrl = (url.match(/itemno=([A-Za-z0-9]+)|goodscode=(\d+)|products?\/(\d+)|\/p\/product\/(\w+)/i) || []).slice(1).find(Boolean);
    const final = pg.url();
    if (idInUrl) {
      const bodyHas = await pg.evaluate((id) => (document.body.innerText || '').includes(id) || document.documentElement.innerHTML.includes(id), idInUrl).catch(() => false);
      if (!final.includes(idInUrl) && !bodyHas) {
        out.note = `상품 페이지가 아니다 — ${final.slice(0, 70)} 로 튕겼다(상품번호 ${idInUrl} 없음)`;
        console.log(JSON.stringify(out)); await pg.close().catch(() => {}); continue;
      }
    }

    Object.assign(out, await pg.evaluate(() => {
      const body = document.body.innerText || '';
      const meta = (p) => (document.querySelector(`meta[property="${p}"]`) || {}).content || null;
      const txt = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : null; };
      const num = (s) => { const v = txt(s); if (!v) return null; const m = v.replace(/,/g, '').match(/\d{3,8}/); return m ? Number(m[0]) : null; };
      const fromBody = (re) => { const m = body.replace(/,/g, '').match(re); return m ? Number(m[1]) : null; };
      // 지마켓: 본문에 「기존가 55,000원 … 39,090원 쿠폰가」 순서로 나온다
      const flat = body.replace(/,/g, '').replace(/\s+/g, ' ');
      const gmCoupon = (flat.match(/(\d{3,8})\s*원\s*쿠폰가/) || [])[1];
      const gmSale = (flat.match(/(\d{3,8})\s*원\s*(?:판매가|할인가|즉시할인가)/) || [])[1];
      const gmBefore = (flat.match(/기존가\s*(\d{3,8})\s*원/) || [])[1];
      const gmIdx = flat.indexOf('기존가');
      const gmLines = gmIdx >= 0 ? flat.slice(gmIdx, gmIdx + 420) : null;
      // 가격 — 몰별 셀렉터를 넓게 훑고, 없으면 본문에서 「판매가 … 원」
      const price = (location.hostname.includes('gmarket') && (gmCoupon || gmSale) ? Number(gmCoupon || gmSale) : null)
        ?? num('.price_real') ?? num('strong.price_real') ?? num('.price_innerwrap .price_real')
        ?? num('[class*="price"] strong') ?? num('.sell_price') ?? num('.item_price')
        ?? fromBody(/판매가[^\d]{0,24}(\d{3,8})\s*원/) ?? fromBody(/(\d{3,8})\s*원/);
      const before = (location.hostname.includes('gmarket') && gmBefore ? Number(gmBefore) : null)
        ?? num('.price_original') ?? num('del') ?? num('.price_before') ?? fromBody(/정상가[^\d]{0,20}(\d{3,8})/);
      return {
        name: meta('og:title') || txt('h1') || txt('.itemtit') || txt('[class*="item_name"]') || document.title.replace(/\s*[-–|]\s*(옥션|G마켓|11번가|롯데ON).*$/, '').trim() || null,
        price, before: before && price && before > price ? before : null,
        img: meta('og:image') || (document.querySelector('[class*="item"] img, #mainImage img, .viewer_image img') || {}).src || null,
        soldout: /품절|판매중지|판매종료|일시품절/.test(body.slice(0, 5000)),
        priceKind: location.hostname.includes('gmarket') ? (gmCoupon ? '쿠폰가' : gmSale ? '판매가' : null) : null,
        lines: gmLines,
      };
    }));
    out.ok = !!(out.name && out.price);
    if (!out.ok) out.note = `상품명${out.name ? '' : '·'}가격${out.price ? '' : '·'}을 못 읽었다`;
  } catch (e) {
    out.note = String(e.message).slice(0, 110);
  }
  await pg.close().catch(() => {});
  console.log(JSON.stringify(out));
}
await rc.close();

// 🏠 오늘의집 **큐레이터(제휴) 링크를 자동 발급**하고 상품명·가격·사진을 읽는다 (2026-10-13)
//
// 왜 — bbhd 무인 회차가 오늘의집 제보를 못 올려 「사람몫」에 쌓였다(최근 7일 24건).
//   링크는 사장님 큐레이터 계정으로 **로그인된 브라우저에서 공유하기 → 주소 복사**로만 나온다(조립·재사용은 수익 인정 안 됨).
//   그 로그인을 전용 크롬 프로필(real_chrome.mjs)에 **한 번만** 해 두면(ohouse_login.mjs) 이 도구가 알아서 받는다.
//
// 실행:  node tools/daily/ohouse_link.mjs "https://ozip.me/XXXX" ["https://store.ohou.se/goods/3934303" 또는 상품번호 3934303 …]
// 출력:  입력마다 한 줄 JSON — { ok, input, goods, name, price, before, img, link, soldout, endsToday, lines, note }
//   link 가 `https://ozip.me/…` 로 시작하면 **우리 링크**다. hotdeals.link 에 그대로 넣는다(product_id='oh_<goods>', mall='오늘의집', source='ohouse').
// 종료코드: 0 전부 발급 · 1 일부 실패 · 3 로그아웃(health_alerts 에 경보를 남긴다 — 그때만 ohouse_login.mjs 를 다시)
//
// 🔴 안 하는 것: 팝업 버튼을 눌러보며 찾기. 스크랩·장바구니·구매·문의 버튼을 건드리지 않는다
//    (aria-label 이 「공유하기」 「주소 복사」 인 버튼만 누른다 — 2026-09-06 사장님 계정에 스크랩이 생긴 사고).
// ⚠ ozip.me 링크가 상품이 아니라 기획전으로 가면 공유 버튼이 없다 → ok:false, note 에 적는다(다른 링크를 쓸 것).
// ⚠ 제보자 링크의 제휴 파라미터는 버린다 — 상품 번호만 뽑아 깨끗한 주소로 다시 열고, 그 주소에서 우리 링크를 받는다.
import { openRealChrome } from './real_chrome.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const inputs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!inputs.length) { console.error('쓰기: node tools/daily/ohouse_link.mjs <ozip.me 링크|goods 주소|상품번호> [...]'); process.exit(1); }
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';

function raiseAlert(msg) {
  try {
    fs.writeFileSync('scratchpad/_ohouse_alert.sql', `insert into public.health_alerts(kind, detail) values ('오늘의집로그인만료', '${msg.replace(/'/g, "''")}');`);
    execFileSync(CLI, ['db', 'query', '--linked', '--file', 'scratchpad/_ohouse_alert.sql', '--output-format', 'json'], { stdio: 'ignore', timeout: 60000 });
  } catch { /* 경보 실패는 삼킨다 — 종료코드 3 이 이미 신호다 */ }
}

const goodsOf = (s) => (String(s).match(/goods\/(\d+)/) || String(s).match(/^(\d{4,9})$/) || [])[1] || null;

const rc = await openRealChrome({ visible: false });
let exitCode = 0;
try {
  for (const input of inputs) {
    const out = { ok: false, input, goods: null, name: null, price: null, before: null, img: null, link: null, soldout: false, endsToday: false, lines: null, note: '' };
    const pg = await rc.ctx.newPage();
    try {
      // 1) 상품 번호 확정 — ozip.me 는 따라가서 최종 주소에서 뽑는다
      let goods = goodsOf(input);
      if (!goods) {
        await pg.goto(input, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await pg.waitForTimeout(2500);
        goods = goodsOf(pg.url());
        if (!goods) { out.note = `상품 페이지가 아니다(기획전·오늘의딜 목록일 수 있다) — ${pg.url().slice(0, 70)}`; console.log(JSON.stringify(out)); await pg.close(); exitCode ||= 1; continue; }
      }
      out.goods = goods;
      // 2) 깨끗한 상품 주소로 열어 로그인 상태와 공유 버튼 확인
      await pg.goto(`https://store.ohou.se/goods/${goods}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pg.waitForTimeout(3500);
      if (!pg.url().includes(goods)) { out.note = `상품 주소가 튕겼다 — ${pg.url().slice(0, 70)}`; console.log(JSON.stringify(out)); await pg.close(); exitCode ||= 1; continue; }
      const state = await pg.evaluate(() => {
        const labels = [...document.querySelectorAll('header a, header button')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim());
        const body = document.body.innerText || '';
        const meta = (p) => (document.querySelector(`meta[property="${p}"]`) || {}).content || null;
        const flat = body.replace(/,/g, '').replace(/\s+/g, ' ');
        const m = (re) => { const x = flat.match(re); return x ? Number(x[1]) : null; };
        const idx = flat.indexOf('쿠폰 할인가') >= 0 ? flat.indexOf('쿠폰 할인가') : flat.indexOf('원');
        return {
          loggedOut: labels.some((t) => t === '로그인' || t === '회원가입'),
          hasShare: !!document.querySelector('button[aria-label="공유하기"]'),
          name: meta('og:title') || document.title.split('|')[0].trim(),
          img: meta('og:image'),
          price: m(/쿠폰 할인가\D{0,12}(\d{3,8})\s*원/) ?? m(/(?:판매가|할인가)\D{0,12}(\d{3,8})\s*원/) ?? m(/(\d{3,8})\s*원/),
          before: m(/(?:정가|판매가)\D{0,10}(\d{3,8})\s*원/),
          soldout: /일시품절|품절|판매 ?종료|판매중지/.test(body.slice(0, 4000)),
          endsToday: /오늘의딜\s*\d{1,2}:\d{2}:\d{2}\s*남음|\d{1,2}:\d{2}:\d{2}\s*남음/.test(body),
          lines: idx >= 0 ? flat.slice(Math.max(0, idx - 80), idx + 260) : null,
        };
      });
      if (state.loggedOut) {
        out.note = '로그아웃 상태 — node tools/daily/ohouse_login.mjs 로 한 번 로그인';
        console.log(JSON.stringify(out));
        raiseAlert('오늘의집 로그인이 풀렸습니다 — 사장님이 한 번 로그인해 주셔야 오늘의집 핫딜 자동 등록이 다시 됩니다(node tools/daily/ohouse_login.mjs)');
        await pg.close();
        exitCode = 3;
        break;
      }
      Object.assign(out, { name: state.name, img: state.img, price: state.price, before: state.before && state.price && state.before > state.price ? state.before : null, soldout: state.soldout, endsToday: state.endsToday, lines: state.lines });
      if (!state.hasShare) { out.note = '공유하기 버튼이 없다(기획전·판매종료 페이지일 수 있다)'; console.log(JSON.stringify(out)); await pg.close(); exitCode ||= 1; continue; }
      // 3) 복사 가로채기 → 공유하기 → 주소 복사
      const link = await pg.evaluate(async () => {
        window.__cap = '';
        document.addEventListener('copy', (e) => { try { window.__cap = e.clipboardData.getData('text') || window.__cap; } catch {} }, true);
        const orig = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
        if (navigator.clipboard) navigator.clipboard.writeText = (t) => { window.__cap = String(t); return orig ? orig(t).catch(() => {}) : Promise.resolve(); };
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const share = document.querySelector('button[aria-label="공유하기"]');
        if (!share) return { err: 'no-share' };
        share.click();
        await sleep(900);
        // 「주소 복사」 svg 의 부모 버튼만. 없으면 회색 원(#EAEDEF) 버튼 — 그 외에는 누르지 않는다
        let btn = [...document.querySelectorAll('svg[aria-label="주소 복사"]')].map((s) => s.closest('button')).find(Boolean);
        if (!btn) btn = [...document.querySelectorAll('button')].find((b) => { const s = b.querySelector('svg'); return s && s.innerHTML.includes('#EAEDEF'); });
        if (!btn) return { err: 'no-copy-button' };
        const al = (btn.getAttribute('aria-label') || '');
        if (/스크랩|장바구니|구매|문의/.test(al)) return { err: 'refuse:' + al };
        btn.click();
        for (let i = 0; i < 12 && !window.__cap; i++) await sleep(250);
        return { cap: window.__cap || '' };
      });
      if (link.cap && /^https?:\/\/ozip\.me\//.test(link.cap)) { out.link = link.cap; out.ok = !!(out.name && out.price); if (!out.ok) out.note = '링크는 받았지만 상품명·가격을 못 읽었다'; }
      else { out.note = `링크를 못 받았다 (${link.err || link.cap || '빈 값'})`; exitCode ||= 1; }
    } catch (e) {
      out.note = String(e.message || e).slice(0, 120); exitCode ||= 1;
    }
    console.log(JSON.stringify(out));
    await pg.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }
} finally { await rc.close(); }
process.exit(exitCode);

// 스룩 결제창에서 **상품 정보**를 긁는다 — 카페 자동 발행에 쓸 재료 (사장님 지시 2026-09-22)
//
// 왜 브라우저인가
//   스룩 상세는 JS 로 그려진다. curl 로는 이미지가 **0장**이다(실측 2026-09-22).
//   브라우저로 열고 끝까지 훑어야 상품 사진·상세페이지 이미지가 나온다(유니케어 233장).
//
// 무엇을 구분해 담나 (주소 모양으로 갈린다)
//   · 대표 사진   img.srookpay.com/data/goods/<상점>/small/thum/…   ← 상품 자체 사진
//   · 상세페이지  img.srookpay.com/userfiles/<상점>/thumb/…          ← 셀러가 올린 상세 이미지
//   · 버릴 것     module_default·loading2.gif 등 스룩 화면 부품, 300px 미만
//
//   node tools/daily/srook_product.mjs <스룩주소> [<주소2> …]      결과를 JSON 으로 출력
//   node tools/daily/srook_product.mjs --live                      진행 중인 맘캘린더 공구 전부
//
// ⚠ 가격은 화면에 여러 개 보인다(정가·판매가·배송비). 여기선 **후보를 그대로 넘긴다** — 고르는 건 쓰는 쪽 몫이다.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB_CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';

const JUNK = /module_default|loading|\/contents\/module\/|blank\.|spacer|icon/i;

async function scrape(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2200);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 1800); await page.waitForTimeout(320); }
  await page.waitForTimeout(1000);
  return page.evaluate(() => {
    const seen = new Set();
    const imgs = [];
    for (const i of document.querySelectorAll('img')) {
      const src = i.currentSrc || i.src || '';
      if (!src || seen.has(src)) continue;
      seen.add(src);
      imgs.push({ src, w: i.naturalWidth, h: i.naturalHeight });
    }
    const heads = [...document.querySelectorAll('h1,h2,h3')].map((e) => e.innerText.trim()).filter(Boolean);
    const prices = [...document.querySelectorAll('*')]
      .map((e) => (e.childElementCount === 0 ? e.innerText.trim() : ''))
      .filter((t) => /^[0-9,]{3,}원$/.test(t));
    return { heads, prices, imgs, url: location.href };
  });
}

function tidy(raw) {
  const ok = raw.imgs.filter((x) => x.w >= 300 && !JUNK.test(x.src));
  const uniq = (arr) => [...new Map(arr.map((x) => [x.src.split('?')[0], x])).values()];
  return {
    url: raw.url,
    name: (raw.heads[0] || '').replace(/\s+/g, ' ').trim(),
    prices: [...new Set(raw.prices)].slice(0, 6),
    main: uniq(ok.filter((x) => /\/data\/goods\//.test(x.src))).map((x) => x.src),
    detail: uniq(ok.filter((x) => /\/userfiles\//.test(x.src))).map((x) => x.src),
  };
}

const args = process.argv.slice(2);
let targets = args.filter((a) => a.startsWith('http'));

if (args.includes('--live')) {
  const sql = 'scratchpad/_srook_live.sql';
  fs.writeFileSync(path.join(REPO, sql),
    "select id, name, pay_link from gonggu where influencer='맘캘린더' and approved=true"
    + " and end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')"
    + " and coalesce(pay_link,'') like '%srok.kr%' order by open_date;");
  const raw = execFileSync(SB_CLI, ['db', 'query', '--linked', '--file', sql], { encoding: 'utf8', cwd: REPO, timeout: 120000 });
  const j = JSON.parse(raw.slice(raw.indexOf('{')));
  targets = (j.rows || []).map((r) => r.pay_link);
  console.error(`진행 중인 맘캘린더 스룩 공구 ${targets.length}건`);
}

if (!targets.length) { console.error('주소가 없다. 사용법: node tools/daily/srook_product.mjs <스룩주소> | --live'); process.exit(1); }

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const out = [];
for (const u of targets) {
  try { out.push(tidy(await scrape(page, u))); }
  catch (e) { console.error(`⚠ ${u} 실패: ${String(e.message).slice(0, 80)}`); }
}
await browser.close();
console.log(JSON.stringify(out, null, 1));

// 「2026 연말 세일 총정리」 카드 (사장님 2026-10-23 V2 확정 — 보라 바탕 2열 티켓·오른쪽 위 로고+맘캘린더·아래 「세일 정보는 맘캘린더」)
//
//   node tools/daily/make-sale-card.mjs          → daily/sale.png · daily/<날짜>_sale.png (1080×1350)
//   DAY=2026-10-24 node tools/daily/make-sale-card.mjs
// 데이터 = sale_events(라이브 DB). 브랜드당 한 줄(블프가 있으면 블프, 없으면 가장 이른 행사) · 끝난 것·해외 행사·문센 제외 · 시작일 순 12줄.
// 같은 디자인이 사이트 세일 탭 「친구에게 공유」(test.html _shareCardHtml 'sale') 에도 있다 — 하나를 고치면 둘 다 고친다.
// 쓰임: 인스타·스레드 아침 카드 세트에 같이 뽑는다(사장님 2026-10-23 "내일 인스타랑 스레드 카드뽑을때 같이 뽑히게") · 블로그 글 사진.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co', KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const day = process.env.DAY?.trim() || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const r = await fetch(`${SB}/rest/v1/sale_events?select=id,brand,slug,title,tag,start_date,end_date,url&order=start_date.asc&limit=200`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) { console.error('sale_events 읽기 실패', r.status); process.exit(1); }
const all = await r.json();
const by = new Map();
for (const e of all) {
  if (!e.start_date || e.tag === '해외' || e.tag === '문센') continue;   // 해외 행사·문화센터 접수는 세일이 아니다
  if ((e.end_date || e.start_date) < day) continue;
  const c = by.get(e.slug);
  if (!c || (e.tag === '블프' && c.tag !== '블프') || (c.tag !== '블프' && e.tag !== '블프' && e.start_date < c.start_date)) by.set(e.slug, e);
}
const L = [...by.values()].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0)).slice(0, 12);
if (!L.length) { console.log('예정 세일 0건 — 카드 안 만듦'); process.exit(0); }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const md = (s) => { const p = s.split('-'); return `${+p[1]}/${+p[2]}`; };
const wd = (s) => '일월화수목금토'[new Date(s + 'T00:00:00').getDay()];
const fileUrl = (p) => pathToFileURL(path.join(REPO, p)).href;
const TILE = { '29cm': ['29', '#111'], gmarket: ['G', '#00A650'], ssg: ['SSG', '#E2231A'], spao: ['SPAO', '#E30613'], hm: ['H&amp;M', '#E50010'], koreasalefesta: ['코세페', '#1E64C8'] };
const lg = (e) => {
  const st = 'width:74px;height:74px;border-radius:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#fff;font-weight:900;font-size:22px;';
  const t = TILE[e.slug];
  if (t) return `<div style="${st}background:${t[1]}">${t[0]}</div>`;
  if (fs.existsSync(path.join(REPO, 'sale', 'logos', e.slug + '.png'))) return `<div style="${st}background:#fff"><img src="${fileUrl('sale/logos/' + e.slug + '.png')}" style="width:100%;height:100%;object-fit:contain"></div>`;
  return `<div style="${st}background:#7B3FB5">${esc(String(e.brand).slice(0, 2))}</div>`;
};
const y = +day.slice(0, 4), mo = +day.slice(5, 7);
const top = mo >= 10 ? `${y} 연말` : `${y}`;
const tk = L.map((e) => `<div style="background:#fff;color:#1E1B26;border-radius:22px;display:flex;align-items:center;gap:16px;padding:0 20px;position:relative">${lg(e)}<div style="flex:1;min-width:0"><div style="font-size:27px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.brand)}</div><div style="font-size:23px;font-weight:700;color:#7B3FB5">${md(e.start_date)}(${wd(e.start_date)})${e.end_date ? ' ~ ' + md(e.end_date) : ''}</div></div><div style="position:absolute;right:-12px;top:50%;width:24px;height:24px;border-radius:50%;background:#7B3FB5;transform:translateY(-50%)"></div></div>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}body{font-family:Pretendard,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif}</style>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"></head><body>
<div id="card" style="width:1080px;height:1350px;box-sizing:border-box;background:#7B3FB5;color:#fff;display:flex;flex-direction:column">
<div style="padding:52px 56px 26px;display:flex;justify-content:space-between;align-items:flex-end"><div><div style="font-size:52px;font-weight:800;opacity:.9">${top}</div><div style="font-size:120px;font-weight:900;letter-spacing:-5px;line-height:1">세일 총정리</div></div><div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:132px;height:132px;border-radius:32px;background:linear-gradient(135deg,#B57BE0,#7B3FB5);display:flex;align-items:center;justify-content:center"><img src="${fileUrl('momcal-appicon.png')}" style="width:82%;height:82%;border-radius:26px"></div><div style="font-size:30px;font-weight:900;letter-spacing:-.5px">맘캘린더</div></div></div>
<div style="flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:16px;padding:0 46px 22px">${tk}</div>
<div style="padding:0 56px 30px;display:flex;justify-content:space-between;align-items:center"><b style="font-size:30px;font-weight:900;letter-spacing:-.5px">공동구매 · 핫딜 · 세일 정보 맘캘린더</b><span style="font-size:19px;opacity:.75">출처: 각 브랜드 공식 공지</span></div></div></body></html>`;

const tmp = path.join(os.tmpdir(), 'momcal_salecard_tmp.html');   // CI 체크아웃엔 scratchpad 가 없다
fs.writeFileSync(tmp, html, 'utf8');
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src));
  if (broken.length) console.log('⚠ 안 뜬 그림:', broken.join(' '));
  fs.mkdirSync(path.join(REPO, 'daily'), { recursive: true });
  const out = [path.join(REPO, 'daily', 'sale.png'), path.join(REPO, 'daily', `${day}_sale.png`)];
  await page.locator('#card').screenshot({ path: out[0] });
  fs.copyFileSync(out[0], out[1]);
  console.log(`✅ 세일 카드 ${L.length}줄 → ${out.join(' · ')}`);
  console.log(L.map((e) => `  ${e.brand} ${md(e.start_date)}~${e.end_date ? md(e.end_date) : ''}`).join('\n'));
} finally { await browser.close(); }

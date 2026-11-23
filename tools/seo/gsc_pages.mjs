// 서치콘솔 페이지 단위 리포트 (2026-11-23 ORDER_TEST_BLOCK_AND_SEO_TOP3 §5-1(b))
//
//   왜: 6대 키워드 대표 URL 결정(§5-2)과 잡음 페이지 정리(§5-7)의 근거. 「어느 페이지가 노출은 많은데 순위가 30위 밖인가(잡음)」
//       「어느 페이지가 10위 안에서 노출을 받는가(자산)」를 28일 창으로 본다.
//   무엇을: 서치콘솔 공식 API(읽기 전용) dimensions=['page'], 최근 28일(끝은 3일 전), 25,000행씩 끝까지.
//   출력:   tools/seo/gsc_pages.json (저장만 · 커밋하지 않는다 — .gitignore 에 없으면 git add 하지 말 것) + 콘솔 표 3개
//           ① 잡음: 노출 ≥ 20 · 평균순위 > 30 상위 30  ② 자산: 노출 ≥ 5 · 평균순위 ≤ 10 상위 30  ③ 사이트 합계
//   실행:   node tools/seo/gsc_pages.mjs
//   열쇠:   GSC_CLIENT_ID · GSC_CLIENT_SECRET · GSC_REFRESH_TOKEN (로컬 tools/daily/.env 또는 환경변수). 없거나 실패하면 기존 파일을 그대로 두고 끝낸다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools/seo/gsc_pages.json');
const SITE = 'https://momcalendar.com/';
const envFile = () => { try { return Object.fromEntries(fs.readFileSync(path.join(ROOT, 'tools/daily/.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()])); } catch { return {}; } };
const E = { ...envFile(), ...process.env };
const CID = E.GSC_CLIENT_ID || E.BLOGGER_CLIENT_ID, CSEC = E.GSC_CLIENT_SECRET || E.BLOGGER_CLIENT_SECRET, RT = E.GSC_REFRESH_TOKEN;
const keep = (m) => { console.log('⚠ ' + m + ' — 기존 파일을 그대로 둔다'); process.exit(0); };
if (!CID || !CSEC || !RT) keep('서치콘솔 열쇠 없음');

const ymd = (d) => d.toISOString().slice(0, 10);
const dec = (u) => { try { return decodeURIComponent(new URL(u).pathname); } catch { return u; } };
try {
  const tok = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: RT, grant_type: 'refresh_token' }) }).then((x) => x.json());
  if (!tok.access_token) keep('토큰 갱신 실패 ' + (tok.error || ''));
  const end = new Date(Date.now() - 3 * 864e5), start = new Date(end.getTime() - 27 * 864e5);
  const q = (body) => fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((x) => x.json());
  const rows = [];
  for (let at = 0; ; at += 25000) {
    const r = await q({ startDate: ymd(start), endDate: ymd(end), dimensions: ['page'], rowLimit: 25000, startRow: at });
    if (r.error) keep('API 오류 ' + (r.error.message || ''));
    const b = r.rows || []; rows.push(...b); if (b.length < 25000) break;
  }
  const tot = await q({ startDate: ymd(start), endDate: ymd(end), rowLimit: 1 });
  const t0 = (tot.rows || [])[0] || { clicks: 0, impressions: 0, position: 0 };
  const pages = rows.map((r) => ({ page: dec(r.keys[0]), clk: r.clicks, imp: r.impressions, pos: +r.position.toFixed(1) }));
  const noise = pages.filter((p) => p.imp >= 20 && p.pos > 30).sort((a, b) => b.imp - a.imp);
  const asset = pages.filter((p) => p.imp >= 5 && p.pos <= 10).sort((a, b) => b.imp - a.imp);
  const out = { range: [ymd(start), ymd(end)], total: { clk: t0.clicks, imp: t0.impressions, pos: +(t0.position || 0).toFixed(1) }, counts: { pages: pages.length, noise: noise.length, asset: asset.length }, noise, asset, pages };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const tbl = (a) => a.slice(0, 30).map((p, i) => `${String(i + 1).padStart(2)}. ${p.page} · 노출 ${p.imp} · 클릭 ${p.clk} · ${p.pos}위`).join('\n');
  console.log(`서치콘솔 페이지 리포트(28일) ${ymd(start)} ~ ${ymd(end)} · 페이지 ${pages.length}개`);
  console.log(`\n① 잡음(노출≥20·순위>30) ${noise.length}개 중 상위 30\n` + (tbl(noise) || '(없음)'));
  console.log(`\n② 자산(노출≥5·순위≤10) ${asset.length}개 중 상위 30\n` + (tbl(asset) || '(없음)'));
  console.log(`\n③ 사이트 합계: 클릭 ${out.total.clk} · 노출 ${out.total.imp} · 평균 ${out.total.pos}위`);
} catch (e) { keep('예외 ' + e.message); }

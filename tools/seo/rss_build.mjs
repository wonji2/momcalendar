// 검색 노출용 RSS(rss.xml) 만들기 (사장님 지시 2026-11-24 「네이버검색은?」 — 네이버 서치어드바이저는 사이트맵과 함께 RSS 를 받아 새 글을 빨리 수집한다)
//
//   무엇을: 빌드가 막 만든 공구 개별 페이지(gg/*.html) 가운데 오픈일이 「오늘 −3일 ~ 오늘 +7일」인 것만 골라
//           오늘 오픈 → 곧 오픈 → 막 오픈 순으로 최대 100건을 RSS 2.0 으로 쓴다. 제목·설명은 그 페이지의 <title>·<meta description> 을 그대로 옮긴다(지어내지 않는다).
//           sitemap-gonggu.xml 에 실린 주소만 쓴다 → noindex(C 계층) 페이지는 RSS 에도 안 들어간다.
//   어디서: 깃허브 Actions seo-daily.yml 「페이지 생성」 다음 단계. 커밋은 같은 워크플로의 git add 목록(rss.xml).
//   실행:   node tools/seo/rss_build.mjs            ← 저장소 루트에서. 결과 rss.xml
//   주의:   pubDate 는 「오픈일(미래면 오늘) 09:00 KST」로 고정한다 — 같은 공구는 날마다 같은 값(쓸데없이 「새 글」이 되지 않게).
//           제출(서치어드바이저 > 요청 > RSS 제출)은 사람 몫이다(로그인 필요). 실패해도 페이지 커밋은 계속되게 0 으로 끝낸다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://momcalendar.com';
const OUT = path.join(ROOT, 'rss.xml');
const MAX = 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

try {
  const nowK = new Date(Date.now() + 9 * 3600e3);
  const today = Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth(), nowK.getUTCDate());
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap-gonggu.xml'), 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const items = [];
  for (const loc of locs) {
    let rel; try { rel = decodeURIComponent(loc.replace(SITE, '')); } catch { continue; }
    const m = rel.match(/^\/gg\/(.+)-(\d{2})(\d{2})\.html$/);
    if (!m) continue;
    const mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    // 연도 없는 MMDD → 오늘과 가장 가까운 해로(12월에 본 01xx 는 내년, 1월에 본 12xx 는 작년)
    let y = nowK.getUTCFullYear(), t = Date.UTC(y, mo - 1, da);
    if (t - today > 183 * 864e5) t = Date.UTC(y - 1, mo - 1, da); else if (today - t > 183 * 864e5) t = Date.UTC(y + 1, mo - 1, da);
    const dd = (t - today) / 864e5;
    if (dd < -3 || dd > 7) continue;
    const fp = path.join(ROOT, rel.slice(1));
    if (!fs.existsSync(fp)) continue;
    const h = fs.readFileSync(fp, 'utf8').slice(0, 6000);
    if (/<meta name="robots" content="[^"]*noindex/.test(h)) continue;
    const title = unesc((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '').trim();
    const desc = unesc((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '').trim();
    if (!title) continue;
    items.push({ loc, title, desc, t: Math.min(t, today), rank: dd >= 0 ? dd : 10 - dd });   // 오늘 오픈 → 내일 → … → +7일 → 어제 → 그제
  }
  items.sort((a, b) => a.rank - b.rank || a.loc.localeCompare(b.loc));
  const top = items.slice(0, MAX);
  const pub = (t) => new Date(t).toUTCString().replace('00:00:00 GMT', '00:00:00 GMT');   // 09:00 KST = 00:00 UTC
  const last = top.length ? top[0].t : today;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>맘캘린더 — 인스타 공구 일정</title>
<link>${SITE}/</link>
<atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
<description>오늘 오픈·곧 오픈하는 인스타 공동구매 일정을 모은 맘캘린더 새 공구 소식입니다.</description>
<language>ko</language>
<lastBuildDate>${pub(last)}</lastBuildDate>
${top.map((x) => `<item><title>${esc(x.title)}</title><link>${esc(x.loc)}</link><guid isPermaLink="true">${esc(x.loc)}</guid><description>${esc(x.desc)}</description><pubDate>${pub(x.t)}</pubDate></item>`).join('\n')}
</channel>
</rss>
`;
  fs.writeFileSync(OUT, xml);
  console.log(`rss.xml: 후보 ${items.length}건 중 ${top.length}건`);
} catch (e) {
  console.log('::warning::rss.xml 을 만들지 못했다(페이지 커밋은 계속): ' + e.message);
}
process.exit(0);

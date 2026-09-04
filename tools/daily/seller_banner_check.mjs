// 셀러배너 생존 점검 — 사장님 지시 2026-08-20
//
// > "하루에 두번 아침 저녁으로 확인해서 인포크링크에서 결제링크 없어졌으면 배너도 자동으로 내려"
//
// 셀러가 공구를 마감하면 인포크에서 그 블록을 내린다. 그런데 우리 배너는 그대로 남아
// 손님이 눌러도 그 상품이 없다. **내리는 건 승인 없이 바로 한다** — 없는 상품을 띄워두는 게 더 나쁘다.
//   (새로 올리는 건 승인이 필요하지만, 내리는 건 되돌리기 쉽고 손해가 없다)
//
// ⚠ 인포크가 잠깐 안 열릴 수도 있다 → **페이지를 못 읽으면 아무것도 내리지 않는다.**
//   한 번 실패로 배너를 통째로 내리면 애드픽 때처럼 노출이 0이 된다(2026-08-18 사고).
//
//   node tools/daily/seller_banner_check.mjs          점검 후 내림
//   node tools/daily/seller_banner_check.mjs --dry    점검만
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseRows } from './sb_query.mjs';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DRY = process.argv.includes('--dry');
const TMP = (process.env.TEMP || process.env.TMP || '/tmp').replace(/\\/g, '/');

const SB = [
  `${process.env.USERPROFILE}/supabase-cli/supabase.exe`,
  `${process.env.HOME}/supabase-cli/supabase.exe`,
  'supabase',
].find((p) => p === 'supabase' || existsSync(p));
const REPO = [
  `${process.env.USERPROFILE}/Desktop/MOMCALENDAR`,
  `${process.env.USERPROFILE}/MOMCALENDAR`,
].find((p) => existsSync(p)) || process.cwd();

function sql(text, wantJson = true) {
  const f = `${TMP}/_sbchk_${Date.now()}.sql`;
  writeFileSync(f, text, 'utf8');
  const args = ['db', 'query', '--linked', '-f', f];
  if (wantJson) args.push('--output-format', 'json')   // ⚠ '--output' 은 db query 플래그가 아니다 — 조용히 무시된다;
  const out = execFileSync(SB, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!wantJson) return out;
  // 못 읽은 것과 0건을 구분한다 (tools/daily/sb_query.mjs 공용 파서)
  const parsed = parseRows(out);
  if (!parsed.ok) throw new Error('CLI 출력을 못 읽었다 — ' + parsed.why);
  return parsed.rows;
}

const clean = (s) => String(s)
  .replace(/\[[^\]]*\]\s*/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().replace(/[^가-힣a-z0-9]/g, '');

async function fetchBlocks(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 15000);
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const h = await r.text();
    if (h.length < 8000) return null;
    const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const pp = JSON.parse(m[1])?.props?.pageProps;
    return pp?.blocks?.length ? pp.blocks : null;
  } catch (e) { return null; }
}

// ad_memo 에 '유지' 가 적힌 배너는 인포크에서 내려가도 건드리지 않는다
// (사장님 지시 2026-08-31: 이현맘 르베르 유모차(69)는 셀러 요청으로 유지)
const rows = sql(`select id, title, link, coalesce(ad_memo,'') as memo from public.banners
                  where type='seller' and active order by sort_order;`);
const keep = rows.filter((b) => b.memo.includes('유지'));
keep.forEach((b) => console.log(`🔒 ${b.title.slice(0, 30)} — 유지 지정(점검 제외)`));
const live = rows.filter((b) => !b.memo.includes('유지'));
if (!live.length) { console.log('점검할 셀러배너가 없다'); process.exit(0); }
console.log(`노출중 ${live.length}건 점검`);

// 인포크 페이지는 셀러당 한 번만 읽는다 (같은 링크를 여러 배너가 공유한다)
const pages = new Map();
for (const link of [...new Set(live.map((b) => b.link))]) {
  pages.set(link, await fetchBlocks(link));
  await new Promise((r) => setTimeout(r, 2000));
}

const dead = [];
for (const b of live) {
  const blocks = pages.get(b.link);
  if (blocks === null) { console.log(`… ${b.title.slice(0, 26)} — 인포크를 못 읽었다(건너뜀)`); continue; }
  // 배너 제목은 "상품명 - 셀러명" → 상품명만 떼어 인포크 블록과 대조한다
  const cut = b.title.lastIndexOf(' - ');
  const name = norm(cut > 0 ? b.title.slice(0, cut) : b.title);
  // 제목이 40자로 잘려 있을 수 있다 → 앞부분이 일치하면 살아 있는 것으로 본다
  const alive = blocks.some((x) => {
    if (x.block_type !== 'link' || !x.title) return false;
    const t = norm(x.title);
    return t === name || t.startsWith(name) || name.startsWith(t);
  });
  if (alive) console.log(`✅ ${b.title.slice(0, 30)}`);
  else { dead.push(b); console.log(`⛔ ${b.title.slice(0, 30)} — 인포크에서 내려갔다`); }
}

if (!dead.length) { console.log('\n내릴 배너 없음'); process.exit(0); }
console.log(`\n내릴 배너 ${dead.length}건`);
if (DRY) { console.log('--dry 라 내리지 않는다'); process.exit(0); }

sql(`update public.banners set active=false where id in (${dead.map((d) => d.id).join(',')});`, false);
console.log('내림 완료');

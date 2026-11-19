// 셀러가 「내 링크」에 넣은 인스타 아이디 확인 — 「확인 중」(sellers.insta_pending)인 것을 인스타에서 열어 보고 반영·거절한다.
//   사장님 2026-11-19: 「인스타 핸들만 적으면 instagram.com 뒤에 붙여 그 사람 계정으로 바로 연결되는지 확인해서 자동으로 넣어줘」
//   흐름: DB 에서 확인 중 목록 → https://www.instagram.com/<아이디>/ 를 열어 제목에 「(@아이디)」가 있으면 있는 계정,
//         제목이 「Instagram」뿐인 온전한 페이지면 없는 계정 → select seller_insta_resolve(id, 아이디, true|false)
//         로그인 화면으로 밀리거나 애매하면 건드리지 않고 다음 회차에 다시 본다.
//   실행: node tools/daily/seller_insta_verify.mjs [--dry]
//   예약: momcal-seller-insta-verify (30분, wscript run_hidden 으로 창 없이) — 확인 중인 것이 없으면 인스타를 부르지 않는다.
//   🔴 왜 서버에 못 두나: 인스타는 해외 데이터센터 요청을 로그인 화면으로 밀어 계정 확인이 안 된다(2026-11-19 Edge 실측).
//      PC(가정 회선)에서는 된다. PC 가 꺼져 있으면 확인이 늦어지고, 24시간 넘으면 서버 크론 seller-insta-pending-watch 가 관리자에 올린다.
//   한 회차 최대 10개 · 사이 4초(인스타를 몰아서 두드리지 않는다).
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const DRY = process.argv.includes('--dry');
const REPO = path.join(process.env.USERPROFILE || '.', 'Desktop', 'MOMCALENDAR');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
function sql(text) { let last; for (let i = 0; i < 3; i++) { try { return execFileSync(CLI, ['db', 'query', '--linked', '--output-format', 'json', text], { cwd: REPO, stdio: 'pipe', timeout: 90000 }).toString(); } catch (e) { last = e; } } throw last; }
const rowsOf = (out) => { try { return JSON.parse(out.slice(out.indexOf('{'))).rows || []; } catch { return []; } };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
async function check(h) {
  try {
    const r = await fetch(`https://www.instagram.com/${h}/`, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return 'none';
    if (r.status !== 200 || /\/accounts\/login|\/challenge\//.test(r.url)) return 'unknown';
    const html = await r.text();
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/&#0?64;/gi, '@').toLowerCase().trim();
    if (title.includes(`(@${h})`)) return 'ok';
    if (title === 'instagram' && html.length > 200000) return 'none';
    return 'unknown';
  } catch { return 'unknown'; }
}
const list = rowsOf(sql(`select id, lower(insta_pending) as h from public.sellers where insta_pending is not null and insta_pending ~ '^[A-Za-z0-9._]{1,30}$' order by insta_pending_at limit 10`));
if (!list.length) { console.log('확인 중인 인스타 아이디 없음'); process.exit(0); }
for (const r of list) {
  const st = await check(r.h);
  console.log(r.id, r.h, '→', st, DRY ? '(dry)' : '');
  if (!DRY && st !== 'unknown') console.log('  ', sql(`select public.seller_insta_resolve(${Number(r.id)}, '${r.h.replace(/'/g, '')}', ${st === 'ok'}) as r`).replace(/\s+/g, ' ').slice(0, 160));
  await new Promise((res) => setTimeout(res, 4000));
}

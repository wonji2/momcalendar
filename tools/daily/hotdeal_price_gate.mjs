// 🏷️ 핫딜 「보내기 전 가격 유지 확인」 — 카톡 발송봇이 아침에 밤사이 딜을 보낼 때 가격이 그대로인 것만 보내게 한다
//   사장님 2026-11-04: 「딜 가격 변동된건 거르고 아침 보내는 시간까지도 핫딜가가 유지되는거에 한해서」
//
// 흐름
//   ① 올라온 지 25분~14시간 된, 아직 기간이 안 끝난 딜 중 「확인한 지 45분이 넘었거나 확인 안 한」 딜만 고른다(없으면 아무것도 안 부르고 끝)
//   ② 가격을 다시 잰다 — 토스는 toss-sync?mode=detail, 쿠팡·11번가·롯데온·지마켓은 mall_price.mjs(몰 페이지, card_preflight 와 같은 방식)
//   ③ hotdeals 의 price_status · current_price · last_checked_at · price_diff 에 적는다(price 는 건드리지 않는다)
//        same    몰 가격 = 등록 가격            → 카톡 봇이 보내도 된다(확인 시각이 90분 안일 때)
//        changed 가격이 달라짐                  → 봇이 보내지 않고 넘긴다
//        soldout 품절                           → 보내지 않는다
//        cond    제목에 쿠폰·카드·와우 같은 조건가인데 가격이 다름 → 사람이 아니면 확인 불가라 보내지 않는다
//        unknown 가격을 못 읽음                 → 봇이 기다린다(14시간이 지나면 버린다)
//   봇 쪽 규칙은 tools/daily/kakao_pc_hotdeal_sender.py 의 deal_gate() 가 원본이다.
//
// 실행:  node tools/daily/hotdeal_price_gate.mjs            확인하고 DB 에 쓴다
//        node tools/daily/hotdeal_price_gate.mjs --dry      재서 보여주기만(DB 안 씀)
// 예약:  momcal-hotdeal-price-gate (윈도우 예약작업) — 매일 07:30~22:30 30분마다. PC 가 꺼져 있으면 확인이 멈추고,
//        그러면 봇은 오래된 딜을 보내지 않는다(안전 쪽). 새로 올라온 딜(25분 안)은 이 작업과 상관없이 그대로 나간다.
// 이 PC 의 로그인된 크롬이 필요해(지마켓·오늘의집 봇체크) 서버에 못 둔다.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const FN = 'https://hycaqsqeogjtbscmzrtm.supabase.co/functions/v1';
const DRY = process.argv.includes('--dry');
const MAX_AGE_H = 14, FRESH_MIN = 25, RECHECK_MIN = 45, MAX_PER_RUN = 30;

function sql(q) {
  const f = path.join(os.tmpdir(), `_pgate_${process.pid}_${Date.now()}.sql`);
  fs.writeFileSync(f, q);
  try {
    const r = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json', '-f', f], { encoding: 'utf8', cwd: ROOT, maxBuffer: 64e6, timeout: 120000 });
    const j = JSON.parse(r.slice(r.indexOf('{')));
    return j.rows || j;
  } finally { try { fs.unlinkSync(f); } catch {} }
}
const CLOUD = !!process.env.MOMCAL_CLOUD;   // 깃허브 Actions(cloud_jobs.mjs)에서 돌 때
const LOGFILE = path.join(ROOT, 'scratchpad', 'hotdeal_price_gate.log');
const log = (m) => {
  const line = `[${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')} KST] ${m}`;
  console.log(line);
  if (CLOUD) return;   // 클라우드는 cloud_jobs.mjs 가 로그를 Storage 로 올린다
  try {   // PC 예약작업은 창이 없어 화면에 안 남는다 → 파일로. 200KB 를 넘으면 앞쪽을 버린다(한도 대장 0-L)
    fs.mkdirSync(path.dirname(LOGFILE), { recursive: true });
    if (fs.existsSync(LOGFILE) && fs.statSync(LOGFILE).size > 200 * 1024) fs.writeFileSync(LOGFILE, fs.readFileSync(LOGFILE, 'utf8').slice(-100 * 1024));
    fs.appendFileSync(LOGFILE, line + '\n');
  } catch {}
};

const deals = sql(`select id, title, price, price_before, mall, source, product_id, price_status
  from public.hotdeals
  where created_at > now() - interval '${MAX_AGE_H} hours' and created_at < now() - interval '${FRESH_MIN} minutes'
    and (expires_at is null or expires_at > now())
    and coalesce(price_status, 'unknown') not in ('changed', 'soldout', 'cond')
    and (last_checked_at is null or last_checked_at < now() - interval '${RECHECK_MIN} minutes')
  order by id limit ${MAX_PER_RUN};`);
if (!deals.length) { log('확인할 딜 없음 — 아무것도 부르지 않고 끝'); process.exit(0); }
log(`가격 확인 대상 ${deals.length}건`);

const live = {};
const toss = deals.filter((d) => d.source === 'toss' && /^toss_\d+$/.test(d.product_id || ''));
if (toss.length) {
  try {
    // 비밀값은 코드에 두지 않는다: 클라우드는 깃허브 시크릿(PUSH_CRON_SECRET), PC 는 홈의 .momcal_cron_secret
    const secret = (process.env.PUSH_CRON_SECRET || fs.readFileSync(path.join(os.homedir(), '.momcal_cron_secret'), 'utf8')).trim();
    const ids = toss.map((d) => d.product_id.replace('toss_', '')).join(',');
    const r = await fetch(`${FN}/toss-sync?mode=detail&ids=${ids}`, { headers: { 'x-cron-secret': secret } }).then((x) => x.json());
    for (const i of r.body?.success?.items || []) live['toss_' + i.tacaId] = { price: i.displayPrice, sold: i.isSoldOut };
  } catch (e) { log('토스 확인 실패: ' + e.message); }
}
const url = (d) => {
  const pid = String(d.product_id || '');
  if (d.source === 'coupang' && /^\d+_\d+$/.test(pid)) { const [a, b] = pid.split('_'); return `https://www.coupang.com/vp/products/${a}?itemId=${b}`; }
  if (pid.startsWith('lp_11st_')) return `https://www.11st.co.kr/products/${pid.slice(8)}`;
  if (pid.startsWith('lp_lotteon_')) return `https://www.lotteon.com/p/product/${pid.slice(11)}`;
  if (pid.startsWith('gm_')) return `https://item.gmarket.co.kr/Item?goodscode=${pid.slice(3)}`;
  return null;
};
const mall = deals.filter((d) => url(d));
if (mall.length) {
  // 클라우드엔 로그인된 크롬이 없어 창 없는 브라우저로 읽는다(지마켓·옥션은 봇체크에 막혀 못 읽을 수 있다 → unknown)
  const args = ['tools/daily/mall_price.mjs', ...mall.flatMap((d) => ['--url', url(d)]), ...(CLOUD ? ['--headless'] : [])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6, timeout: 900000 });
  const lines = (r.stdout || '').split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  for (const d of mall) {
    const hit = lines.find((x) => x.url === url(d));
    if (hit && hit.ok !== false) live[d.product_id] = { price: hit.price, sold: hit.soldout };
  }
}

const cond = (t) => /쿠폰|카드|와우|회원|결제가|적용가|즉시|청구|선착순/.test(t || '');
const rows = [];
for (const d of deals) {
  const L = live[d.product_id];
  let st = 'unknown', cur = null;
  if (L && L.sold) st = 'soldout';
  else if (L && L.price != null) {
    cur = Number(L.price);
    if (cur === Number(d.price)) st = 'same';
    else st = cond(d.title) ? 'cond' : 'changed';
  }
  rows.push({ id: d.id, st, cur, diff: cur != null ? cur - Number(d.price) : null });
  log(`#${d.id} ${d.mall} 등록 ${d.price} · 실측 ${cur ?? '-'} → ${st} · ${String(d.title).slice(0, 26)}`);
}
if (DRY) { log('--dry: DB 에 쓰지 않음'); process.exit(0); }
// 못 읽은 것(unknown)은 적지 않는다 — PC 와 클라우드가 같이 도는데, 못 읽는 쪽이 읽은 쪽의 「same」을 지우면 안 된다
rows.splice(0, rows.length, ...rows.filter((r) => r.st !== 'unknown'));
if (!rows.length) { log('이번 회차에 읽은 가격이 없어 DB 는 그대로'); process.exit(0); }
const vals = rows.map((r) => `(${r.id}, '${r.st}', ${r.cur ?? 'null'}::int, ${r.diff ?? 'null'}::int)`).join(',');
sql(`update public.hotdeals h set price_status = v.st, current_price = v.cur, price_diff = v.diff, last_checked_at = now()
  from (values ${vals}) as v(id, st, cur, diff) where h.id = v.id returning h.id;`);
log(`DB 반영 ${rows.length}건 (same ${rows.filter((r) => r.st === 'same').length} · changed ${rows.filter((r) => r.st === 'changed').length} · soldout ${rows.filter((r) => r.st === 'soldout').length} · cond ${rows.filter((r) => r.st === 'cond').length} · unknown ${rows.filter((r) => r.st === 'unknown').length})`);

/**
 * 🔎 **등록된 공구를 셀러 원본으로 되짚어 본다** — 두 갈래 (사장님 2026-10-05 "ㅇㅇ둘다하고")
 *
 * 사장님 지시:
 *   *"관리자 파싱에서 공구팡팡 파싱 1차로 만들긴 했는데 … 일정수확기
 *     (실제 그 셀러 인스타가서 공구랑 상품명 기간 맞는지까지 확인) 더 고도화 시켜"*
 *
 * 🔴 인스타는 실시간으로 못 친다 — 브라우저는 CORS, 서버는 로그인 벽·429.
 *    2026-10-05 실측으로 `ig_followers_meta.mjs` 가 8/8 빈 응답이었다.
 *    그래서 **셀러 본인이 올린 것** 두 가지로 대조한다(사장님 동의):
 *      ① 인포크 실시간  — `scratchpad/inpock_harvest.mjs` 의 harvest() 를 **그대로 쓴다**(포팅 안 함)
 *      ② 인스타 피드 수확물 — `scratchpad/ig_feed/*.jsonl` 의 셀러 캡션(30분마다 쌓인다)
 *
 * 흐름:  DB 에서 검사할 행을 뽑는다 → 셀러별로 ①② 를 모은다 → 상품명·기간을 대조한다 → 리포트
 *
 * 실행:
 *   node tools/daily/verify_rows.mjs                       최근 등록 40건
 *   node tools/daily/verify_rows.mjs --source cafe --limit 60
 *   node tools/daily/verify_rows.mjs --ids 27819,27820     그 행만
 *   node tools/daily/verify_rows.mjs --sql                 교정 SQL 도 만든다(실행은 사람이 한다)
 *
 * 출력:  scratchpad/verify_rows_report.md  ·  (--sql 이면) scratchpad/_verify_fix.sql
 * 로그:  scratchpad/verify_rows_log.txt
 *
 * 🔑 판정은 **완전일치로 걸지 않는다.** 인포크 제목이 더 짧거나 길다(「요거쪽쪽」 vs 「요거쪽쪽 요거트」).
 *    낱말 겹침·포함으로 보고, 애매하면 ❔ 로 둔다 — 자동 수정은 하지 않는다.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { harvest } from '../../scratchpad/inpock_harvest.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const LOG = SP('verify_rows_log.txt');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const KST = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => {
  const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`;
  console.log(l); try { appendFileSync(LOG, l + '\n'); } catch { }
};

// ── 이름 대조 — 완전일치로 걸지 않는다 ────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
const toks = (s) => String(s || '').toLowerCase()
  .split(/[^가-힣a-z0-9]+/).filter((w) => w.length >= 2);
const STOP = new Set(['모음전', '골라담기', '세트', '신상', '공구', '특가', '단독', '앵콜', '모음', '기획전', '차수']);

/** 두 상품명이 같은 것을 가리키나 — 0(아님) · 1(비슷) · 2(거의 같음) */
function nameMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 2;
  if (na.length >= 4 && nb.includes(na)) return 2;
  if (nb.length >= 4 && na.includes(nb)) return 2;
  const ta = toks(a).filter((w) => !STOP.has(w));
  const tb = toks(b).filter((w) => !STOP.has(w));
  if (!ta.length || !tb.length) return 0;
  const shared = ta.filter((w) => tb.includes(w));
  if (!shared.length) return 0;
  // 브랜드로 쓰이는 첫 낱말이 겹치면 더 믿는다
  if (shared.includes(ta[0]) && shared.includes(tb[0])) return 2;
  return shared.some((w) => w.length >= 3) ? 1 : 0;
}
const dayGap = (a, b) => {
  const pa = Date.parse(String(a) + 'T00:00:00Z'), pb = Date.parse(String(b) + 'T00:00:00Z');
  return (isNaN(pa) || isNaN(pb)) ? 99 : Math.round(Math.abs(pa - pb) / 864e5);
};

// ── DB ────────────────────────────────────────────────────────────────
function sql(q) {
  const f = SP('_vr_q.sql');
  writeFileSync(f, q);
  const out = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json', '-f', f],
    { encoding: 'utf8', timeout: 300000 });
  const m = out.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return [];
  const j = JSON.parse(m[0]);
  return Array.isArray(j) ? j : (j.rows || []);
}

// ── ② 인스타 피드 수확물 ──────────────────────────────────────────────
//    ig_feed_sweep 이 30분마다 쌓는 jsonl. 한 줄 = 게시물 {u:핸들, t:게시일, cap:캡션}
function loadFeed(days) {
  const dir = path.join(ROOT, 'scratchpad', 'ig_feed');
  if (!existsSync(dir)) return new Map();
  const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const byHandle = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    const day = f.slice(0, 10);
    if (day < cut) continue;
    let txt = '';
    try { txt = readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const h = String(o.u || '').toLowerCase();
      if (!h || !o.cap) continue;
      if (!byHandle.has(h)) byHandle.set(h, []);
      byHandle.get(h).push({ t: o.t || day, cap: String(o.cap) });
    }
  }
  return byHandle;
}

// ── 본체 ──────────────────────────────────────────────────────────────
const LIMIT = +arg('--limit', 40);
const DAYS = +arg('--days', 45);
const SRC = arg('--source', '');
const IDS = (arg('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

// 🔑 사장님 본인 공구(momcal_)와 손으로 넣은 행(source=manual)은 **검증 대상이 아니다** — 원본이 사장님이다.
//    카페발(insta='')도 뺀다 — 셀러가 미상이라 대조할 원본이 없다(규칙: 카페발은 셀러명을 비워 둔다).
let where = `approved and coalesce(insta,'') <> '' and insta <> 'momcal_' and coalesce(source,'') <> 'manual'
  and end_date >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')`;
if (IDS.length) where = `id in (${IDS.map((n) => String(+n || 0)).join(',')})`;
else if (SRC) where += ` and source = '${SRC.replace(/'/g, "''")}'`;

const rows = sql(`select id, name, insta, influencer, open_date, end_date, coalesce(source,'-') src
from gonggu where ${where} order by id desc limit ${LIMIT};`);
if (!rows.length) { log('검사할 행이 없다 — 끝'); process.exit(0); }

const handles = [...new Set(rows.map((r) => String(r.insta).toLowerCase()))];
log(`시작 — 행 ${rows.length}건 · 셀러 ${handles.length}명 (source=${SRC || '전체'})`);

// 슬러그 표 (있으면 인포크 조회가 한 번에 맞는다)
let slugOf = new Map();
try {
  for (const r of sql(`select insta, slug from seller_inpock;`)) slugOf.set(String(r.insta).toLowerCase(), r.slug);
} catch (e) { log(`⚠ 슬러그 표를 못 읽었다(${String(e.message).slice(0, 60)}) — 핸들로만 추측한다`); }

const feed = loadFeed(DAYS);
log(`② 피드 수확물: 셀러 ${feed.size}명분 캡션 적재(최근 ${DAYS}일)`);

// ① 인포크 — 셀러별로 한 번만 친다
const inpockOf = new Map();
for (const h of handles) {
  try {
    const r = await harvest(h, slugOf.get(h));
    inpockOf.set(h, r && Array.isArray(r.rows) ? r.rows : []);
    log(`  인포크 ${h} → ${r ? r.rows.length + '건 (slug=' + r.slug + ')' : '없음'}`);
  } catch (e) { inpockOf.set(h, []); log(`  🔴 인포크 ${h} 실패: ${String(e.message).slice(0, 60)}`); }
  await new Promise((r) => setTimeout(r, 2500));
}

// 대조
const today = KST().toISOString().slice(0, 10);   // KST 오늘 — 「재공구」 판정에 쓴다
const out = [], fixes = [];
let ok = 0, dateDiff = 0, nameDiff = 0, unknown = 0;
for (const r of rows) {
  const h = String(r.insta).toLowerCase();
  const ip = inpockOf.get(h) || [];
  let best = null, bestScore = 0;
  for (const c of ip) {
    const s = nameMatch(r.name, c.name);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  // ② 피드 — 캡션에 상품 낱말이 있고 게시일이 오픈일 근처인가
  const posts = feed.get(h) || [];
  const wantTok = toks(r.name).filter((w) => !STOP.has(w) && w.length >= 2);
  const feedHit = posts.find((p) => {
    if (dayGap(p.t, r.open_date) > 21) return false;
    const cap = p.cap.toLowerCase();
    return wantTok.some((w) => cap.includes(w));
  });

  let verdict, detail = '';
  if (best && bestScore >= 1) {
    const gOpen = dayGap(r.open_date, best.open), gEnd = dayGap(r.end_date, best.end);
    if (gOpen <= 1 && gEnd <= 1) { verdict = '✅ 일치'; ok++; }
    else if (best.end < today && r.end_date >= today) {
      // 🔴 인포크 쪽이 **이미 마감**이고 우리 것은 진행 중이면 **재공구**다 (메모리 gonggu-dup-definition
      //   "날짜 다르면 재공구다"). 셀러가 인포크를 안 지웠을 뿐이다 —
      //   여기서 인포크 날짜로 덮으면 **진행 중인 공구가 과거가 되어 손님 화면에서 사라진다.**
      //   2026-10-05 실측: 「마카오 여행」 인포크 10-01~04(마감) vs 우리 10-05~08(진행중).
      verdict = '🔁 재공구'; ok++;
      detail = `인포크엔 지난 회차만 있다(${best.open}~${best.end}) — 우리 것이 새 회차로 보인다. **고치지 않는다**`;
    }
    else {
      verdict = '⚠ 기간다름'; dateDiff++;
      detail = `인포크 ${best.open}~${best.end} (우리 ${r.open_date}~${r.end_date})`;
      fixes.push(`update gonggu set open_date='${best.open}', end_date='${best.end}' where id=${r.id};  -- ${r.name} / 인포크 원본`);
    }
    if (bestScore === 1) { detail += (detail ? ' · ' : '') + `이름 비슷함: 인포크 「${best.name}」`; if (verdict === '✅ 일치') { verdict = '⚠ 이름확인'; ok--; nameDiff++; } }
  } else if (feedHit) {
    verdict = '✅ 피드확인'; ok++;
    detail = `셀러 게시물 ${feedHit.t} 캡션에 상품 낱말 있음`;
  } else {
    verdict = '❔ 확인불가'; unknown++;
    detail = ip.length ? `인포크 ${ip.length}건 중 맞는 것 없음` : (posts.length ? `피드 ${posts.length}건에도 없음` : '인포크·피드 둘 다 자료 없음');
  }
  out.push(`| ${r.id} | ${r.insta} | ${r.name} | ${r.open_date}~${r.end_date} | ${r.src} | ${verdict} | ${detail} |`);
}

const rep = [
  `# 공구 행 검증 리포트 — ${KST().toISOString().slice(0, 16).replace('T', ' ')}`,
  ``,
  `대상 ${rows.length}건 · 셀러 ${handles.length}명 · source=${SRC || '전체'}`,
  ``,
  `**✅ 일치 ${ok} · ⚠ 기간다름 ${dateDiff} · ⚠ 이름확인 ${nameDiff} · ❔ 확인불가 ${unknown}**`,
  ``,
  `> ✅일치 = 셀러 인포크(또는 본인 인스타 게시물)에 같은 상품·같은 기간이 있다`,
  `> ⚠기간다름 = 상품은 맞는데 날짜가 다르다 — **인포크 값이 원본**이다(교정 SQL 을 만든다)`,
  `> 🔁재공구 = 인포크엔 지난 회차만 있고 우리 것은 진행 중 — 같은 상품의 **새 회차**다. 고치지 않는다`,
  `> ❔확인불가 = 인포크가 없거나(404·상시링크·달력이 이미지) 피드에도 흔적이 없다. **틀렸다는 뜻이 아니다**`,
  ``,
  `| id | 핸들 | 상품명 | 우리 기간 | 출처 | 판정 | 비고 |`,
  `|---|---|---|---|---|---|---|`,
  ...out,
].join('\n') + '\n';
writeFileSync(SP('verify_rows_report.md'), rep);
log(`✅ 일치 ${ok} · ⚠ 기간다름 ${dateDiff} · ⚠ 이름확인 ${nameDiff} · ❔ 확인불가 ${unknown} → scratchpad/verify_rows_report.md`);

if (has('--sql') && fixes.length) {
  writeFileSync(SP('_verify_fix.sql'),
    `-- 인포크 원본과 기간이 다른 행 ${fixes.length}건. 🔴 **눈으로 확인하고** 실행할 것 (자동 적용 금지)\n` + fixes.join('\n') + '\n');
  log(`교정 SQL ${fixes.length}건 → scratchpad/_verify_fix.sql (실행은 사람이 한다)`);
}

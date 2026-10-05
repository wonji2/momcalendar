/**
 * 달력에서 읽은 일정을 **한 셀러씩 등록**한다 (10월 달력 파싱 전용)
 *   사장님 지시 2026-10-05: *"24시간 내내 10월 달력 지금까지 올라온거 전부 파싱해놔라"* · *"밤새 돌려서 다 채워놔라"*
 *
 * 왜 도구로 만들었나
 *   셀러마다 SQL 을 손으로 쓰다가 **셀러 한글명을 지어내 「콩알맘/콩알픽」으로 갈라놓은 사고**가 났다.
 *   한글명은 **DB 에 이미 있는 값이 있으면 무조건 그것**을 쓰도록 SQL 안에 박았다(coalesce).
 *
 * 입력(JSON): { "h":"핸들", "kr":"한글명(DB 에 없을 때만 쓰인다)",
 *               "items":[ {"n":"상품명","d":"2026-10-08","e":"2026-10-12","mj":"식품","mi":"음료/차/즙"} ] }
 *   · `e`(마감) 를 빼면 **오픈+3일** — 달력에 날짜 하나만 적힌 경우 (사장님 2026-10-05)
 *   · 마감이 오픈+13일을 넘으면 **잘라낸다**(DB등록규칙 14일 상한)
 *   · 이미 끝난 것(마감 < 오늘)은 **넣지 않는다** — 넣어도 사이트에 안 보이는 쓰레기다
 * 실행: node tools/daily/cal_reg.mjs scratchpad/_cal_in.json [--dry]
 * 진행기록: scratchpad/calendar_read.jsonl 에 한 줄 덧붙인다
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';   // CLI 출력은 환경마다 세 가지다 — 공용 파서

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const READ = join(ROOT, 'scratchpad', 'calendar_read.jsonl');
const SQLF = join(ROOT, 'scratchpad', '_cal_reg.sql');
const NL = String.fromCharCode(10);
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.log('입력 JSON 을 주세요'); process.exit(1); }

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";


/** CATS_LIST (DB등록규칙 2번) — 여기 없는 대·소분류는 **넣기 전에 막는다**.
 *  2026-10-05: 「리빙/수납정리」를 넣었다가 등록 뒤에야 찾아냈다(수납정리는 인테리어 쪽이다). */
const CATS = {
  '육아': ['장난감/놀이','교구/교육','책','이유아식','의류잡화','방꾸미기','스킨로션','유모차카시트','육아용품','외출용품','목욕/세정'],
  '리빙': ['생활용품','주방용품','침구/패브릭','청소/세제','욕실용품','테이블웨어','헬스케어'],
  '식품': ['음료/차/즙','간식/구황작물','수산물/건해산','과일/야채','정육/계란','간편식/밀키트','유제품','장류/오일/소스','반찬','떡/베이커리','견과류','선물세트'],
  '건강': ['유산균','비타민','오메가','철분제','키즈영양제','홍삼/면역','다이어트','건강기능성'],
  '인테리어': ['가구','패브릭','조명','데코소품','수납정리','홈오피스'],
  '가전': ['생활가전','주방가전','청소가전','계절가전','영상가전','취미/디지털기기','컴퓨터용품','헬스케어'],
  '뷰티': ['스킨케어','메이크업','헤어케어','바디케어','구강케어','향수','뷰티디바이스'],
  '패션': ['이너웨어','신발','가방','스포츠웨어','액세서리','의류','키즈'],
  '여행': ['호텔/숙소','항공권','패키지/투어','체험/티켓','여행용품'],
  '반려동물': ['강아지','고양이','사료','간식'],
};

/** 🔴 **제외 셀러는 여기서 막는다** (사장님이 지정한 명단 — scratchpad/parsing_excluded.txt)
 *  2026-10-05: 달력 캡션을 읽다가 제외 셀러(끼끼맘)의 일정을 등록할 뻔했다.
 *  「내가 기억하고 있으니 괜찮다」가 아니라 **도구가 막아야** 다음 회차에서도 안 샌다. */
const EXC = (() => {
  const f = join(ROOT, 'scratchpad', 'parsing_excluded.txt');
  if (!existsSync(f)) return new Set();
  return new Set(readFileSync(f, 'utf8').split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => l.split(/\t|\s{2,}/)[0].trim().toLowerCase()).filter(Boolean));
})();

/** 🔴 **사장님이 차단한 브랜드**를 읽어 온다 (`brand_block` 표)
 *  서버 트리거 `brand_block_gonggu` 가 INSERT 를 **조용히 떨어뜨린다** — 오류도 안 난다.
 *  2026-10-05 실측: 「이젠 가습기」가 그렇게 사라졌고, 나는 「누락」인 줄 알고 한참 뒤졌다.
 *  여기서 먼저 걸러 **왜 안 들어갔는지 화면에 남긴다.** (메모리 brand-block-removal) */
function loadBlocked() {
  const f = join(ROOT, 'scratchpad', '_cal_block.sql');
  writeFileSync(f, 'select pattern from public.brand_block;', 'utf8');
  try {
    const got = parseRows(execFileSync(CLI, sbArgs(f), { encoding: 'utf8', timeout: 120e3, cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }));
    if (!got.ok) { console.log('⚠ brand_block 을 못 읽었다 — 차단 브랜드가 조용히 떨어질 수 있다'); return []; }
    return got.rows.map((r) => { try { return new RegExp(r.pattern, 'i'); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { console.log('⚠ brand_block 조회 실패'); return []; }
}
const BLOCKED = loadBlocked();

/** 🔴 **규칙 0-M** — 사장님 공구의 창(오픈−14일 ~ 마감) 안에서는 같은 상품을 넣지 않는다
 *  CLAUDE.md 는 「등록 게이트(파싱·카페크롤·인포크 수확 전부)」에 걸라고 하는데
 *  이 도구엔 없었다(2026-10-05 검증자 지적). 완전일치만 보면 「천연해면스펀지 vs 천연해면」이
 *  새므로 **브랜드 토큰(첫 낱말)**으로도 본다. */
function loadMine() {
  const f = join(ROOT, 'scratchpad', '_cal_mine.sql');
  writeFileSync(f, `select name, open_date, end_date from public.gonggu
 where insta = 'momcal_' and approved and end_date >= '${addDays(today, -1)}';`, 'utf8');
  try {
    const got = parseRows(execFileSync(CLI, sbArgs(f), { encoding: 'utf8', timeout: 120e3, cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }));
    if (!got.ok) { console.log('⚠ 내 공구를 못 읽었다 — 규칙 0-M 검사를 못 한다'); return []; }
    return got.rows.map((r) => ({ ...r, from: addDays(r.open_date, -14), brand: String(r.name).trim().split(/\s+/)[0] }));
  } catch (_) { console.log('⚠ 내 공구 조회 실패 — 규칙 0-M 검사를 못 한다'); return []; }
}
const MINE = loadMine();
/** 창 안이고 같은 상품이면 그 내 공구를 돌려준다 */
function myWindowHit(name, open) {
  const n = norm2(name);
  for (const m of MINE) {
    if (open < m.from || open > m.end_date) continue;
    if (dice2(n, norm2(m.name)) >= 0.55) return m;
    if (m.brand.length >= 3 && name.toLowerCase().startsWith(m.brand.toLowerCase())) return m;
  }
  return null;
}

/** 셀러의 **이미 노출 중인** 공구를 읽어 온다 (중복 판정용) */
function seedExisting(handle) {
  const f = join(ROOT, 'scratchpad', '_cal_exist.sql');
  writeFileSync(f, `select id, name, open_date from public.gonggu
 where insta = ${q(handle)} and approved and open_date >= '${addDays(today, -40)}';`, 'utf8');
  try {
    const out = execFileSync(CLI, sbArgs(f), { encoding: 'utf8', timeout: 180e3, cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    const got = parseRows(out);
    // 🔴 못 읽은 것과 0건을 구분한다 — 못 읽었는데 0건으로 보면 중복검사가 통째로 꺼진다
    if (!got.ok) { console.log(`🔴 @${handle} 기존 행을 못 읽었다 — 이 셀러는 건너뛴다(중복 위험)`); return null; }
    return got.rows;
  } catch (e) { console.log(`🔴 @${handle} 기존 행 조회 실패 — 건너뛴다`); return null; }
}
/** bigram Dice 유사도. 완전일치 말고 **닮은 것**을 잡는다 */
const norm2 = (s) => String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
const big2 = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
function dice2(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  const A = big2(a), B = big2(b); if (!A.size || !B.size) return 0;
  let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
}
const gapDays = (a, b) => Math.abs((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);
/** 오픈일 ±3일 안에 유사도 0.55 이상인 기존 행이 있으면 그 행을 돌려준다 */
function nearDup(existing, name, open) {
  if (!existing) return null;
  const n = norm2(name);
  for (const r of existing) {
    if (gapDays(r.open_date, open) > 3) continue;
    const sim = dice2(n, norm2(r.name));
    if (sim >= 0.55) return { ...r, sim };
  }
  return null;
}

const input = JSON.parse(readFileSync(file, 'utf8'));
const blocks = Array.isArray(input) ? input : [input];
let total = 0;
for (const b of blocks) {
  if (EXC.has(String(b.h).toLowerCase())) {
    console.log(`⛔ @${b.h} 제외 셀러다 — 등록하지 않는다 (scratchpad/parsing_excluded.txt)`);
    appendFileSync(READ, JSON.stringify({ h: b.h, read: true, result: 'skip:excluded' }) + NL, 'utf8');
    continue;
  }
  /** 🔴 **이미 있는 비슷한 공구**를 먼저 읽어 둔다 (2026-10-05 검증자 불통과 ①)
   *  아래 SQL 의 `not exists` 는 「완전히 같은 날짜 + 완전히 같은 이름」만 막는다.
   *  그 바람에 1,084건 중 **164쌍이 이미 있던 행과 같은 공구**로 들어가 손님 화면에 두 번 떴다
   *  (「퓌레/퓨레」·「네블/네뷸」 오타 · 어순 바뀜 · 낱말 하나 추가 · 오픈일 ±1~3일).
   *  메모리 `dup-check-three-holes` 가 말한 구멍 그대로다. 이제 **여기서** 막는다. */
  const existing = seedExisting(b.h);
  const rows = [];
  let capped = 0, old = 0, bad = 0, dup = 0, blocked = 0, mine = 0;
  for (const it of b.items) {
    let e = it.e || addDays(it.d, 3);
    const max = addDays(it.d, 13);
    if (e > max) { e = max; capped++; }
    if (!CATS[it.mj] || !CATS[it.mj].includes(it.mi)) {
      console.log(`🔴 @${b.h} 「${it.n}」 분류가 CATS_LIST 밖이다 — ${it.mj}/${it.mi}`); bad++; continue;
    }
    if (e < today) { old++; continue; }                 // 이미 끝난 것은 넣지 않는다
    const blk = BLOCKED.find((re) => re.test(it.n));
    if (blk) {
      console.log(`  ⛔ @${b.h} 「${it.n}」 — 사장님이 차단한 브랜드다 (brand_block: ${blk.source})`);
      blocked++; continue;
    }
    const my = myWindowHit(it.n, it.d);
    if (my) {
      console.log(`  🚫 @${b.h} 「${it.n}」(${it.d}) — 규칙 0-M: 내 공구 「${my.name}」(${my.open_date}~${my.end_date}) 창 안이다`);
      mine++; continue;
    }
    const hit = nearDup(existing, it.n, it.d);
    if (hit) {
      console.log(`  ↩ @${b.h} 「${it.n}」(${it.d}) — 이미 있다: id${hit.id} 「${hit.name}」(${hit.open_date}) 닮음 ${hit.sim.toFixed(2)}`);
      dup++; continue;
    }
    rows.push(`(${q(it.n)},${q(it.d)},${q(e)},${q(it.mj)},${q(it.mi)})`);
  }
  if (bad) { console.log(`🔴 @${b.h} 분류가 틀린 ${bad}건은 넣지 않았다 — 고쳐서 다시 돌릴 것`); }
  if (!rows.length) {
    const why = [old ? `지난 일정 ${old}건` : '', dup ? `이미 있는 것 ${dup}건` : '',
      blocked ? `차단 브랜드 ${blocked}건` : '', mine ? `규칙0-M ${mine}건` : '', bad ? `분류 틀림 ${bad}건` : ''].filter(Boolean).join(' · ') || '넣을 것 없음';
    console.log(`@${b.h} — 넣을 것이 없다 (${why})`);
    appendFileSync(READ, JSON.stringify({ h: b.h, kr: b.kr, read: true, result: 'reg:0', why }) + NL, 'utf8');
    continue;
  }
  const sql = `insert into public.gonggu (name, insta, influencer, open_date, end_date, major, minor, approved, cat_manual, source)
select v.name, ${q(b.h)},
       coalesce((select g2.influencer from public.gonggu g2
                  where g2.insta = ${q(b.h)} and coalesce(g2.influencer,'') <> ''
                    and g2.influencer !~ '^[A-Za-z0-9._]+$'
                  group by g2.influencer order by count(*) desc limit 1), ${q(b.kr || b.h)}),
       v.d, v.e, v.mj, v.mi, true, true, 'insta_cal'
  from (values ${NL}  ${rows.join(',' + NL + '  ')}
) as v(name, d, e, mj, mi)
 where not exists (select 1 from public.gonggu g
   where g.insta = ${q(b.h)} and g.open_date = v.d
     and lower(regexp_replace(g.name,'[^가-힣a-z0-9]','','g')) = lower(regexp_replace(v.name,'[^가-힣a-z0-9]','','g')))
returning id, name, open_date, end_date;${NL}`;
  writeFileSync(SQLF, sql, 'utf8');
  if (DRY) { console.log(sql); continue; }
  let n = 0, err = '';
  try {
    // 🔴 `reg:N` 은 **진짜 들어간 행 수**여야 한다 — 진행표(calendar_read.jsonl)가 재개 근거라
    //    과다 집계면 다음 사람이 안 한 일을 했다고 보고 건너뛴다(2026-10-05 13건 어긋남).
    //    returning 한 행만 세도록 공용 파서로 읽는다.
    const out = execFileSync(CLI, sbArgs(SQLF), { encoding: 'utf8', timeout: 300e3, cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    const got = parseRows(out);
    if (!got.ok) throw new Error('CLI 출력을 못 읽었다 — 들어갔는지 알 수 없다');
    n = got.rows.length;
  } catch (e) { err = String(e.stdout || e.message || '').replace(/\s+/g, ' ').slice(0, 160); }
  const note = [capped ? `14일상한 ${capped}건` : '', old ? `지난것 ${old}건 뺌` : '', dup ? `이미 있어 뺀 것 ${dup}건` : '', blocked ? `차단 브랜드 ${blocked}건` : '', mine ? `규칙0-M ${mine}건` : ''].filter(Boolean).join(' · ');
  console.log(err ? `🔴 @${b.h} 실패 — ${err}` : `✅ @${b.h} ${n}건 등록 (표 ${rows.length}건)${note ? ' · ' + note : ''}`);
  appendFileSync(READ, JSON.stringify({ h: b.h, kr: b.kr, read: true, result: err ? 'fail' : `reg:${n}`, of: rows.length, why: err || note || undefined }) + NL, 'utf8');
  total += n;
}
console.log(`끝 — 모두 ${total}건 등록`);

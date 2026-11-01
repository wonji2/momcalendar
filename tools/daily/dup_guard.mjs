/**
 * 🔁 공구 중복 사후 감시 — 게이트가 놓친 중복을 **등록된 뒤에** 잡는다 (2026-09-09 신설)
 *
 * 왜 만들었나 (남약사 '킬레이트 마그네슘' 중복 사고):
 *   게이트(pending_check/gate_filter)는 **등록 시점의 규칙**으로만 막는다.
 *   문제의 행은 2026-09-03 에 들어왔고, 그걸 잡는 규칙 ⑤(4글자 조각)는 **09-07 에 추가**됐다.
 *   즉 규칙을 아무리 보강해도 **그 전에 들어온 중복은 영원히 DB 에 남는다** — 사장님이 눈으로 찾기 전까지.
 *   → 게이트와 **독립된 판정**으로 매일 전수 훑어 health_alerts 에 올린다. 차단이 아니라 신고다.
 *
 * 판정 (게이트 규칙 ⑥ 과 같은 뿌리, 단 사후라서 더 넓게 본다)
 *   같은 셀러 + 기간 겹침 + **끝말(핵심 품목어) 동일** + 의미 낱말 2개 이상 공유
 *   ⚠ 끝말이 '선물세트·시리즈' 같은 일반 품목어면 뺀다 — '서해한과 선물세트'↔'제주 갈치 선물세트' 는 다른 상품이다.
 *   ⚠ 이 넓은 판정은 **신고만** 한다 — 다른 브랜드 같은 품목(데이타민↔갓스펙 칼마디 미네랄)은 정상 공구다.
 *
 * 🗑 단 **완전히 똑같은 것은 승인 없이 자동 삭제**한다 (사장님 2026-09-09)
 *   "날짜 상품명이 같은게 중복이지 날짜가 다른건 재공구니까 중복아니지"
 *   = 같은 셀러 + 상품명 글자까지 동일 + 오픈일 동일 → id 작은 쪽만 남기고 지운다(전 컬럼 백업 후).
 *   오픈일이 다르면 재공구라 손대지 않는다.
 *
 * 실행   node tools/daily/dup_guard.mjs           (예약작업 momcal-dup-guard, 매일 09:20)
 *        node tools/daily/dup_guard.mjs --all     이미 본 쌍도 다시 보고
 * 상태   scratchpad/dup_guard_seen.json  — 한 번 올린 쌍은 다시 안 올린다(같은 경보 반복 방지)
 * 로그   scratchpad/dup_guard_log.txt    — 최신이 맨 위
 * 경보   health_alerts(kind='공구중복의심')  — 세션이 시작할 때 보는 곳
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
// 🔴 CLI 출력은 **환경마다 모양이 다르다**(터미널 vs 예약작업). 직접 파싱하면 예약작업만 조용히 죽는다.
//    2026-09-09 검증자 실측: 콘솔 없는 프로세스에서 stdout 이 'Initialising login role...' 뿐이라
//    indexOf('"rows"') 가 -1 이 되어 매 회차 exit 1 이었다 — 손으로 돌리면 멀쩡해서 안 보인다.
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);                 // ⚠ 예약작업 cwd 는 System32 — supabase --linked 가 프로젝트를 못 찾는다
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SEEN = path.join(ROOT, 'scratchpad', 'dup_guard_seen.json');
const LOG = path.join(ROOT, 'scratchpad', 'dup_guard_log.txt');
const ALL = process.argv.includes('--all');

const stampFile = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0,16).replace(/[-:T]/g,'');
const out = [];
const say = (s) => { console.log(s); out.push(s); };
const sql = (text) => {
  const f = path.join(ROOT, 'scratchpad', '_dupguard_tmp.sql');
  fs.writeFileSync(f, text, 'utf8');
  try {
    const o = execFileSync(CLI, sbArgs(f), { encoding: 'utf8', maxBuffer: 1 << 24 });
    const p = parseRows(o);
    if (!p.ok) throw new Error('CLI 출력을 못 읽었다 — ' + p.why);   // 못 읽은 것과 0건을 구분한다
    return p.rows;
  } finally { try { fs.unlinkSync(f); } catch (_) {} }
};

const Q = `
with t as (
  select id, insta, influencer, name, open_date, end_date,
         (select array_agg(w) from unnest(string_to_array(
            regexp_replace(regexp_replace(lower(name),'[^가-힣a-z0-9]',' ','g'),'\\s+',' ','g'), ' ')) w
           where length(w) >= 2
             and w not in ('모음전','기획전','선물세트','세트','대용량','증정','한정','특가','무료배송','리필','추가','구성',
                           '선물','패키지','신상','인기','최저가','공구','단독','기본','프리미엄','오리지널','업그레이드',
                           '국산','국내산','예약','앵콜','런칭','오픈','핫딜','추석','명절','할인','사은품','전품목','골라담기')) toks
    from gonggu where approved and coalesce(insta,'') <> ''
      and end_date >= to_char((now() at time zone 'Asia/Seoul') - interval '30 days','YYYY-MM-DD')
), u as (
  select *, toks[cardinality(toks)] tail from t where toks is not null and cardinality(toks) >= 2
)
select a.id id1, b.id id2, a.name n1, b.name n2, a.influencer, a.insta,
       a.open_date o1, b.open_date o2, a.end_date e1, b.end_date e2, a.tail,
       (a.end_date >= to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')) live
  from u a join u b on a.insta = b.insta and a.id < b.id
   and a.open_date <= b.end_date and b.open_date <= a.end_date
   and a.tail = b.tail
 where a.tail not in ('선물세트','선물','기획','모음','상품','제품','시리즈','구성','패키지','에디션','증정품')
   and (select count(*) from (select unnest(a.toks) intersect select unnest(b.toks)) i) >= 2
 order by a.open_date desc;`;

// ── 0단계. **완전히 똑같은 것은 승인 없이 지운다** (사장님 지시 2026-09-09)
//   > "완전히 똑같은건 승인 안받아도 니가 알아서 당연히 지워야지"
//   > "날짜 상품명이 같은게 중복이지 날짜가 다른건 재공구니까 중복아니지"
//   판정: 같은 셀러 + **상품명이 글자까지 같고** + **오픈일도 같다**  → 한 공구가 두 번 들어간 것. id 작은 쪽(먼저 등록)만 남긴다.
//   ⚠ 오픈일이 다르면 손대지 않는다 — 명희홈쿡 바로육수 7/13·8/10·9/8 처럼 매달 다시 파는 게 정상이다(전 DB 153쌍이 이 경우다).
//   ⚠ 표기만 같은 것(공백·기호 차이)은 **자동 삭제하지 않는다** — 어느 표기를 남길지는 셀러 원문을 봐야 한다. 아래 신고로만 간다.
try {
  const dead = sql(`
    with t as (select id, insta, influencer, name, open_date, end_date from gonggu where approved and coalesce(insta,'') <> ''),
    d as (select b.id from t a join t b on a.insta=b.insta and a.name=b.name and a.open_date=b.open_date and a.id<b.id)
    select g.* from gonggu g where g.id in (select id from d);`);
  if (dead.length) {
    const bak = path.join(ROOT, 'scratchpad', `자동삭제_완전중복_${stampFile()}.json`);
    fs.writeFileSync(bak, JSON.stringify(dead, null, 1), 'utf8');   // 전 컬럼 백업 — 되돌릴 수 있게
    sql(`delete from gonggu where id in (${dead.map((r) => Number(r.id)).join(',')});`);
    sql(`delete from wishes w where not exists (select 1 from gonggu g where g.id=w.gonggu_id) and w.gonggu_id in (${dead.map((r) => Number(r.id)).join(',')});`);
    say(`🗑 완전 중복(이름·오픈일 동일) ${dead.length}건 자동 삭제 — 백업 ${path.basename(bak)}`);
    for (const r of dead) say(`   #${r.id} ${r.name} | ${r.influencer} | ${r.open_date}~${r.end_date}`);
    const q0 = (t) => "'" + String(t).replace(/'/g, "''") + "'";
    sql(`insert into health_alerts(kind, detail) values ('공구완전중복자동삭제', ${q0(dead.map((r) => `#${r.id} ${r.name}`).join(' · ').slice(0, 380))});`);
  } else say('🗑 완전 중복(이름·오픈일 동일) 없음');
} catch (e) { say('🔴 완전 중복 자동 삭제 실패: ' + String(e.message || e).slice(0, 150)); }

let rows;
try { rows = sql(Q); }
catch (e) { console.error('🔴 조회 실패: ' + String(e.message || e).slice(0, 200)); process.exit(1); }

const seen = ALL ? {} : (fs.existsSync(SEEN) ? JSON.parse(fs.readFileSync(SEEN, 'utf8')) : {});
// 🔴 "한 번 보면 영영 안 뜬다" 를 막는다 (2026-09-09 검증자 지적)
//    ① 종료된 쌍은 경보 없이 seen 에 박혔다 → 나중에 마감이 연장돼 다시 손님에게 보여도 알림이 안 갔다.
//       그래서 **그때 진행중이었는지(live)** 를 같이 적고, 종료로 적힌 쌍이 진행중이 되면 다시 올린다.
//    ② 경보 INSERT 가 실패해도 seen 에 넣던 것도 고쳤다(아래) — 실패하면 다음 회차에 다시 시도한다.
const wasLive = (k) => { const v = seen[k]; return v && typeof v === 'object' ? !!v.live : !!v; };
const fresh = rows.filter((r) => {
  const k = `${r.id1}-${r.id2}`;
  if (!seen[k]) return true;
  return r.live && !wasLive(k);   // 종료로 기록됐는데 지금 진행중이면 다시 본다
});
const live = fresh.filter((r) => r.live);
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

say(`🔁 공구 중복 감시 ${stamp} — 최근 30일 대상 · 후보 ${rows.length}쌍 · 새 ${fresh.length}쌍(진행중 ${live.length})`);
for (const r of fresh) {
  say(`  ${r.live ? '🔴 진행중' : '   종료  '} ${r.influencer}(${r.insta}) [${r.tail}]`);
  say(`      #${r.id1} ${r.n1} (${r.o1}~${r.e1})`);
  say(`      #${r.id2} ${r.n2} (${r.o2}~${r.e2})`);
}
if (!fresh.length) say('  새 중복 의심 없음');

// 경보는 **진행중인 것만** 올린다 — 이미 끝난 공구는 손님에게 안 보인다
let alerted = false;
if (live.length) {
  const detail = live.map((r) => `${r.influencer} #${r.id1}${r.n1} ↔ #${r.id2}${r.n2}`).join(' · ').slice(0, 380);
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  try {
    sql(`insert into health_alerts(kind, detail) select '공구중복의심', ${q(detail)}
          where not exists (select 1 from health_alerts where kind='공구중복의심' and detail=${q(detail)} and created_at > now() - interval '24 hours');`);
    say(`  → health_alerts '공구중복의심' ${live.length}건 등록`);
    alerted = true;
  } catch (e) { say('  🔴 경보 등록 실패: ' + String(e.message || e).slice(0, 120)); }
}

// 🔴 경보를 **실제로 올린 것만** seen 처리한다. INSERT 가 실패했는데 seen 에 넣으면 그 중복은 영영 안 뜬다.
for (const r of fresh) {
  if (r.live && !alerted) continue;   // 알리지 못했으면 다음 회차에 다시 본다
  seen[`${r.id1}-${r.id2}`] = { at: stamp, live: !!r.live };
}
fs.writeFileSync(SEEN, JSON.stringify(seen, null, 1), 'utf8');

// ── 핫딜 중복도 같이 본다 (2026-09-09 신설) ──────────────────────────
// 왜: 같은 지마켓 상품(gm_2330457301)이 id 640·753 으로 **둘 다 노출 중**이었다. 하나는 18,130원 더 비쌌고,
//     둘 다 품절이었다. 공구에는 감시가 있는데 핫딜에는 없어서 아무도 못 잡았다(검증자 지적).
// 판정: 노출 중(expires_at null 또는 미래) 행에서 product_id 가 겹치면 즉시 신고한다.
//     접두어(lp_gm_·gm_·toss_·oh_ …)를 벗겨 대조한다 — 같은 상품이 소스만 달리 들어오는 일이 있다.
// ⚠ 자동으로 내리지 않는다. 어느 쪽을 남길지는 가격·조건을 봐야 하므로 사람이 정한다.
try {
  const hd = sql(`select regexp_replace(product_id,'^(lp_gm_|gm_|lp_11st_|11st_|lp_gmarket_|lp_bori_|toss_|oh_|cp_|ap_|ssg_)','') core,
                         count(*) n,
                         string_agg(id::text||':'||coalesce(mall,'?')||':'||price::text, ' / ' order by id) rows
                    from public.hotdeals
                   where (expires_at is null or expires_at > now())
                     and product_id is not null and product_id <> ''
                   group by 1 having count(*) > 1 order by n desc;`);
  if (!hd.length) say('🔥 핫딜 중복 없음 (노출 중 product_id 전수)');
  else {
    say(`🔥 핫딜 중복 ${hd.length}건 — 같은 상품이 두 장 이상 노출 중`);
    for (const r of hd) say(`   [${r.core}] ${r.rows}`);
    const detail = hd.map((r) => `${r.core}: ${r.rows}`).join(' · ').slice(0, 380);
    const q2 = (t) => "'" + String(t).replace(/'/g, "''") + "'";
    sql(`insert into health_alerts(kind, detail) select '핫딜중복노출', ${q2(detail)}
          where not exists (select 1 from health_alerts where kind='핫딜중복노출' and detail=${q2(detail)} and created_at > now() - interval '24 hours');`);
    say('  → health_alerts 핫딜중복노출 등록');
  }
} catch (e) { say('🔴 핫딜 중복 검사 실패: ' + String(e.message || e).slice(0, 120)); }

const prev = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
fs.writeFileSync(LOG, out.join('\n') + '\n\n' + prev.split('\n').slice(0, 500).join('\n'), 'utf8');

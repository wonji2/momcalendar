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
 *   ⚠ **자동 삭제하지 않는다.** 다른 브랜드 같은 품목(데이타민↔갓스펙 칼마디 미네랄)은 정상 공구다. 사람이 판정한다.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);                 // ⚠ 예약작업 cwd 는 System32 — supabase --linked 가 프로젝트를 못 찾는다
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SEEN = path.join(ROOT, 'scratchpad', 'dup_guard_seen.json');
const LOG = path.join(ROOT, 'scratchpad', 'dup_guard_log.txt');
const ALL = process.argv.includes('--all');

const out = [];
const say = (s) => { console.log(s); out.push(s); };
const sql = (text) => {
  const f = path.join(ROOT, 'scratchpad', '_dupguard_tmp.sql');
  fs.writeFileSync(f, text, 'utf8');
  try {
    const o = execFileSync(CLI, ['db', 'query', '--linked', '-f', f], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const i = o.indexOf('"rows"');
    if (i < 0) throw new Error('CLI 출력을 못 읽었다 — ' + o.slice(0, 160));
    return JSON.parse(o.slice(o.lastIndexOf('{', i))).rows || [];
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

let rows;
try { rows = sql(Q); }
catch (e) { console.error('🔴 조회 실패: ' + String(e.message || e).slice(0, 200)); process.exit(1); }

const seen = ALL ? {} : (fs.existsSync(SEEN) ? JSON.parse(fs.readFileSync(SEEN, 'utf8')) : {});
const fresh = rows.filter((r) => !seen[`${r.id1}-${r.id2}`]);
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
if (live.length) {
  const detail = live.map((r) => `${r.influencer} #${r.id1}${r.n1} ↔ #${r.id2}${r.n2}`).join(' · ').slice(0, 380);
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  try {
    sql(`insert into health_alerts(kind, detail) select '공구중복의심', ${q(detail)}
          where not exists (select 1 from health_alerts where kind='공구중복의심' and detail=${q(detail)} and created_at > now() - interval '24 hours');`);
    say(`  → health_alerts '공구중복의심' ${live.length}건 등록`);
  } catch (e) { say('  🔴 경보 등록 실패: ' + String(e.message || e).slice(0, 120)); }
}

for (const r of fresh) seen[`${r.id1}-${r.id2}`] = stamp;
fs.writeFileSync(SEEN, JSON.stringify(seen, null, 1), 'utf8');
const prev = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
fs.writeFileSync(LOG, out.join('\n') + '\n\n' + prev.split('\n').slice(0, 500).join('\n'), 'utf8');

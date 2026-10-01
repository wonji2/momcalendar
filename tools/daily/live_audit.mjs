/**
 * 🔎 **라이브 사후 감시 — 하루 한 번 노출중인 공구를 훑어 걸러낸다**
 *
 * 사장님 지시 2026-10-01:
 *   *"상한은 왜있어 상한없이 다 올리고 하루에 한번 중복db나 말이 안되는 상품이나 셀러가 오류라거나
 *    공구가 아니라거나 이런거 걸러"*
 *
 * 🔑 **막는 쪽에서 거르는 쪽으로.** 등록 상한을 없앴으니 들어올 건 다 들어온다.
 *    대신 하루 한 번 **노출중(approved=true)인 행 전수**를 보고 못 쓸 것을 내린다.
 *
 * 분담 (중복은 이미 다른 도구가 본다 — 겹치게 만들지 않는다)
 *   `dup_guard.mjs`  (momcal-dup-guard  매일 09:20) — **중복**. 완전 동일은 삭제, 의심은 신고
 *   `cat_guard.mjs`  (momcal-cat-guard)             — **분류** 이탈
 *   **이 파일**       (momcal-live-audit 매일 09:50) — ① 말이 안 되는 상품명 ② 셀러 오류 ③ 공구 아님
 *
 * 무엇을 하나
 *   ① **말이 안 되는 상품명** — 판정은 `drop_badname.mjs` 의 `badReason` 을 **그대로 쓴다**
 *      (규칙을 두 곳에 적지 않는다 — 메모리 `same-flaw-in-sibling-code`)
 *   ② **셀러 오류** — 핸들 칸이 비었거나, 인포크 **슬러그**가 핸들 칸에 들어간 행
 *      (슬러그는 `seller_inpock` 매핑으로 **고칠 수 있으면 고친다**. 못 고치면 내린다)
 *   ③ **공구 아님** — 상품명 칸에 진료·수강·공연 같은 것이 들어온 행 (①의 `공구아님` 사유)
 *
 * 🔑 **지우지 않는다. 노출만 내린다**(`approved=false`) — 되돌릴 수 있어야 한다.
 *    완전 동일 중복만 `dup_guard` 가 지운다(사장님 2026-09-09 승인).
 * 🔑 사람이 볼 수 있게 내린 행을 **전부 로그에 남긴다**. 숫자만 남기면 무엇을 내렸는지 모른다.
 *
 *   node tools/daily/live_audit.mjs [--dry]
 * 로그: scratchpad/live_audit_log.txt (최신이 아래)
 * 주기: 윈도우 예약작업 momcal-live-audit — 매일 09:50
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { badReason, HARD, FIXABLE, stripTail } from './drop_badname.mjs';
// 🔴 CLI 출력은 환경마다 모양이 다르다 — 직접 파싱하면 예약작업만 조용히 죽는다.
//    공용 파서를 쓴다(메모리 cli-rows-wrapper-is-the-terminal).
import { sbArgs, parseRows } from './sb_query.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const LOG_F = SP('live_audit_log.txt');
const SBX = fs.existsSync('C:/Users/FAMILY/supabase-cli/supabase.exe') ? 'C:/Users/FAMILY/supabase-cli/supabase.exe' : 'supabase';
const DRY = process.argv.includes('--dry');

const KST = () => new Date(Date.now() + 9 * 3600e3);
const log = (s) => {
  const l = `[${KST().toISOString().slice(0, 16).replace('T', ' ')}] ${s}`;
  console.log(l);
  try { fs.appendFileSync(LOG_F, l + '\n'); } catch { }
};
// 🔴 예약작업은 stderr 를 버린다 — 로그 파일에 남긴다 (메모리 scheduled-task-swallows-stderr)
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => { log(`🔴🔴 ${ev} — ${String((e && e.stack) || e).split('\n').slice(0, 6).join(' | ')}`); process.exit(1); });
}

// SQL 은 **파일로** 넘긴다(인자로 주면 한글·따옴표가 셸을 지나며 깨진다) + 공용 인자 생성기
const SQL_F = SP('_live_audit.sql');
const q = (sql, timeout = 300e3) => {
  fs.writeFileSync(SQL_F, sql + '\n', 'utf8');
  return execFileSync(SBX, sbArgs(SQL_F), { encoding: 'utf8', cwd: ROOT, timeout, maxBuffer: 64 * 1024 * 1024 });
};
/** 읽기 — 못 읽은 것과 0건을 가른다. 🔴 큰 결과는 CLI 가 JSON 을 여러 번 뱉어 파싱이 깨진다 → 1000행씩 */
const qRows = (sql, what) => {
  const r = parseRows(q(sql));
  if (!r.ok) { log(`🔴 ${what} 조회를 못 읽었다 — ${r.why}`); process.exit(1); }
  return r.rows;
};
const qPaged = (mkSql, what, pageSize = 1000, maxPages = 20) => {
  const all = [];
  for (let p = 0; p < maxPages; p++) {
    const batch = qRows(mkSql(pageSize, p * pageSize), `${what}(${p + 1}쪽)`);
    all.push(...batch);
    if (batch.length < pageSize) return all;
  }
  log(`⚠ ${what} — ${maxPages}쪽(${maxPages * pageSize}행)에서 끊었다. 더 있으면 다음 회차에 본다`);
  return all;
};

log('════ 라이브 사후 감시 시작 ════');

// ── 노출중이고 아직 안 끝난 행 전수
const rows = qPaged((lim, off) => `select g.id, coalesce(g.name,'') as name, coalesce(g.insta,'') as insta,
                         coalesce(g.influencer,'') as influencer
                    from gonggu g
                   where g.approved
                     and coalesce(g.end_date,'') >= to_char((now() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')
                   order by g.id desc limit ${lim} offset ${off}`, '노출중 행');
// 🔑 0건은 「깨끗하다」가 아니라 **내 조회가 틀렸다**는 뜻일 수 있다 (규칙 0-P)
if (!rows.length) { log('🔴 노출중 행 0건 — 조회가 틀렸는지 확인할 것 (0 을 깨끗함으로 읽지 않는다)'); process.exit(1); }
log(`노출중 ${rows.length}행 훑는다`);

// ── 인포크 슬러그 ↔ 인스타 핸들 매핑 (슬러그가 핸들 칸에 들어간 행을 고치기 위해)
//    메모리 inpock-slug-vs-insta-handle: 892쌍 중 430쌍이 다르다. 매핑은 DB seller_inpock 한 곳.
const slug2handle = new Map();
const slugSet = new Set();
try {
  for (const r of qPaged((lim, off) => `select coalesce(slug,'') as slug, coalesce(insta,'') as insta from seller_inpock where coalesce(slug,'')<>'' order by slug limit ${lim} offset ${off}`, '인포크 매핑')) {
    const s = String(r.slug).toLowerCase(), h = String(r.insta || '').replace(/^@+/, '').toLowerCase();
    slugSet.add(s);
    if (h && h !== s) slug2handle.set(s, h);
  }
  log(`  인포크 슬러그 ${slugSet.size}개 (핸들이 다른 것 ${slug2handle.size}개)`);
} catch (e) {
  // 🔑 매핑을 못 읽었으면 **슬러그 검사를 하지 않는다** — 멀쩡한 핸들을 슬러그로 오판해 내리면 더 나쁘다
  log(`  ⚠ seller_inpock 을 못 읽었다(${String(e.message || e).slice(0, 80)}) — 슬러그 검사는 건너뛴다`);
}

// ── 판정
const down = [];   // 내릴 행 [id, 사유, 이름]
let noSeller = 0;  // 빈 셀러 — 카페 경로는 일부러 비운다(내리지 않고 센다)
const fixN = [];   // 이름만 고칠 행 [id, 전, 후]
const soft = [];   // 신고만 할 행 [id, 사유, 이름, 핸들] — 내리지 않는다
const fixH = [];   // 핸들을 고칠 행 [id, 슬러그, 핸들]
for (const r of rows) {
  const name = String(r.name || '').trim();
  const insta = String(r.insta || '').replace(/^@+/, '').toLowerCase();

  // ① 말이 안 되는 상품명 + ③ 공구 아님 (판정은 drop_badname 의 것을 그대로 쓴다)
  const why = badReason(name);
  if (why) {
    if (FIXABLE.has(why)) {
      // 꼬리만 붙은 것 — 상품은 멀쩡하다. **이름을 고치고 살린다**
      const fixed = stripTail(name);
      if (fixed) { fixN.push([r.id, name, fixed]); continue; }
      down.push([r.id, `상품명(${why}·못 고침)`, name, insta]); continue;
    }
    if (HARD.has(why)) { down.push([r.id, `상품명(${why})`, name, insta]); continue; }
    // 그 밖(행사명·판촉문구·브랜드없음)은 **내리지 않고 신고만** 한다 —
    // 라이브 실측에서 「프로쉬 11월 정규 기획전」 같은 정상 공구가 여기 걸렸다
    soft.push([r.id, why, name, insta]); continue;
  }
  if (name.replace(/\s/g, '').length < 2) { down.push([r.id, '상품명 너무 짧음', name, insta]); continue; }

  // ② 셀러 오류
  // 🔴🔴 2026-10-01 실측으로 되돌린 것 — 처음엔 「셀러 칸이 비면 내린다」로 만들었다가 **78건이 걸렸고
  //    전부 진짜 상품이었다**(보노제작소 네임테이프·트루오 굴소스·아가드 미아방지 스마트태그…).
  //    카페 경로는 사장님 지시로 **일부러 셀러명을 비운다** — *"카페로가는건 셀러명 비워둬야지"*.
  //    사장님이 말씀하신 건 **「셀러가 오류」**지 「셀러가 비었다」가 아니다.
  //    → 빈 셀러는 **내리지 않고 숫자만 센다.** 내릴 것은 「틀린 값이 들어간」 경우뿐이다.
  if (!insta && !String(r.influencer || '').trim()) { noSeller++; }
  if (insta && slugSet.size && slugSet.has(insta) && slug2handle.has(insta)) {
    // 핸들 칸에 인포크 슬러그가 들어갔다 → 매핑이 있으면 고친다 (내리지 않는다)
    fixH.push([r.id, insta, slug2handle.get(insta), name]);
  }
}

log(`판정 — 내릴 행 ${down.length} · 이름 고칠 행 ${fixN.length} · 핸들 고칠 행 ${fixH.length} · 신고만 ${soft.length} · (빈 셀러 ${noSeller}행은 카페 경로라 그대로 둔다)`);
const byWhy = {};
for (const [, w] of down) { const k = w.replace(/\(.*/, ''); byWhy[k] = (byWhy[k] || 0) + 1; }
for (const [k, v] of Object.entries(byWhy)) log(`    ${k}: ${v}건`);

// ── 사람이 볼 수 있게 전부 남긴다 (숫자만 남기면 무엇을 내렸는지 모른다)
for (const [id, w, name, insta] of down) log(`    ⬇ ${id}\t${w}\t@${insta}\t${name}`);
for (const [id, a, b] of fixN) log(`    ✎ ${id}\t이름 「${a}」 → 「${b}」`);
for (const [id, s, h, name] of fixH) log(`    ✎ ${id}\t핸들 ${s} → ${h}\t${name}`);
// 🔑 신고만 하는 것도 **전부 남긴다** — 사람이 보고 진짜 쓰레기면 명단에 넣거나 규칙을 좁힌다
for (const [id, w, name, insta] of soft) log(`    ⚠ ${id}\t${w}(신고만·내리지 않음)\t@${insta}\t${name}`);

if (DRY) { log('--dry — DB 를 고치지 않았다'); log('════ 끝 ════'); process.exit(0); }

// ── 실행 (지우지 않는다. 노출만 내린다)
let okDown = 0, okFix = 0, okName = 0;
if (down.length) {
  for (let i = 0; i < down.length; i += 200) {
    const ids = down.slice(i, i + 200).map(([id]) => id).join(',');
    try { q(`update gonggu set approved=false where id in (${ids})`); okDown += Math.min(200, down.length - i); }
    catch (e) { log(`🔴 내리기 실패 (${i}~) — ${String(e.message || e).slice(0, 140)}`); }
  }
}
for (const [id, , b] of fixN) {
  try { q(`update gonggu set name='${b.replace(/'/g, "''")}', cat_manual=true where id=${id}`); okName++; }
  catch (e) { log(`🔴 이름 고치기 실패 ${id} — ${String(e.message || e).slice(0, 120)}`); }
}
for (const [id, , h] of fixH) {
  try { q(`update gonggu set insta='${h.replace(/'/g, "''")}' where id=${id}`); okFix++; }
  catch (e) { log(`🔴 핸들 고치기 실패 ${id} — ${String(e.message || e).slice(0, 120)}`); }
}

// ── 되읽어 확인한다. 「실행했다」는 확인이 아니다
let stillUp = -1;
if (down.length) {
  try {
    const out = q(`select count(*) as n from gonggu where approved and id in (${down.map(([id]) => id).join(',')})`);
    const m = out.match(/"n":\s*"?(\d+)/); stillUp = m ? +m[1] : -1;
  } catch { }
}
log(`실행 — 내림 ${okDown}/${down.length} · 이름 고침 ${okName}/${fixN.length} · 핸들 고침 ${okFix}/${fixH.length} · 되읽어보니 아직 노출중 ${stillUp < 0 ? '?' : stillUp}건`);
if (stillUp > 0) log(`🔴 내렸다고 했는데 ${stillUp}건이 아직 노출중이다 — 사람이 확인할 것`);
log('════ 끝 ════');
process.exit(stillUp > 0 ? 1 : 0);

// 🎁 출석 경품 당첨자 보고 — /당첨자 1단계 (사장님 지시 2026-10-21)
//   *"당첨자 니가 자동으로 뽑아서 명단 나한테 보내고 전화번호도 보내고 누가 뭐 당첨인지도 보내고 카드도 보내봐
//     그 모든거 마치고 내가 선물 발송도 완료하면 그 다음 발표하게"*
//
// 흐름 (한 달에 한 번)
//   ① 매월 1일 09:00 KST pg_cron attendance-auto-draw 가 지난달을 **추첨만** 한다(승인·안내는 안 한다 — 사장님 2026-11-05 「맘대로 안내 나가지 말고 나한테 물어보고 보고하고 안내해」).
//      추첨은 한 번도 안 뽑힌 사람 우선, 기당첨자는 어쩔 수 없을 때만(supabase/sql/attend_draw_fair_133.sql)
//   ② /당첨자 → 이 도구: 추첨이 안 됐으면 뽑고, 명단·이전 당첨 이력·연락처·경품 표 + 카드 미리보기를 만든다. **승인(당첨 안내)은 사장님이 「안내해」 하신 뒤 --approve 로만**
//      → 세션이 표(scratchpad/winner_report_<월>.md)와 카드 PNG 를 사장님께 보낸다(SendUserFile)
//   ③ 사장님이 선물 보내고 "발송 완료" → 관리자 발송 체크(또는 --sent) → 카드 재생성(「모두 보내드렸어요」 줄) → "올려" 로 event/<월>.html 공개
//
// 실행:  node tools/daily/winner_report.mjs [YYYY-MM]        (달 생략 = 지난달)
//        node tools/daily/winner_report.mjs 2026-09 --approve (사장님이 「안내해」 하신 뒤에만 — 당첨자 본인 화면에 당첨 안내가 뜨고 연락처를 받기 시작)
//        node tools/daily/winner_report.mjs 2026-09 --sent   (그 달 전원 발송 완료로 표시 — 연락처는 이때 지워진다)
// 출력:  scratchpad/winner_report_<YYYY-MM>.md  (⚠ 전화번호가 들어 있다 — scratchpad 는 공개 레포에 안 올라간다. 보낸 뒤 지운다)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const kst = new Date(Date.now() + 9 * 3600e3);
const last = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || last;
const SENT = process.argv.includes('--sent');
const APPROVE = process.argv.includes('--approve');

const q = (sql) => {
  const f = path.join(REPO, 'scratchpad', '_winner_report.sql');
  fs.writeFileSync(f, sql, 'utf8');
  const o = execFileSync(CLI, ['db', 'query', '--linked', '--file', 'scratchpad/_winner_report.sql', '--output-format', 'json'],
    { cwd: REPO, encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = o.indexOf('['), b = o.indexOf('{');
  const j = JSON.parse(o.slice(Math.min(a < 0 ? 1e9 : a, b < 0 ? 1e9 : b)));
  return Array.isArray(j) ? j : (j.rows || []);
};
const M = `'${month}-01'`;

// ① 추첨이 안 됐으면 뽑는다 (지난달만 — attendance_auto_draw 는 지난달 고정)
let drew = 0;
if (!q(`select 1 from attendance_winners where month=${M} limit 1;`).length) {
  if (month !== last) { console.error(`${month} 은 추첨 기록이 없다 — 자동 추첨은 지난달(${last})만 한다. 관리자에서 뽑을 것`); process.exit(1); }
  const r = q(`select public.attendance_auto_draw() r;`);
  drew = Number((r[0]?.r || {}).drawn || 0);
}
// ② 승인(당첨 안내·연락처 받기 시작)은 사장님이 시킨 뒤(--approve)에만 — 규칙: 맘대로 안내 나가지 않는다
const appr = APPROVE ? q(`update attendance_winners set approved_at=now() where month=${M} and approved_at is null returning id;`).length : 0;
if (SENT) q(`update attendance_winners set sent_at=now(), contact=null, contact_at=null where month=${M} and sent_at is null returning id;`);

const W = q(`select w.tier, coalesce(w.nickname, mb.nickname, '(닉네임 없음)') nick, w.days, w.prize, w.contact, (w.approved_at is not null) appr,
  (select count(*) from attendance_winners x where x.kakao_id=w.kakao_id and x.month<w.month) prior,
  to_char(w.contact_at at time zone 'Asia/Seoul','MM-DD HH24:MI') cat, to_char(w.sent_at at time zone 'Asia/Seoul','MM-DD') sat
  from attendance_winners w left join members mb on mb.kakao_id=w.kakao_id where w.month=${M} order by w.tier desc, w.days desc, w.id;`);
const stat = q(`select count(*) n, count(*) filter (where days>=20) e from _att_days(${M}::date);`)[0] || {};
const got = W.filter((w) => w.contact).length, sent = W.filter((w) => w.sat).length;

const L = [];
L.push(`# ${month} 출석 경품 당첨자 (${kst.toISOString().slice(0, 16).replace('T', ' ')} 기준)`);
L.push('');
L.push(`출석 ${stat.n}명 · 20일 이상 ${stat.e}명 · 당첨 ${W.length}명${drew ? ` (방금 추첨 ${drew}명)` : ''}${appr ? ` · 방금 승인 ${appr}명` : ''}`);
L.push(`연락처 ${got}/${W.length}명 입력 · 발송 ${sent}/${W.length}명`);
L.push('');
const pend = W.filter((w) => !w.appr).length, rep2 = W.filter((w) => Number(w.prior) > 0).length;
L.push(`안내 ${W.length - pend}/${W.length}명 나감${pend ? ` · ⏳ ${pend}명은 승인 대기(사장님 「안내해」 전엔 본인 화면에 아무것도 안 뜸)` : ''} · 이전 당첨자 ${rep2}명 포함`);
L.push('');
L.push('| 경품 | 닉네임 | 출석 | 이전 당첨 | 안내 | 전화번호 | 발송 |');
L.push('|---|---|---|---|---|---|---|');
for (const w of W) L.push(`| ${w.prize} | ${w.nick} | ${w.days}일 | ${Number(w.prior) ? w.prior + '회' : '처음'} | ${w.appr ? '나감' : '⏳대기'} | ${w.contact ? `${w.contact} (${w.cat})` : '아직 안 남김'} | ${w.sat ? '✅ ' + w.sat : '—'} |`);
L.push('');
L.push(sent === W.length ? '➡ 전원 발송 완료 — 공개 발표 가능(`/당첨자` → "올려")'
  : got < W.length ? '➡ 연락처를 다 받으면 매시간 점검(attendance-contact-watch)이 알림을 남긴다. 받은 분부터 보내셔도 된다'
  : '➡ 전원 연락처 입력 완료 — 선물 보내신 뒤 "발송 완료" 라고 해 주세요');
const out = path.join(REPO, 'scratchpad', `winner_report_${month}.md`);
fs.writeFileSync(out, L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));
console.log('\n표: ' + path.relative(REPO, out));

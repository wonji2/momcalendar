// 오류제보 감시기 — 손님이 사이트에서 보낸 제보(inquiries)를 **아무도 안 보고 있던 구멍**을 막는다 (2026-09-22)
//
// 왜 필요한가
//   사장님 2026-09-22: "오류제보 들어오는거 니가 알아서 보고 고치고 있는거 맞아?" → 아니었다.
//   현아님 제보(09-15 07:39 "공구기간이 달라서 구매 못 했어요 솔솔홈 마마포레스트 공구 끝났어요")가 **7일째 status=new** 였다.
//   제보를 읽는 도구·예약작업·pg_cron 이 하나도 없었다(실측). 규칙 0 "오류는 제보받는 게 아니라 내가 먼저 찾아 고친다"를 어긴 상태.
//
// 하는 일 (매시간)
//   ① inquiries 에서 status='new' 를 읽는다 (supabase-cli, 관리자 권한)
//   ② 제보 문장에서 **우리 DB 셀러명·상품명**이 보이면 지금 사이트에 열려 있는 그 공구 행(id·기간)을 같이 붙인다
//      → 사장님이 "어느 행을 내려야 하나"를 바로 안다. (마마포레스트 사고가 정확히 이 모양이었다: 끝난 공구가 중복행 때문에 열려 보임)
//   ③ 오늘 카드 페이지 맨 위 알림(alert.mjs 키 'inquiry')에 한 줄 — 새 제보 N건 · 가장 오래된 것 며칠째
//   ④ 로그 scratchpad/inquiry_guard_log.txt · 상태 scratchpad/inquiry_guard_state.json(마지막으로 본 id — 새 제보가 늘었는지 안다)
//
//   node tools/daily/inquiry_guard.mjs          예약작업 momcal-inquiry-guard 가 매시간 부른다
//   node tools/daily/inquiry_guard.mjs --dry    알림·상태 안 쓰고 보기만
//
// ⚠ 고치는 건 사람이 한다 — 공구 행 삭제·날짜 수정은 승인 사안(메모리 db-approval-required). 여기선 **찾아서 보이게** 까지.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const DRY = process.argv.includes('--dry');
const LOGF = path.join(REPO, 'scratchpad', 'inquiry_guard_log.txt');
const STATE = path.join(REPO, 'scratchpad', 'inquiry_guard_state.json');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const today = kst().toISOString().slice(0, 10);
const log = (s) => { const t = kst().toISOString().slice(0, 16).replace('T', ' '); try { fs.appendFileSync(LOGF, `[${t}] ${s}\n`); } catch {} console.log(s); };

function query(sql, name) {
  const rel = `scratchpad/_inq_guard_${name}.sql`;
  fs.writeFileSync(path.join(REPO, rel), sql, 'utf8');
  const raw = execFileSync(CLI, sbArgs(rel), { encoding: 'utf8', cwd: REPO, timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] });
  const r = parseRows(raw);
  if (!r.ok) throw new Error(`${name}: 읽기 실패`);
  return r.rows;
}

let news = [];
try {
  news = query(`select id, kind, coalesce(nickname,'') as who, coalesce(status,'') as status,
      regexp_replace(coalesce(content,''), E'[\\\\n\\\\r]+', ' ', 'g') as content,
      to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as at,
      floor(extract(epoch from (now() - created_at))/86400)::int as days
    from public.inquiries where coalesce(status,'') in ('', 'new') order by created_at asc;`, 'new');
} catch (e) {
  // 읽기가 막히면 알림을 건드리지 않는다 — 조용히 실패해서 "제보 없음"으로 보이면 이 도구가 없던 때와 같다
  log(`🔴 제보를 못 읽었다: ${e.message}`);
  process.exit(0);
}

// ② 제보 문장 안의 셀러·상품이 지금 사이트에 열려 있는지 — 열려 있으면 그 행이 범인일 가능성이 크다
let open = [];
try {
  open = query(`select id, name, coalesce(influencer,'') as influencer, coalesce(insta,'') as insta, open_date, end_date
    from public.gonggu where approved = true and end_date >= '${today}' order by open_date;`, 'open');
} catch (e) { log(`⚠ 열린 공구를 못 읽었다(짝 맞추기 생략): ${e.message}`); }

const lines = [];
for (const q of news) {
  const text = String(q.content || '');
  const hits = open.filter((g) => {
    const keys = [g.influencer, g.insta, ...String(g.name || '').split(/\s+/).filter((w) => w.length >= 3)].filter(Boolean);
    return keys.some((k) => text.includes(k));
  }).slice(0, 4);
  const tail = hits.length ? ` → 지금 열린 행: ${hits.map((g) => `#${g.id} ${g.influencer || g.insta} ${g.name} ${g.open_date}~${g.end_date}`).join(' / ')}` : '';
  lines.push(`#${q.id} ${q.at} (${q.days}일째) ${q.who ? q.who + ': ' : ''}${text.slice(0, 80)}${tail}`);
}

const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { lastId: 0 }; } })();
const maxId = news.reduce((m, q) => Math.max(m, Number(q.id) || 0), 0);
const fresh = news.filter((q) => Number(q.id) > (prev.lastId || 0)).length;

if (!news.length) log('새 제보 없음');
else { log(`새 제보 ${news.length}건 (이번에 처음 본 것 ${fresh}건)`); for (const l of lines) log('  ' + l); }

if (DRY) process.exit(0);
if (news.length) {
  const oldest = news[0];
  setAlert('inquiry', `손님 오류제보 ${news.length}건이 답을 기다려요 — 가장 오래된 것 ${oldest.days}일째 (${oldest.who || '익명'}: ${String(oldest.content).slice(0, 40)}…) · 관리자 💌 제보/문의 탭`);
} else clearAlert('inquiry');
const pushed = pushAlerts(`오류제보 ${news.length}건`);
if (!pushed.ok) log(`⚠ 알림 푸시 실패: ${pushed.error}`);
fs.writeFileSync(STATE, JSON.stringify({ lastId: Math.max(prev.lastId || 0, maxId), checkedAt: kst().toISOString() }));

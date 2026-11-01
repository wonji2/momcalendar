/**
 * 🧱 Edge Function `inpock-lookup` 의 **파싱·판정 묶음**을 만든다 (2026-10-05)
 *
 * 왜: 관리자 화면(브라우저)은 인포크를 CORS 로 못 친다 → 서버 함수가 대신 친다.
 *     그런데 인포크 파싱(`scratchpad/inpock_harvest.mjs`)을 Deno 로 **다시 짜면 사본이 둘**이 되어
 *     한쪽만 고쳐진다 — 규칙 0-P 사고(calendar 블록·start_at 폴백)가 그렇게 났다.
 *     그래서 다시 짜지 않고 **원본에서 잘라 묶는다.** 손으로 고치는 파일이 아니다.
 *
 * 흐름:  inpock_harvest.mjs 의 순수 구간(상수~harvest) + verify_judge.mjs
 *        → supabase/functions/inpock-lookup/core.gen.mjs   (원본 해시를 머리말에 적는다)
 *
 * 실행:
 *   node tools/daily/build_inpock_lookup.mjs            묶음만 다시 만든다
 *   node tools/daily/build_inpock_lookup.mjs --check    원본이 바뀌었는데 묶음이 옛것인지 본다(바뀌었으면 exit 1)
 *   node tools/daily/build_inpock_lookup.mjs --deploy   묶음 → 서버에 올린다(supabase functions deploy)
 *
 * 🔑 **수확기(inpock_harvest.mjs)나 판정(verify_judge.mjs)을 고쳤으면 `--deploy` 를 한 번 돌린다.**
 *    안 돌리면 관리자 화면만 옛 기준으로 본다. `verify_rows.mjs` 가 돌 때마다 `--check` 와 같은 검사를 해서 알려 준다.
 *
 * 상태파일 없음. 주기 없음(수동). core.gen.mjs 는 .gitignore — 수확 로직은 공개 레포에 올리지 않는다
 * (scratchpad 가 통째로 비공개인 것과 같은 이유. 사본은 work-backup 에 남는다).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SRC_HARVEST = path.join(ROOT, 'scratchpad', 'inpock_harvest.mjs');
const SRC_JUDGE = path.join(ROOT, 'tools', 'daily', 'verify_judge.mjs');
const OUT = path.join(ROOT, 'supabase', 'functions', 'inpock-lookup', 'core.gen.mjs');
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';

// 잘라낼 구간의 앵커 — 못 찾으면 **만들지 않고 실패**한다(-1 은 "맨 앞"이 아니다)
const A_START = 'const UA = ';
const A_END = '// 인포크 페이지 원문에서 **인스타 핸들**을 읽는다';

export function buildCore() {
  const h = readFileSync(SRC_HARVEST, 'utf8').replace(/\r\n/g, '\n');
  const j = readFileSync(SRC_JUDGE, 'utf8').replace(/\r\n/g, '\n');
  const a = h.indexOf(A_START), b = h.indexOf(A_END);
  if (a < 0 || b < 0 || b <= a) throw new Error('수확기에서 구간 앵커를 못 찾았다 — 수확기 구조가 바뀌었다. 앵커를 다시 잡을 것');
  if (h.indexOf(A_START, a + 1) > -1 && h.indexOf(A_START, a + 1) < b) throw new Error('시작 앵커가 구간 안에 두 번 나온다');
  const slice = h.slice(a, b);
  // 구간 검사 — 있어야 할 것 / 있으면 안 되는 것
  for (const need of ['export async function harvest(', 'export function cleanName(', 'export function isProduct(', 'schedule_list', 'start_at', 'open_until']) {
    if (!slice.includes(need)) throw new Error('잘라낸 구간에 「' + need + '」 가 없다');
  }
  for (const bad of ['readFileSync', 'existsSync', 'appendFileSync', 'writeFileSync', 'process.', 'dirname(', "from 'node:"]) {
    if (slice.includes(bad)) throw new Error('잘라낸 구간이 node 전용 「' + bad + '」 를 쓴다 — Edge 에서 죽는다');
  }
  if (/from 'node:|process\./.test(j)) throw new Error('verify_judge.mjs 가 node 전용 모듈을 쓴다');
  const hash = createHash('sha256').update(slice).update('\u0000').update(j).digest('hex').slice(0, 16);
  const body = [
    '// ⚠⚠ 자동 생성 파일 — **손으로 고치지 말 것.** 고칠 곳은 원본 둘이다:',
    '//   scratchpad/inpock_harvest.mjs (인포크 파싱) · tools/daily/verify_judge.mjs (판정)',
    '// 다시 만들기: node tools/daily/build_inpock_lookup.mjs --deploy',
    `export const CORE_HASH = '${hash}';`,
    '',
    '// ───────── ① scratchpad/inpock_harvest.mjs 의 순수 구간 ─────────',
    slice.trimEnd(),
    '',
    '// ───────── ② tools/daily/verify_judge.mjs ─────────',
    j.trimEnd(),
    '',
  ].join('\n');
  return { hash, body };
}

/** 묶음이 원본과 같은 판인가 — { ok, why } */
export function checkCore() {
  if (!existsSync(OUT)) return { ok: false, why: 'core.gen.mjs 가 없다(아직 안 만들었다)' };
  let built;
  try { built = buildCore(); } catch (e) { return { ok: false, why: String(e.message) }; }
  const cur = readFileSync(OUT, 'utf8');
  const m = cur.match(/CORE_HASH = '([0-9a-f]+)'/);
  if (!m) return { ok: false, why: 'core.gen.mjs 에 해시가 없다' };
  return m[1] === built.hash
    ? { ok: true, why: '원본과 같은 판(' + built.hash + ')' }
    : { ok: false, why: '원본이 바뀌었다(묶음 ' + m[1] + ' ≠ 원본 ' + built.hash + ') — node tools/daily/build_inpock_lookup.mjs --deploy' };
}

// ── CLI ──
const invoked = process.argv[1] && process.argv[1].replace(/\\/g, '/');
if (invoked && import.meta.url.endsWith(invoked.split('/').pop())) {
  if (process.argv.includes('--check')) {
    const c = checkCore();
    console.log((c.ok ? '✅ ' : '🔴 ') + c.why);
    process.exit(c.ok ? 0 : 1);
  }
  const { hash, body } = buildCore();
  writeFileSync(OUT, body);
  console.log('✅ core.gen.mjs 생성 — 해시 ' + hash + ' · ' + body.length + '자');
  if (process.argv.includes('--deploy')) {
    // ⚠ --no-verify-jwt: 함수가 **직접** 관리자인지 확인한다(app_admins). 게이트웨이 검증은 새 공개키(sb_publishable)와 안 맞는다.
    const out = execFileSync(SB, ['functions', 'deploy', 'inpock-lookup', '--no-verify-jwt', '--project-ref', 'hycaqsqeogjtbscmzrtm'],
      { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(out.trim().split('\n').slice(-4).join('\n'));
    console.log('✅ 배포 끝 — 라이브 확인: 응답의 core 값이 ' + hash + ' 인지 본다');
  }
}

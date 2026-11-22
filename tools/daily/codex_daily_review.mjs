// 매일 코덱스 검사 — 전날 우리 채팅들이 고친 코드를 다른 회사 인공지능(코덱스)이 한 번 더 본다 (사장님 2026-10-26 「코덱스가 알아서 매일 검사중이야? 어디서 볼 수 있어」)
//
//   흐름: git fetch → 지난 N시간 origin/main 커밋 중 「우리 채팅이 만든 코드 커밋」만 고른다
//         (메시지에 Co-Authored-By: Claude · 바뀐 파일에 코드가 있음 · 이미 본 커밋은 건너뜀)
//       → 커밋마다 `codex review --commit <SHA>` (읽기 전용) → 원문 모음
//       → 코덱스에게 한 번 더 시켜 사장님용 한국어 표로 정리
//       → scratchpad/codex-review/<날짜>_매일검사.md (한국어) · <날짜>_매일검사_원문.txt
//       → 찾은 문제가 있으면 사장님 알림줄(daily/_alert.txt 키 codex_review), 없으면 지움
//   실행: node tools/daily/codex_daily_review.mjs [--hours=72] [--max=15] [--dry]
//   고르는 순서: 손님에게 바로 나가는 것 먼저(라이브 index·sw.js·서버 함수·SQL·앱) → 도구 → test 만 바꾼 것. 같은 급이면 최신 먼저.
//     하루 우리 커밋이 70개를 넘는다(2026-10-26 실측 77개) → 하루 상한 15개, 남은 건 다음 날, 72시간 지나면 버린다
//   예약: momcal-codex-review 매일 06:20 (윈도우 예약작업, tools/daily/tasks/momcal-codex-review.xml)
//   상태: scratchpad/codex_daily_review.json (본 커밋 목록·마지막 결과)
//   비용: 사장님 ChatGPT 구독의 코덱스 사용 한도만 쓴다(추가 요금 없음). 하루 최대 --max 커밋 + 정리 1번.
//   코덱스: npm @openai/codex(포터블 node) · 로그인은 ~/.codex/auth.json(코덱스 앱과 같다)
//   ⚠ 고치지는 않는다 — 읽기만. 고치는 건 다음 채팅이 결과 파일을 보고 한다(.claude/commands/검증.md).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE = process.execPath;
const CODEX_JS = path.join(path.dirname(NODE), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
const OUTDIR = path.join(REPO, 'scratchpad', 'codex-review');
const STATE = path.join(REPO, 'scratchpad', 'codex_daily_review.json');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const HOURS = +arg('hours', 72), MAX = +arg('max', 15), DRY = process.argv.includes('--dry');
const CODE_RE = /\.(html|js|mjs|cjs|ts|java|kt|swift|py|sql|ya?ml|ps1|sh|json)$/i;
const SKIP_RE = /^(daily\/|seo\/|sitemap|banners\/|.*\.png$|.*\.jpg$|tools\/seo\/(keywords|kw_volume)\.json$)/i;

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const today = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);   // 한국 날짜
let st = {}; try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
const seen = new Set(st.seen || []);

if (!fs.existsSync(CODEX_JS)) { setAlert('codex_review', '🔴 매일 코덱스 검사: 코덱스가 안 깔려 있다(npm i -g @openai/codex)'); pushAlerts?.('코덱스 검사'); process.exit(1); }
try { git('fetch', '-q', 'origin', 'main'); } catch (e) { console.log('fetch 실패', e.message); }

// 고를 커밋: 지난 HOURS 시간 · 우리 채팅이 만든 것 · 코드 파일이 바뀐 것
const log = git('log', 'origin/main', `--since=${HOURS} hours ago`, '--format=%H%x09%s%x09%b%x1e');
const picks = [];
for (const rec of log.split('\x1e')) {
  const [sha, subj, body] = rec.trim().split('\t');
  if (!sha || seen.has(sha) || !/Co-Authored-By: Claude/i.test(body || '')) continue;
  const files = git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean);
  const code = files.filter((f) => CODE_RE.test(f) && !SKIP_RE.test(f));
  if (!code.length) { seen.add(sha); continue; }
  const score = code.some((f) => /^(index\.html|sw\.js|supabase\/|android-app\/|ios-app\/|\.github\/|go\.html|out\.html|register\.html|admin\.html)/.test(f)) ? 2
    : code.some((f) => !/^test[-\w]*\.html$/.test(f)) ? 1 : 0;
  picks.push({ sha, subj, files: code, score });
}
picks.sort((a, b) => b.score - a.score);   // git log 가 최신순이라 같은 급 안에서는 최신 먼저(안정 정렬)
const todo = picks.slice(0, MAX);
console.log(`검사할 커밋 ${todo.length}개 (후보 ${picks.length}개, 지난 ${HOURS}시간)`);
if (DRY) { for (const p of todo) console.log(p.score, p.sha.slice(0, 10), p.subj.slice(0, 70), p.files.length + '개 파일'); process.exit(0); }

const codex = (args, input, ms) => {
  const r = spawnSync(NODE, [CODEX_JS, ...args], { cwd: REPO, input, encoding: 'utf8', timeout: ms, maxBuffer: 64 << 20, windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''), err: r.error?.message };
};
const RO = ['-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"'];

const raws = [];
for (const p of todo) {
  const t0 = Date.now();
  const r = codex(['review', ...RO, '--commit', p.sha], undefined, 12 * 60e3);
  // 결과는 맨 뒤 「codex」 줄 다음부터 (그 앞은 코덱스가 읽은 파일·명령 기록)
  const i = r.out.lastIndexOf('\ncodex\n');
  const result = (i >= 0 ? r.out.slice(i + 7) : r.out.slice(-6000)).trim();
  const n = (result.match(/^- \[P\d\]/gm) || []).length;
  const top = (result.match(/\[P(\d)\]/g) || []).map((x) => +x[2]).sort()[0];
  raws.push({ ...p, ok: r.ok, err: r.err, n, top, sec: Math.round((Date.now() - t0) / 1e3), result });
  if (r.ok) seen.add(p.sha);
  console.log(p.sha.slice(0, 10), r.ok ? `문제 ${n}개` : '실패 ' + (r.err || ''), `${raws.at(-1).sec}초`);
}

fs.mkdirSync(OUTDIR, { recursive: true });
const rawTxt = raws.map((x) => `### ${x.sha} ${x.subj}\n파일: ${x.files.join(', ')}\n${x.ok ? '' : '⚠ 검사 실패: ' + (x.err || '') + '\n'}${x.result}\n`).join('\n');
fs.writeFileSync(path.join(OUTDIR, `${today}_매일검사_원문.txt`), rawTxt);

// 사장님용 한국어 정리 — 코덱스에게 한 번 더(읽기만)
const found = raws.filter((x) => x.n > 0);
let md = `# 매일 코덱스 검사 — ${today}\n\n검사한 커밋 ${raws.length}개 · 문제가 나온 커밋 ${found.length}개 · 찾은 문제 ${found.reduce((a, x) => a + x.n, 0)}개\n\n`;
if (found.length) {
  const prompt = `아래는 코드 검사 결과(영어)다. 코딩을 모르는 사장님이 읽을 한국어 표로 바꿔라.
표 머리: | 커밋 | 무엇을 고친 커밋인가 | 찾은 문제 | 손님에게 무슨 일이 생기나 | 급한 정도 |
- 커밋은 앞 10글자. 「무엇을 고친 커밋인가」는 커밋 제목을 짧게.
- 급한 정도: P0·P1 = 🔴 급함, P2 = 🟠 보통, P3 = 🟡 낮음.
- 쉬운 말로, 영어 낱말·코드 이름은 꼭 필요할 때만. 표만 출력하고 다른 말은 쓰지 마라.

${found.map((x) => `### ${x.sha.slice(0, 10)} ${x.subj}\n${x.result}`).join('\n\n')}`;
  const r = codex(['exec', ...RO, '--skip-git-repo-check', '-'], prompt, 8 * 60e3);
  const j = r.out.lastIndexOf('\ncodex\n');
  let table = (j >= 0 ? r.out.slice(j + 7) : '').split('\ntokens used')[0].trim();
  if (!/^\|/m.test(table)) table = '(한국어 정리 실패 — 원문 파일을 본다)\n\n' + found.map((x) => `- ${x.sha.slice(0, 10)} ${x.subj}: 문제 ${x.n}개`).join('\n');
  md += table + '\n\n';
} else md += '찾은 문제가 없습니다.\n\n';
const failed = raws.filter((x) => !x.ok);
if (failed.length) md += `⚠ 검사를 못 한 커밋 ${failed.length}개: ${failed.map((x) => x.sha.slice(0, 10)).join(', ')} (다음 날 다시 본다)\n\n`;
if (picks.length > todo.length) md += `ℹ️ 하루 상한(${MAX}개)을 넘어 ${picks.length - todo.length}개는 다음 날로 넘겼다.\n\n`;
md += `영어 원문: \`${today}_매일검사_원문.txt\` · 고치는 법: 새 채팅에서 「코덱스 검사 결과 고쳐」\n`;
fs.writeFileSync(path.join(OUTDIR, `${today}_매일검사.md`), md);

const urgent = found.filter((x) => x.top != null && x.top <= 1).length;
if (found.length) setAlert('codex_review', `${urgent ? '🔴' : '🟠'} 코덱스 매일 검사: 문제 ${found.reduce((a, x) => a + x.n, 0)}개(급함 ${urgent}) → scratchpad/codex-review/${today}_매일검사.md`);
else clearAlert('codex_review');
try { pushAlerts('사장님 알림: 코덱스 매일 검사'); } catch (e) { console.log('알림 올리기 실패', e.message); }
fs.writeFileSync(STATE, JSON.stringify({ at: new Date().toISOString(), seen: [...seen].slice(-500), last: raws.map(({ result, ...x }) => x) }, null, 2));
console.log('끝 →', path.join(OUTDIR, `${today}_매일검사.md`));

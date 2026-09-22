// 스레드 학습이 **멈췄는지 감시하고, 멈췄으면 스스로 다시 돌린다** (2026-09-21 신설)
//
// 왜 필요한가
//   말투 학습은 예약작업 두 개에 걸려 있다 — momcal-threads-voice(06:20) · momcal-threads-style(06:40).
//   그런데 **예약작업은 stderr 를 버린다**(메모리 scheduled-task-swallows-stderr). 토큰이 만료되거나 브라우저가 막히면
//   학습이 조용히 멈추고, 발행기는 3일 지난 학습 파일을 알아서 버리고 옛 방식으로 돈다 —
//   즉 **아무 일도 안 일어난 것처럼 보이면서 말투가 굳는다.** 사장님이 "계속 디벨롭 되는 거 맞아?" 라고 물어도
//   확인할 방법이 없었다. 그래서 매일 낮에 한 번 직접 확인한다.
//
// 하는 일
//   ① state/threads-voice.json · threads-style.json 의 날짜가 오늘인지 본다
//   ② 어제 것이면 그 자리에서 **다시 돌린다**(대개 여기서 복구된다)
//   ③ 그래도 안 되면 daily/_alert.txt 에 한 줄 남긴다 → 사장님이 매일 보는 오늘 카드(daily/today.html) 맨 위에 빨간 줄로 뜬다
//
//   node tools/daily/threads_learn_guard.mjs          예약작업 momcal-threads-learn-guard 가 매일 13:10 부른다
//   node tools/daily/threads_learn_guard.mjs --dry    고치지 않고 상태만 본다
//
// 로그  scratchpad/threads_guard_log.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setAlert, clearAlert, pushAlerts } from './alert.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SNS = path.join(REPO, 'sns-automation');
const NODE = process.execPath;
const DRY = process.argv.includes('--dry');
const LOGF = path.join(REPO, 'scratchpad', 'threads_guard_log.txt');
const kst = () => new Date(Date.now() + 9 * 3600e3);
const today = kst().toISOString().slice(0, 10);
const log = (s) => { const t = kst().toISOString().slice(0, 16).replace('T', ' '); try { fs.appendFileSync(LOGF, `[${t}] ${s}\n`); } catch {} console.log(s); };

const WATCH = [
  { name: '말투 수집', file: 'state/threads-voice.json', script: 'src/threads-voice.js' },
  { name: '성적 학습', file: 'state/threads-style.json', script: 'src/threads-style.js' },
];

const dateOf = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(SNS, rel), 'utf8')).date || ''; } catch { return ''; } };

const broken = [];
for (const w of WATCH) {
  const before = dateOf(w.file);
  if (before === today) { log(`✅ ${w.name} 오늘(${today}) 것 있음`); continue; }
  log(`⚠ ${w.name} 가 ${before || '없음'} 에 멈춰 있다 — 다시 돌린다`);
  if (DRY) { broken.push(`${w.name}(${before || '없음'})`); continue; }
  try {
    execFileSync(NODE, [w.script], { cwd: SNS, timeout: 15 * 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { log(`   실행 실패: ${String(e.message).slice(0, 120)}`); }
  const after = dateOf(w.file);
  if (after === today) log(`   ✅ 복구됨`);
  else { log(`   🔴 복구 실패 (아직 ${after || '없음'})`); broken.push(`${w.name}(${after || '없음'})`); }
}

// 사장님 눈에 띄는 곳으로 — 오늘 카드 페이지 맨 위
if (!DRY) {
  if (broken.length) {
    // 🔴 파일을 통째로 덮지 않는다 — 알림을 내는 도구가 둘 이상이라 서로 지운다(2026-09-22). 내 키 줄만 건드린다.
    setAlert('threads', `스레드 말투 학습이 멈췄습니다 — ${broken.join(' · ')} (${today} 13시 확인)`);
    log(`🔴 알림 남김: ${broken.join(' · ')}`);
  } else {
    clearAlert('threads');
    log('오늘 학습 정상 — 알림 없음');
  }
  const pr = pushAlerts('스레드 학습 감시');
  if (!pr.ok) log('⚠ 알림 올리기 실패: ' + pr.error);
}

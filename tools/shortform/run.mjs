// 숏폼 자동화 한 번에: 다운로드 → 음성인식 → 한국어 자막·캡션 → 9:16 렌더
//
// 실행
//   node tools/shortform/run.mjs "<도우인/샤오홍슈 공유문구>" ["<또 하나>" …] [옵션]
//   node tools/shortform/run.mjs --file=scratchpad/shortform/queue.txt [옵션]
// 옵션
//   --no-ai        Claude 안 씀 (후킹은 --hook 으로, 자막 없음)
//   --no-whisper   음성인식 안 함 (자막 없이 후킹 제목만)
//   --whisper=small  음성인식 모델 크기 (tiny/base/small/medium)
//   --tone="…"     캡션·자막 말투
//   --force        이미 만든 것도 다시
//   + render.mjs 옵션 (--hook --mask --max --sec --bgm --font)
// 산출: scratchpad/shortform/<플랫폼>_<id>/final.mp4 + caption.txt
//       scratchpad/shortform/결과.md  (이번 실행 목록)
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, readQueue, OUT_ROOT } from './download.mjs';
import { render, parseRenderArgs } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const list = readQueue(args);
if (!list.length) {
  console.log('사용법: node tools/shortform/run.mjs "<공유문구/링크>" … | --file=목록.txt [--no-ai --no-whisper --mask=0.78,0.12]');
  process.exit(1);
}

function transcribe(dir, src) {
  const out = join(dir, 'segments.json');
  if (existsSync(out) && !has('--force')) return true;
  const py = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execFileSync(py, [join(HERE, 'transcribe.py'), src, out, val('whisper') || 'small'], { stdio: 'inherit' });
    return true;
  } catch {
    console.warn('  ⚠ 음성인식 건너뜀 (pip install faster-whisper 필요) — 자막 없이 진행');
    return false;
  }
}

const results = [];
for (const item of list) {
  const row = { input: String(item).slice(0, 80) };
  try {
    console.log(`\n▶ ${row.input}`);
    const { dir, meta } = await download(item, { force: has('--force') });
    row.dir = dir;
    row.title = (meta.title || meta.desc).slice(0, 40);

    if (meta.type === 'video' && !has('--no-whisper')) transcribe(dir, join(dir, meta.files[0]));

    if (!has('--no-ai') && (has('--force') || !existsSync(join(dir, 'ko.json')))) {
      const { makeScript } = await import('./script.mjs');
      const ko = await makeScript(dir, { tone: val('tone') || '' });
      console.log(`  후킹: ${ko.hook.replace(/\n/g, ' / ')}`);
    }

    const r = render(dir, parseRenderArgs(args));
    row.ok = true;
    row.file = r.file;
    row.sec = r.duration.toFixed(1);
    console.log(`  ✅ ${r.file}`);
  } catch (e) {
    row.ok = false;
    row.error = e.message;
    console.error(`  ❌ ${e.message}`);
  }
  results.push(row);
}

const md = ['# 숏폼 결과 ' + new Date().toLocaleString('ko-KR'), '', '| | 제목 | 길이 | 파일/오류 |', '|---|---|---|---|']
  .concat(results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.title || r.input} | ${r.sec || ''} | ${r.ok ? r.file : r.error} |`));
mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(join(OUT_ROOT, '결과.md'), md.join('\n') + '\n');
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 완료 → ${join(OUT_ROOT, '결과.md')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);

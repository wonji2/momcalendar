// 받은 영상/이미지 → 1080x1920 릴스·쇼츠용 mp4 (후킹 제목 + 한국어 자막 구워넣기)
//
// 실행: node tools/shortform/render.mjs <작업폴더> [옵션]
//   --hook="첫줄\n둘째줄"   후킹 제목 직접 지정 (없으면 ko.json 의 hook)
//   --mask=0.78,0.12        원본 화면의 세로 78% 지점부터 12% 높이를 흐리게 (중국어 자막 가리기)
//   --max=60                최대 길이(초)
//   --sec=2.5               이미지 슬라이드 한 장당 초
//   --bgm=음악.mp3          이미지 슬라이드 배경음 (없으면 무음)
//   --font="Malgun Gothic"  글꼴 (윈도우 기본 맑은 고딕, 그 외 Noto Sans CJK KR)
// 산출: <폴더>/final.mp4  (원본 메타데이터는 지운다)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1080, H = 1920;
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);

export function probeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim()) || 0;
}

function hasAudio(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]).toString();
  return out.trim().length > 0;
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
// ASS 에서 { } 는 서식 명령, 줄바꿈은 \N
const assText = (s) => String(s).replace(/[{}]/g, '').replace(/\r?\n|\\n/g, '\\N');

export function buildAss({ hook, lines, duration, font }) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,${font},84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,8,60,60,230,1
Style: Sub,${font},62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,1,2,70,70,360,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  if (hook) ev.push(`Dialogue: 1,${assTime(0)},${assTime(duration)},Hook,,0,0,0,,${assText(hook)}`);
  for (const l of lines) {
    if (!l.text || l.start >= duration) continue;
    ev.push(`Dialogue: 0,${assTime(l.start)},${assTime(Math.min(l.end, duration))},Sub,,0,0,0,,${assText(l.text)}`);
  }
  return head + ev.join('\n') + '\n';
}

// 한 장면(영상 또는 이미지)을 9:16 으로: 뒤는 같은 화면을 꽉 채워 흐리게, 앞은 가로 맞춤 원본
function fitChain(inLabel, outLabel, mask) {
  let fg = `[${inLabel}]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1,split[${outLabel}bgsrc][${outLabel}fg0];`
    + `[${outLabel}bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=40,eq=brightness=-0.08[${outLabel}bg];`;
  let fgLabel = `${outLabel}fg0`;
  if (mask) {
    const [y, h] = mask;
    fg += `[${fgLabel}]split[${outLabel}m0][${outLabel}m1];`
      + `[${outLabel}m1]crop=iw:ih*${h}:0:ih*${y},gblur=sigma=14[${outLabel}mb];`
      + `[${outLabel}m0][${outLabel}mb]overlay=0:main_h*${y}[${outLabel}fg1];`;
    fgLabel = `${outLabel}fg1`;
  }
  return fg + `[${outLabel}bg][${fgLabel}]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p[${outLabel}]`;
}

export function render(dir, opts = {}) {
  const meta = readJson(join(dir, 'meta.json'));
  if (!meta) throw new Error('meta.json 없음: ' + dir);
  const ko = readJson(join(dir, 'ko.json'));
  const segs = readJson(join(dir, 'segments.json'))?.segments || [];
  const font = opts.font || (process.platform === 'win32' ? 'Malgun Gothic' : 'Noto Sans CJK KR');
  const hook = opts.hook ?? ko?.hook ?? '';
  const max = Number(opts.max) || 0;

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  let filter, duration, audioMap;

  if (meta.type === 'video') {
    const src = join(dir, meta.files[0]);
    duration = probeDuration(src);
    if (max) duration = Math.min(duration, max);
    args.push('-i', meta.files[0]);
    filter = fitChain('0:v', 'v0', opts.mask);
    audioMap = hasAudio(src) ? '0:a:0' : null;
  } else {
    const sec = Number(opts.sec) || 2.5;
    const imgs = meta.files;
    duration = imgs.length * sec;
    if (max) duration = Math.min(duration, max);
    for (const f of imgs) args.push('-loop', '1', '-t', String(sec), '-i', f);
    filter = imgs.map((_, k) => fitChain(`${k}:v`, `c${k}`, null)).join(';')
      + ';' + imgs.map((_, k) => `[c${k}]`).join('') + `concat=n=${imgs.length}:v=1:a=0[v0]`;
    if (opts.bgm) { args.push('-stream_loop', '-1', '-i', opts.bgm); audioMap = `${imgs.length}:a:0`; }
    else { args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'); audioMap = `${imgs.length}:a:0`; }
  }

  // 자막: ko.json 의 i 로 원문 구간 시간에 맞춘다
  const lines = (ko?.subtitles || [])
    .map((s) => (segs[s.i] ? { start: segs[s.i].start, end: segs[s.i].end, text: s.ko } : null))
    .filter(Boolean);
  writeFileSync(join(dir, 'subs.ass'), buildAss({ hook, lines, duration, font }));
  // 윈도우 경로 이스케이프를 피하려고 작업폴더를 cwd 로 두고 상대경로만 쓴다
  filter += `;[v0]subtitles=subs.ass[vout]`;

  args.push('-filter_complex', filter, '-map', '[vout]');
  if (audioMap) args.push('-map', audioMap, '-c:a', 'aac', '-b:a', '160k', '-ar', '44100');
  args.push(
    '-t', duration.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30',
    '-map_metadata', '-1', '-movflags', '+faststart',
    'final.mp4',
  );
  execFileSync('ffmpeg', args, { cwd: dir, stdio: 'inherit' });
  return { file: join(dir, 'final.mp4'), duration, subtitles: lines.length };
}

export function parseRenderArgs(args) {
  const v = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const mask = v('mask')?.split(',').map(Number);
  return {
    hook: v('hook'),
    mask: mask?.length === 2 && mask.every((n) => n >= 0 && n <= 1) ? mask : null,
    max: v('max'),
    sec: v('sec'),
    bgm: v('bgm') && resolve(v('bgm')),
    font: v('font'),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) { console.log('사용법: node tools/shortform/render.mjs <작업폴더> [--hook=… --mask=0.78,0.12 --max=60]'); process.exit(1); }
  const r = render(dir, parseRenderArgs(rest));
  console.log(`✅ ${r.file} (${r.duration.toFixed(1)}초, 자막 ${r.subtitles}줄)`);
}

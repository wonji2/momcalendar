// 배너 파생본 만들기 (주문서 ORDER_ALERT_FIX_2026-11-25 §2 A — 첫 화면 이미지 경량화)
//
//   왜:   첫 화면 배너가 원본(500~1000px, 50~600KB)을 210×140·220×220 자리에 그대로 받았다. 11-23 웜스마일 배너(1000×1000, 584KB) 하나로 첫 화면이 +458KB.
//   무엇: banners/banner_*.{jpg,jpeg,png} 마다 banners/v/<이름>-420.webp(긴 변 420, 슬롯의 2배)·<이름>-640.webp(긴 변 640) 두 장, q=80.
//         원본은 지우지 않는다(SNS 카드·다른 화면이 원본을 쓴다). 원본보다 작을 때만 만든다(이미 작은 배너는 늘리지 않는다).
//         banners/v/index.json = 파생본이 있는 원본 이름 목록 — 화면(test.html _mcBanners)이 이것을 보고 주소를 바꾼다. 목록에 없으면 원본 그대로(안전한 쪽).
//   게이트: 파생본 하나라도 150KB 를 넘으면 이름·크기를 찍고 exit 1.
//   변환기: ImageMagick `magick`(깃허브 실행기 기본) → 없으면 리눅스에서만 `convert` → 없으면 파이썬 Pillow.
//           🔴 윈도우의 `convert` 는 디스크 변환 명령(C:\Windows\System32\convert.exe)이라 절대 부르지 않는다.
//   실행: node tools/img/make_banner_variants.mjs [--check]   (--check = 만들지 않고 빠진 것·150KB 초과만 본다)
//   어디서: 깃허브 Actions banner-variants.yml(banners/banner_* 이 올라오면 돈다 · PC 가 꺼져도 돈다). 의존성 0(node: 내장).
//   한도: 배너 54장 × 2 ≈ 3MB(저장소 1GB 의 0.3%) — LONG_TERM_REGISTER 「저장소 크기」에 포함.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'banners'), OUT = path.join(SRC, 'v');
const CHECK = process.argv.includes('--check');
const SIZES = [420, 640], Q = 80, CAP = 150 * 1024;
const has = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0; } catch { return false; } };
let tool = process.env.BANNER_TOOL || null;   // 깃허브 작업은 BANNER_TOOL=python3(Pillow) 로 못박는다 — 실행기 ImageMagick 6 은 WebP 지원이 판마다 다르다
if (tool && !has(tool, tool.startsWith('python') ? ['-c', 'import PIL'] : ['-version'])) tool = null;
if (tool) {} else if (has('magick', ['-version'])) tool = 'magick';
else if (process.platform !== 'win32' && has('convert', ['-version'])) tool = 'convert';
else { for (const py of ['python3', 'python']) { if (has(py, ['-c', 'import PIL; from PIL import features; assert features.check("webp")'])) { tool = py; break; } } }

function dims(file) {
  if (tool === 'magick' || tool === 'convert') { const o = execFileSync(tool === 'magick' ? 'magick' : 'identify', tool === 'magick' ? ['identify', '-format', '%w %h', file + '[0]'] : ['-format', '%w %h', file + '[0]']).toString().trim().split(' '); return { w: +o[0], h: +o[1] }; }
  const o = execFileSync(tool, ['-c', 'import sys; from PIL import Image; im=Image.open(sys.argv[1]); print(im.size[0], im.size[1])', file]).toString().trim().split(' ');
  return { w: +o[0], h: +o[1] };
}
function make(file, out, edge) {
  if (tool === 'magick' || tool === 'convert') { execFileSync(tool, [file + '[0]', '-auto-orient', '-resize', `${edge}x${edge}>`, '-strip', '-quality', String(Q), 'webp:' + out]); return; }
  execFileSync(tool, ['-c', `import sys
from PIL import Image, ImageOps
im=ImageOps.exif_transpose(Image.open(sys.argv[1]))
im=im.convert('RGBA') if im.mode in ('P','LA','RGBA') else im.convert('RGB')
im.thumbnail((int(sys.argv[3]),int(sys.argv[3])), Image.LANCZOS)
im.save(sys.argv[2],'WEBP',quality=${Q},method=6)`, file, out, String(edge)]);
}

const srcs = fs.readdirSync(SRC).filter((f) => /^banner_[^/]+\.(jpe?g|png)$/i.test(f)).sort();
if (!CHECK && !tool) { console.error('🔴 변환기 없음(magick·Pillow) — 파생본을 못 만든다'); process.exit(1); }
if (!CHECK) fs.mkdirSync(OUT, { recursive: true });
const made = [], over = [], have = [];
for (const f of srcs) {
  const base = f.replace(/\.[^.]+$/, ''), src = path.join(SRC, f), st = fs.statSync(src);
  let ok = true;
  for (const e of SIZES) {
    const out = path.join(OUT, `${base}-${e}.webp`);
    const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= st.mtimeMs - 1000;
    if (!fresh && !CHECK) { try { make(src, out, e); made.push(path.basename(out)); } catch (err) { console.error(`⚠ ${f} ${e}px 실패: ${String(err.message).slice(0, 120)}`); ok = false; continue; } }
    if (!fs.existsSync(out)) { ok = false; continue; }
    const sz = fs.statSync(out).size;
    if (sz > CAP) over.push(`${path.basename(out)} ${Math.round(sz / 1024)}KB`);
    if (sz >= st.size) ok = false;   // 원본보다 크면(이미 작은 배너) 쓰지 않는다 — 목록에서 뺀다
  }
  if (ok) have.push(f);
}
if (!CHECK) fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ v: 1, sizes: SIZES, files: have }) + '\n');
console.log(`배너 원본 ${srcs.length}장 · 파생본 있는 원본 ${have.length}장 · 이번에 만든 파일 ${made.length}개 · 변환기 ${tool || '없음'}`);
if (over.length) { console.error('🔴 150KB 넘는 파생본:\n  ' + over.join('\n  ')); process.exit(1); }

// 손님 사이트 묶음(Pages 아티팩트)에서 HTML·JS·CSS 주석만 떼어 낸다 — 저장소 원본은 그대로 둔다.
//   왜: 주석에 사장님 지시·내부 경로·운영 메모가 들어 있어 손님이 「소스 보기」로 다 읽을 수 있었다(사장님 2026-11-25 승인).
//   하는 일: 주석만 뗀다. 압축·난독화·순서 바꾸기 없음.
//   실행: node --expose-internals tools/site_strip_comments.mjs <사이트폴더> [--report=<json>]
//     (배포에선 고정 설치한 acorn@8.16.0(ACORN_DIR), PC 시험에선 Node 내장 acorn. 못 불러오면 exit 1 — 주석째 나가지 않게)
//   안전장치:
//     - JS(.js 파일·<script> 안)는 acorn 이 알려 준 주석 범위만 지우고, 지운 뒤 다시 읽어
//       「위치 정보를 뺀 구문 트리」가 원본과 한 글자도 다르지 않을 때만 쓴다. 다르거나 못 읽으면 그 조각은 원본 그대로.
//     - <script type="application/ld+json">·importmap·text/template 등 JS 가 아닌 것은 손대지 않는다.
//     - HTML 주석은 태그 밖 본문에서만. 조건부 주석(<!--[if …]>·<![endif]-->)은 남긴다.
//       태그 속성(onclick 등)·textarea·title·noscript 안은 건드리지 않는다.
//     - CSS 는 문자열·url() 을 건너뛰는 토크나이저로 /* */ 만. 지운 뒤 { } 수가 같을 때만 쓴다.
//     - /*! … */·@license·@preserve 주석(라이브러리 저작권 표시)은 남긴다.
//   끄기: deploy-pages.yml 의 jobs.deploy.env.STRIP_INTERNAL 을 '0' 으로(한 줄).
//   줄 수는 원본과 똑같다(주석 자리에 줄바꿈만 남김) — 손님 화면 오류 보고의 줄 번호가 저장소와 맞는다.
//   검색용 생성 페이지(g/ gg/ p/ s/ c/ m/ d/·맨 위 한글 이름 html)는 떼지 않는다(시간). 게이트가 검사만 한다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let acorn = null;
// 1순위: 공개 배포판 acorn(고정 버전) — 워크플로가 ACORN_DIR 에 acorn@8.16.0 을 설치해 넘긴다(Codex 권고 2026-11-25: 내부 경로는 공개 API 아님)
// 2순위(PC 시험용): Node 내장 acorn(--expose-internals)
let acornFrom = '';
try { if (process.env.ACORN_DIR) { acorn = createRequire(path.join(process.env.ACORN_DIR, 'x.js'))('acorn'); acornFrom = 'acorn@' + acorn.version + ' (ACORN_DIR)'; } } catch (e) { acorn = null; }
if (!acorn) { try { acorn = require('internal/deps/acorn/acorn/dist/acorn'); acornFrom = 'Node 내장 acorn ' + acorn.version; } catch (e) { acorn = null; } }

const ROOT = process.argv[2];
const REPORT = (process.argv.find((a) => a.startsWith('--report=')) || '').slice(9);
if (!ROOT || !fs.existsSync(ROOT)) { console.error('사이트 폴더를 주세요'); process.exit(2); }

const stats = { skippedGen: 0, files: 0, changed: 0, bytesBefore: 0, bytesAfter: 0, jsKept: [], cssKept: [], htmlKept: [], noAcorn: !acorn };
const perFile = {};

const keepLicense = (t) => /^!|@license|@preserve/.test(t);

// 주석 글자 속 줄바꿈만 그대로 남긴다(\r\n·\n·\r·U+2028·U+2029)
function keepNewlines(t) { return (t.match(/\r\n|[\n\r\u2028\u2029]/g) || []).join(''); }
const lineCount = (t) => (t.match(/\r\n|[\n\r\u2028\u2029]/g) || []).length;

// 구문 트리를 위치 정보 없이 글자로 — 지우기 전·후가 같아야 쓴다(줄바꿈이 바꾸는 자동 세미콜론까지 트리에 드러난다)
function astOf(src, sourceType) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: sourceType === 'module' });
  return JSON.stringify(ast, (k, v) => (k === 'start' || k === 'end' || k === 'loc' || k === 'range') ? undefined : (typeof v === 'bigint' ? 'n:' + v : (v instanceof RegExp ? 're:' + v : v)));
}

// JS 한 조각: 주석 범위 지우기 → 구문 트리 비교. 실패하면 null(원본 유지)
function stripJs(src, preferModule) {
  if (!acorn) return null;
  const order = preferModule ? ['module', 'script'] : ['script', 'module'];
  for (const sourceType of order) {
    const cs = [];
    try {
      acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: sourceType === 'module', onComment: (block, text, start, end) => cs.push({ block, text, start, end }) });
    } catch (e) { continue; }
    if (!cs.length) return src;
    let out = '';
    let last = 0;
    for (const c of cs) {
      if (keepLicense(c.text)) continue;
      out += src.slice(last, c.start);
      last = c.end;
      // 주석 자리에는 그 안의 줄바꿈만 남긴다 → 줄 수가 원본과 같다(오류 보고 줄 번호가 저장소와 맞는다).
      // 줄바꿈이 없는 블록 주석은 토큰이 붙지 않게 공백 하나. 줄 끝 주석 앞 공백만 지운다.
      const nls = keepNewlines(c.text);
      if (nls) out += nls;
      else if (c.block) out += ' ';
      else out = out.replace(/[ \t]+$/, '');
    }
    out += src.slice(last);
    try {
      if (astOf(src, sourceType) !== astOf(out, sourceType)) return null;
    } catch (e) { return null; }
    return out;
  }
  return null;
}

// 주석을 지워 공백만 남은 줄은 줄째 지운다(앞 줄의 줄바꿈은 남으므로 JS 자동 세미콜론에 영향 없음)
// 줄 끝 공백도 지운다 — 단 템플릿 문자열 안 줄은 토큰 비교가 막아 준다(바뀌면 원본 유지)
function tidyLines(s) {
  return s.replace(/[ \t]+$/gm, '').replace(/\n(?:[ \t]*\n)+/g, '\n');
}

function stripCss(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; else if (src[j] === '\n') break; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return null; // 닫히지 않은 주석 — 손대지 않는다
      const text = src.slice(i + 2, e);
      if (keepLicense(text)) { out += src.slice(i, e + 2); }
      else {
        const nls = keepNewlines(text);
        const prev = out[out.length - 1] || '';
        const next = src[e + 2] || '';
        if (nls) out += nls;
        else if (prev && next && !/\s/.test(prev) && !/\s/.test(next)) out += '/**/';
      }
      i = e + 2; continue;
    }
    if ((ch === 'u' || ch === 'U') && /^url\(/i.test(src.slice(i, i + 4))) {
      // 따옴표 없는 url(...) 안의 // 는 주석이 아니다
      let j = i + 4;
      while (j < n && /\s/.test(src[j])) j++;
      if (src[j] !== '"' && src[j] !== "'") {
        const e = src.indexOf(')', j);
        if (e < 0) return null;
        out += src.slice(i, e + 1); i = e + 1; continue;
      }
    }
    out += ch; i++;
  }
  const cnt = (s, c) => s.split(c).length - 1;
  // 주석을 빼고 원본의 괄호 수와 같은지
  const noCm = src.replace(/\/\*[\s\S]*?\*\//g, '');
  if (cnt(out, '{') !== cnt(noCm, '{') || cnt(out, '}') !== cnt(noCm, '}')) return null;
  return out;
}

const RAW_TEXT = new Set(['textarea', 'title', 'xmp', 'noscript', 'plaintext', 'iframe', 'noembed', 'noframes']);
const JS_TYPES = /^(|text\/javascript|application\/javascript|module|text\/ecmascript|application\/ecmascript|text\/jsx)$/i;

// 여는 태그 끝(>) 찾기 — 따옴표 안의 > 는 건너뛴다
function tagEnd(s, i) {
  let q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '>') return j;
  }
  return -1;
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

function stripHtmlCore(src, file, tags) {
  let out = '';
  let i = 0;
  const n = src.length;
  let kept = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    if (src.startsWith('<!-->', lt) || src.startsWith('<!--->', lt)) { i = lt + (src.startsWith('<!-->', lt) ? 5 : 6); continue; }
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      if (e < 0) { out += src.slice(lt); break; }
      const body = src.slice(lt + 4, e);
      if (/^\s*\[if|<!\[endif\]|^\s*\[endif|^\s*google_ad_section/i.test(body)) { out += src.slice(lt, e + 3); i = e + 3; continue; }
      i = e + 3;
      out += keepNewlines(body);
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const e = src.indexOf('>', lt);
      if (e < 0) { out += src.slice(lt); break; }
      out += src.slice(lt, e + 1); i = e + 1; continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(lt, lt + 40));
    if (!m) { out += '<'; i = lt + 1; continue; }
    const name = m[1].toLowerCase();
    tags.push(name);
    const te = tagEnd(src, lt + 1);
    if (te < 0) { out += src.slice(lt); break; }
    const tag = src.slice(lt, te + 1);
    out += tag;
    i = te + 1;
    if (name === 'script' || name === 'style' || RAW_TEXT.has(name)) {
      const closeRe = new RegExp('</' + name + '\\s*>', 'ig');
      closeRe.lastIndex = i;
      const cm = closeRe.exec(src);
      if (!cm) { out += src.slice(i); i = n; break; }
      const inner = src.slice(i, cm.index);
      let rep = inner;
      if (name === 'script') {
        const type = (attr(tag, 'type') || '').toLowerCase().split(';')[0].trim();   // text/javascript; charset=utf-8 도 JS
        if (JS_TYPES.test(type) && inner.trim()) {
          const r = stripJs(inner, type === 'module');
          if (r === null) { kept++; stats.jsKept.push(file); } else rep = r;
        }
      } else if (name === 'style') {
        const r = stripCss(inner);
        if (r === null) { kept++; stats.cssKept.push(file); } else rep = r;
      }
      out += rep;
      out += cm[0];
      i = cm.index + cm[0].length;
    }
  }
  return out;
}

// 뼈대 확인: 뗀 결과를 다시 훑었을 때 태그 순서가 원본과 같고, 한 번 더 떼도 그대로여야 쓴다
function stripHtml(src, file) {
  const t1 = [];
  const out = stripHtmlCore(src, file, t1);
  if (out === src) return src;
  const t2 = [];
  const again = stripHtmlCore(out, '(재확인)', t2);
  const docOk = /^\s*<!doctype/i.test(src) === /^\s*<!doctype/i.test(out);
  if (again !== out || t1.join(',') !== t2.join(',') || !docOk) { stats.htmlKept.push(file); return src; }
  return out;
}

const GEN_DIR = /^(g|gg|p|s|c|m|d)$/;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const top = dir === ROOT;
    if (top && e.isDirectory() && GEN_DIR.test(e.name)) { stats.skippedGen++; continue; }
    if (top && e.isFile() && /[^\x00-\x7F]/.test(e.name)) { stats.skippedGen++; continue; }
    if (e.isDirectory()) walk(p);
    else if (/\.(html?|js|css)$/i.test(e.name)) handle(p);
  }
}

function handle(p) {
  const rel = path.relative(ROOT, p).split(path.sep).join('/');
  let src;
  try { src = fs.readFileSync(p, 'utf8'); } catch (e) { return; }
  if (src.includes('\uFFFD')) return; // utf-8 이 아닌 파일은 손대지 않는다
  stats.files++;
  stats.bytesBefore += Buffer.byteLength(src);
  let out = src;
  if (/\.html?$/i.test(p)) out = stripHtml(src, rel);
  else if (/\.js$/i.test(p)) { const r = stripJs(src, /^\s*(import|export)\s/m.test(src)); if (r === null) stats.jsKept.push(rel); else out = r; }
  else if (/\.css$/i.test(p)) { const r = stripCss(src); if (r === null) stats.cssKept.push(rel); else out = r; }
  if (out !== src && lineCount(out) !== lineCount(src)) { stats.htmlKept.push(rel + '(줄 수 다름)'); out = src; }
  stats.bytesAfter += Buffer.byteLength(out);
  if (out !== src) {
    stats.changed++;
    fs.writeFileSync(p, out);
    perFile[rel] = [Buffer.byteLength(src), Buffer.byteLength(out)];
  }
}

const t0 = Date.now();
walk(ROOT);
const uniq = (a) => [...new Set(a)];
stats.jsKept = uniq(stats.jsKept); stats.cssKept = uniq(stats.cssKept); stats.htmlKept = uniq(stats.htmlKept);
console.log(`주석 떼기: 파일 ${stats.files}개 중 ${stats.changed}개 바뀜 · ${(stats.bytesBefore / 1e6).toFixed(1)}MB → ${(stats.bytesAfter / 1e6).toFixed(1)}MB · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
if (stats.noAcorn) { console.log('::error::JS 파서(acorn)를 못 불러왔다 — 주석이 남은 채 나가지 않게 멈춘다(ACORN_DIR 또는 --expose-internals 확인)'); process.exitCode = 1; }
else console.log('파서: ' + acornFrom);
for (const [k, label] of [['jsKept', 'JS'], ['cssKept', 'CSS'], ['htmlKept', 'HTML']]) {
  if (stats[k].length) console.log(`::warning::${label} 주석을 안전하게 못 떼어 원본 그대로 둔 파일 ${stats[k].length}개: ${stats[k].slice(0, 15).join(', ')}`);
}
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ ...stats, perFile }, null, 1));

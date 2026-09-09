// 상품명·날짜 규칙을 고칠 때마다 돌린다 — **정상 상품명이 몇 개 죽는지** 센다.
//
// 🔴 왜 있나 (2026-09-09, 하루에 두 번 같은 사고)
//   ① 문장 조각을 막으려고 넣은 규칙이 **기존 등록명 8,680개 중 143개를 같이 죽이고 있었다.**
//      뽀로로·일프로·캠브로(로 로 끝나는 브랜드) · "…스테인리스 컵"(한 글자로 끝남) · "1+1" · "첨가물 없는 맛간장".
//      나는 새 캡션 결과만 훑고 "통과"라고 보고했고 검증자가 잡았다.
//   ② 그 뒤 만든 회귀 도구가 **goodName 만** 재고 있어, 실제로 바뀐 normalizeName·productFrom 의
//      회귀("쿠진아트 에어프라이어 전"이 살아 돌아옴)를 구조적으로 못 봤다. 또 검증자가 잡았다.
//   → 이 도구는 **productFrom 을 뺀 전 구간(normalizeName + goodName)** 을 실제 사전으로 잰다.
//
// 실행
//   node tools/daily/name_rule_regress.mjs [비교할_옛커밋]
//     비교할_옛커밋 을 안 주면 HEAD~1 과 견준다.
//   ⚠ 상품명 목록이 없으면 자동으로 DB 에서 뽑는다(캐시 scratchpad/_names_all.txt, --refresh 로 새로).
//
// 통과 기준
//   🔴 죽은 정상 이름 **0개**. 0이 아니면 규칙이 과한 것이다 —
//      막으려는 쓰레기 몇 건과 죽는 정상 몇 건을 **숫자로 견줘** 결정한다.
//
// ⚠ git show 는 반드시 execFileSync(배열 인자)로 부른다. 셸을 거치면 `^`(부모 커밋)가 먹혀
//   HEAD 와 같은 파일이 나오고 "희생 0"이라는 거짓 통과가 뜬다(2026-09-09 검증자도 여기 걸렸다).
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SB = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const CUR = path.join(ROOT, 'tools', 'daily', 'ig_feed_to_table.mjs');
const NAMES_F = path.join(ROOT, 'scratchpad', '_names_all.txt');
const OLD_REF = process.argv.find(a => a !== '--refresh' && !a.endsWith('.mjs') && !a.endsWith('node.exe')) || 'HEAD~1';
const NL = String.fromCharCode(10);

// ── 1. 기존 등록 상품명 (캐시) ──
if (process.argv.includes('--refresh') || !existsSync(NAMES_F)) {
  const q = path.join(ROOT, 'scratchpad', '_names_all.sql');
  writeFileSync(q, "select distinct name from gonggu where coalesce(name,'') <> '';");
  const out = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json', '-f', q], { encoding: 'utf8', timeout: 300000, cwd: ROOT });
  const i = [out.indexOf('['), out.indexOf('{')].filter(x => x >= 0);
  const j = JSON.parse(out.slice(Math.min.apply(null, i)));
  const names = (j.rows || j).map(r => r.name).filter(Boolean);
  writeFileSync(NAMES_F, names.join(NL));
  console.log('DB 에서 상품명 ' + names.length + '개를 새로 뽑았다');
}
const names = readFileSync(NAMES_F, 'utf8').split(NL).filter(Boolean);

// ── 2. 옛 판을 git 에서 꺼낸다 (셸을 거치지 않는다) ──
const tmp = mkdtempSync(path.join(tmpdir(), 'namereg-'));
const oldSrc = execFileSync('git', ['show', OLD_REF + ':tools/daily/ig_feed_to_table.mjs'], { encoding: 'utf8', cwd: ROOT, maxBuffer: 8 << 20 });
const oldF = path.join(tmp, 'old.mjs');
writeFileSync(oldF, oldSrc);
const curSrc = readFileSync(CUR, 'utf8');
if (oldSrc === curSrc) { console.log('🔴 옛 판과 지금 판이 같은 파일이다 — 비교할 게 없다 (커밋 ref 를 확인할 것: ' + OLD_REF + ')'); process.exit(1); }

// ── 3. 두 판에서 이름 판정부만 떼어내 부를 수 있게 만든다 ──
//   PROMO 선언부터 goodName 끝까지가 한 덩어리다. DB·파일을 읽는 윗부분은 여기서 직접 넣어 준다.
function buildProbe(src, outPath) {
  const L = src.split(/\r?\n/);
  const a = L.findIndex(l => l.startsWith('const PROMO ='));
  let b = L.findIndex(l => l.startsWith('const goodName ='));
  if (a < 0 || b < 0) throw new Error('PROMO~goodName 구간을 못 찾았다');
  while (b < L.length && L[b].trim() !== '};') b++;
  const body = L.slice(a, b + 1).join(NL);
  writeFileSync(outPath, [
    "import { readFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { cleanName } from '" + pathToFileURL(path.join(ROOT, 'scratchpad', 'profiles', 'decode_names.mjs')).href + "';",
    "const ROOT = '" + ROOT.replace(/\\/g, '/') + "';",
    "const today = '" + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) + "';",
    'const ymd = (d) => d.toISOString().slice(0, 10);',
    "const valid = (s) => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && ymd(d) === s; };",
    "const addDays = (s, n) => { if (!valid(s)) return ''; const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };",
    body,
    'export { normalizeName, goodName, productFrom, dateFrom };'
  ].join(NL));
}
const oldP = path.join(tmp, 'probe_old.mjs'), newP = path.join(tmp, 'probe_new.mjs');
buildProbe(oldSrc, oldP); buildProbe(curSrc, newP);
const O = await import(pathToFileURL(oldP).href);
const N = await import(pathToFileURL(newP).href);

// ── 4. 잰다: 이름이 normalizeName → goodName 을 통과하는가 ──
const pass = (M, n) => { try { const t = M.normalizeName(n); return !!(t && M.goodName(t)); } catch { return false; } };
const oldOK = names.filter(n => pass(O, n));
const newOK = names.filter(n => pass(N, n));
const victims = names.filter(n => pass(O, n) && !pass(N, n));
const gained = names.filter(n => !pass(O, n) && pass(N, n));
// 이름이 **바뀌는** 것도 회귀다 ("라포레 플레이팅 팬" → "라포레 플레이팅")
const changed = names.filter(n => { try { const a = O.normalizeName(n), b = N.normalizeName(n); return a && b && a !== b; } catch { return false; } });

console.log('');
console.log('비교: ' + OLD_REF + ' → 지금 (상품명 ' + names.length + '개)');
console.log('  통과 ' + oldOK.length + ' → ' + newOK.length);
console.log((victims.length ? '  🔴 ' : '  ✅ ') + '새 규칙 때문에 죽은 정상 이름: ' + victims.length + '개');
console.log('  🟢 새로 통과하게 된 것: ' + gained.length + '개');
console.log((changed.length ? '  ⚠ ' : '  ✅ ') + '이름이 달라진 것: ' + changed.length + '개');
if (victims.length) { console.log(NL + '── 죽은 것 (최대 40) ──'); victims.slice(0, 40).forEach(v => console.log('  ' + v)); }
if (changed.length) { console.log(NL + '── 달라진 것 (최대 20) ──'); changed.slice(0, 20).forEach(v => console.log('  ' + v + '   →   ' + N.normalizeName(v))); }
writeFileSync(path.join(ROOT, 'scratchpad', '_regress_victims.txt'), victims.join(NL));
process.exit(victims.length ? 1 : 0);

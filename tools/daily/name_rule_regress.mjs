// 상품명 규칙을 고칠 때마다 돌린다 — **정상 상품명이 몇 개 죽는지** 센다.
//   (2026-09-09 사고: 문장 조각을 막으려고 넣은 규칙이 기존 등록명 286개를 같이 죽였다. 검증자가 잡았다)
//
// 준비:  supabase CLI 로 기존 상품명을 뽑아 둔다
//   "C:/Users/FAMILY/supabase-cli/supabase.exe" db query --linked --output-format json \
//     "select distinct name from gonggu where coalesce(name,'') <> '';" > scratchpad/_names_all.json
//   → 거기서 name 만 뽑아 scratchpad/_names_all.txt (한 줄에 하나)
// 실행:  node tools/daily/name_rule_regress.mjs
//   비교 대상(옛 판)은 scratchpad/_old_conv.mjs 에 둔다: git show <커밋>:tools/daily/ig_feed_to_table.mjs > scratchpad/_old_conv.mjs
// 통과 기준: 🔴 죽은 정상 이름 0개
// 오늘 규칙 변경의 **차이**만 잰다: 옛 판(f211538271^)에서는 통과했는데 지금 판에서 죽는 이름 = 희생자
import { readFileSync, writeFileSync } from 'node:fs';
const names = readFileSync('scratchpad/_names_all.txt', 'utf8').split('\n').filter(Boolean);
const BRANDS = readFileSync('scratchpad/brand_vocab.txt', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s.length >= 2);
const NL = String.fromCharCode(10);

function buildProbe(srcPath, outPath) {
  const lines = readFileSync(srcPath, 'utf8').split(/\r?\n/);
  const grab = (pred) => {
    const a = lines.findIndex(pred); if (a < 0) throw new Error(srcPath + ': 못 찾음');
    let b = a; while (b < lines.length && lines[b].trim() !== '};') b++;
    return lines.slice(a, b + 1).join(NL);
  };
  let decl = lines.filter(l => /^const (SENTENCE|SENTENCE2|ENDING|BRAND_STOP|TEASER)\b/.test(l)).join(NL);
  if (!decl.includes('const TEASER')) decl += NL + 'const TEASER = /(?!)/;';
  const good = grab(l => l.startsWith('const goodName ='));
  writeFileSync(outPath, [
    decl,
    'const BRANDS = new Set(process.env.__B.split(String.fromCharCode(10)));',
    'const vocab = new Set();',
    'for (const b of [...BRANDS]) if (BRAND_STOP.test(b) || !/^[가-힣A-Za-z][가-힣A-Za-z0-9]*$/.test(b)) BRANDS.delete(b);',
    'const isBrand = (t) => BRANDS.has(t) || (t.length >= 3 && [...BRANDS].some(b => b.length >= 3 && t.startsWith(b)));',
    good,
    'export { goodName };'
  ].join(NL));
}
process.env.__B = BRANDS.join(NL);
buildProbe('scratchpad/_old_conv.mjs', 'scratchpad/_probe_old.mjs');
buildProbe('tools/daily/ig_feed_to_table.mjs', 'scratchpad/_probe_new.mjs');
const oldM = await import('./_probe_old.mjs?' + Date.now());
const newM = await import('./_probe_new.mjs?' + Date.now());
const victims = names.filter(n => oldM.goodName(n) && !newM.goodName(n));
const gained = names.filter(n => !oldM.goodName(n) && newM.goodName(n));
console.log('옛 판 통과 ' + names.filter(n => oldM.goodName(n)).length + '개 · 새 판 통과 ' + names.filter(n => newM.goodName(n)).length + '개');
console.log('🔴 새 규칙 때문에 죽은 정상 이름: ' + victims.length + '개');
console.log('🟢 새로 통과하게 된 것: ' + gained.length + '개');
if (victims.length) console.log(NL + victims.slice(0, 40).join(NL));
writeFileSync('scratchpad/_victims.txt', victims.join(NL));

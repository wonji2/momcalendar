// 손님 사이트 묶음에 내부 메모가 남았는지 보는 게이트 — 주석 떼기(site_strip_comments.mjs) 다음에 돈다.
//   왜: 사장님 지시 인용·내부 경로·경쟁사 이름이 손님이 받는 파일에 실려 나갔다(2026-11-25 실측 index.html 「사장님」 225회, 인용 111회).
//   실행: node tools/site_internal_gate.mjs <사이트폴더> [--json=<결과>] [--warn-only]
//   막는 꼴(내부 메모만):
//     「사장님 2026-…」「사장님 지시」「사장님 확인 부탁」「사장님께 보고」 · scratchpad/ · HANDOFF · CLAUDE.md · 경쟁 집계 사이트 이름
//     「사장님」 낱말 자체는 셀러 글에 흔해서(「세탁소 사장님」 「참치사장님」) 세기만 한다(검증자 지적 2026-11-25).
//   판정:
//     - 손님 화면 파일(맨 위 영문 이름 html·js, event/ intro/ deal/ sale/ prize/ banners/)에 걸리면 실패(exit 1) → 배포 멈춤.
//     - DB·자동화가 매일 다시 만드는 파일(daily/ data/ 와 xml·txt·json)과 검색 생성 페이지(g/ gg/ p/ s/ c/ m/ d/·맨 위 한글 이름 html)는
//       알리기만 한다 — 그날 실린 셀러 글 때문에 배포 전체가 멈추지 않게.
//     - 문자열·alt·title·data- 속성까지 파일 전체 글자를 본다.
//     - 화면에 꼭 보여야 하는 글이면 tools/site_internal_gate_allow.json 에 「파일·낱말·앞뒤 글자·이유」로 올린다.
//   끄기: deploy-pages.yml 의 jobs.deploy.env.STRIP_INTERNAL 을 '0' 으로(한 줄).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2];
const JSON_OUT = (process.argv.find((a) => a.startsWith('--json=')) || '').slice(7);
const WARN_ONLY = process.argv.includes('--warn-only');
if (!ROOT || !fs.existsSync(ROOT)) { console.error('사이트 폴더를 주세요'); process.exit(2); }

const H = '[가-힣]';
const notAfterHangul = (w) => new RegExp('(?<!' + H + ')' + w, 'g');
const WORDS = [
  { key: '사장님 지시·인용', re: /사장님\s*(?:20\d\d-|지시|확인 ?부탁|께 ?보고|께 ?여쭤)/g },
  { key: 'scratchpad/', re: /scratchpad\//g },
  { key: 'HANDOFF', re: /HANDOFF/g },
  { key: 'CLAUDE.md', re: /CLAUDE\.md/g },
  // 경쟁 집계 사이트 — 앞에 한글이 붙은 꼴(#벨베이비공구)은 다른 낱말이라 뺀다. 「인공」「지공」은 일반 낱말과 겹쳐 목록에서 뺐다
  { key: '공구팡팡', re: notAfterHangul('공구팡팡') },
  { key: '공구모아', re: notAfterHangul('공구모아') },
  { key: '공구줍줍', re: /(?<![가-힣])공구줍줍|gonggu_jupjup/g },
  { key: '위시버니', re: notAfterHangul('위시버니') },
  { key: '베이비공구', re: /(?<![가-힣])베이비공구(?![가-힣])/g },
  { key: '공구쏙쏙', re: notAfterHangul('공구쏙쏙') },
  { key: '공구톡톡', re: notAfterHangul('공구톡톡') },
  { key: '09NOW', re: /\b09NOW\b/gi },
  { key: '공구베이비', re: notAfterHangul('공구베이비') },
  { key: '폴센트', re: notAfterHangul('폴센트') },
];
const PLAIN_RE = /사장님/g; // 세기만(보고용)

const here = path.dirname(fileURLToPath(import.meta.url));
let ALLOW = [];
try { ALLOW = JSON.parse(fs.readFileSync(path.join(here, 'site_internal_gate_allow.json'), 'utf8')).allow || []; } catch (e) { ALLOW = []; }

const GEN_DIR = /^(g|gg|p|s|c|m|d|daily|data)\//;
const isGenerated = (rel) => GEN_DIR.test(rel) || /\.(xml|txt|json)$/i.test(rel) || (!rel.includes('/') && /[^\x00-\x7F]/.test(rel));

function allowed(rel, key, ctx) {
  return ALLOW.some((a) => (a.file === rel || (a.file.endsWith('*') && rel.startsWith(a.file.slice(0, -1)))) && a.word === key && (!a.context || ctx.includes(a.context)));
}

const res = { core: {}, generated: {}, plain: {}, coreFail: 0, genHits: 0, files: 0 };
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(html?|js|css|json|xml|txt|webmanifest|svg)$/i.test(e.name)) continue;
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    let s;
    try { s = fs.readFileSync(p, 'utf8'); } catch (er) { continue; }
    res.files++;
    const plain = (s.match(PLAIN_RE) || []).length;
    if (plain) res.plain[rel] = plain;
    const hits = {};
    const samples = [];
    for (const w of WORDS) {
      w.re.lastIndex = 0;
      let m;
      while ((m = w.re.exec(s))) {
        const ctx = s.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ');
        if (allowed(rel, w.key, ctx)) continue;
        hits[w.key] = (hits[w.key] || 0) + 1;
        if (samples.length < 6) samples.push(`${w.key} … ${ctx}`);
      }
    }
    if (!Object.keys(hits).length) continue;
    const gen = isGenerated(rel);
    (gen ? res.generated : res.core)[rel] = { hits, samples };
    if (gen) res.genHits++; else res.coreFail++;
  }
}
walk(ROOT);

console.log(`내부 낱말 게이트: 파일 ${res.files}개 검사 · 손님 화면 파일 걸림 ${res.coreFail}개 · 자동 생성 파일 걸림 ${res.genHits}개`);
for (const [rel, v] of Object.entries(res.core)) {
  console.log(`${WARN_ONLY ? '::warning::' : '::error::'}${rel} ${JSON.stringify(v.hits)}`);
  for (const x of v.samples) console.log('    ' + x);
}
const genList = Object.entries(res.generated);
if (genList.length) {
  console.log(`::warning::자동 생성 파일 ${genList.length}개에 내부 낱말(배포는 계속) — 앞 10개:`);
  for (const [rel, v] of genList.slice(0, 10)) console.log(`    ${rel} ${JSON.stringify(v.hits)} · ${v.samples[0] || ''}`);
}
const coreTop = Object.entries(res.plain).filter(([r]) => !isGenerated(r)).sort((a, b) => b[1] - a[1]).slice(0, 8);
if (coreTop.length) console.log('참고 — 손님 화면 파일의 「사장님」 낱말 수(막지 않음): ' + coreTop.map(([r, n]) => `${r} ${n}`).join(' · '));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(res, null, 1));
if (res.coreFail && !WARN_ONLY) process.exit(1);

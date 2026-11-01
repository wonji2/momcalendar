// 보존 페이지에 남은 '깨진 내부링크' 청소 (사장님 지시 2026-10-01 "다 고쳐놔")
//
// 왜 필요한가
//   역검증(verify.ps1)은 깨진 내부링크를 하나라도 만나면 **그날 갱신 전체를 막는다**(설계대로 — 404 를 안 올린다).
//   그런데 그 검사는 26,000여 장 중 **300장 무작위 표본**이라, 깨진 링크가 있어도 걸리는 날과 아닌 날이 갈린다.
//   2026-10-01 전수 검사: 깨진 링크 22건 · 한 회차에 걸릴 확률 22.7% → 실제로 9/23·9/26·9/30 회차가 막혔고
//   사장님이 로슬러 실링팬 페이지가 9/29 에 굳은 걸 발견하실 때까지 아무도 몰랐다.
//
//   22건 모두 모양이 같다: 브랜드 페이지(g/)의 "공구 일정 상세" 칸이 없는 /gg/ 페이지를 가리킨다.
//   그 브랜드들(추피영어·무무배게·출시·말도·흉터…)은 나쁜 상품명 정리로 DB 에서 빠졌고,
//   페이지는 보존 원칙에 따라 디스크에 남아 **다시 만들어지지 않는다** → 생성기가 스스로 고칠 수 없는 자리다.
//
// 무엇을 하나
//   생성 폴더(g·gg·p·s·m·d·c)의 페이지에서 **대상 파일이 없는 내부링크**만 걷어낸다.
//   · <a href="/없는경로">…</a> 를 통째로 지운다
//   · 그래서 <div class="rel"> 가 비면 그 칸(<div class="sec">제목+rel</div>)도 지운다 — 빈 제목만 남지 않게
//   · 생성 폴더 밖(/index.html·/공구사이트.html 등)을 가리키는 링크는 **건드리지 않는다**(사람이 만든 페이지)
//
// 실행
//   node tools/seo/link_sweep.mjs            ← 고친다
//   node tools/seo/link_sweep.mjs --dry      ← 보기만 한다
//   .github/workflows/seo-daily.yml 에서 '페이지 생성' 과 '역검증' 사이에 돈다.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.SEO_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIRS = ['g', 'gg', 'p', 's', 'm', 'd', 'c'];
const DRY = process.argv.includes('--dry');
const NL = String.fromCharCode(10);

// 이 폴더들로 가는 링크만 손본다. 사람이 만든 루트 페이지는 생성기 소관이 아니다.
const MINE = new RegExp('^(' + DIRS.join('|') + ')/');
const A_TAG = /<a\s[^>]*href="\/([^"#]+)"[^>]*>[\s\S]*?<\/a>/g;
// 링크가 다 빠져 껍데기만 남은 칸: <div class="sec"><h2>…</h2><div class="rel"></div></div>
const EMPTY_SEC = /<div class="sec"><h2>[^<]*<\/h2><div class="rel"><\/div><\/div>/g;

const files = [];
for (const d of DIRS) {
  const p = join(ROOT, d);
  if (!existsSync(p) || !statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p)) if (f.endsWith('.html')) files.push(join(d, f));
}

const seen = new Map();                       // 같은 주소를 여러 번 확인하지 않는다(링크 70만 개)
const exists = (rel) => {
  if (!seen.has(rel)) seen.set(rel, existsSync(join(ROOT, rel)));
  return seen.get(rel);
};

let changed = 0, removedA = 0, removedSec = 0, scanned = 0;
const detail = [];
for (const rel of files) {
  const full = join(ROOT, rel);
  const before = readFileSync(full, 'utf8');
  let hits = 0;
  const after0 = before.replace(A_TAG, (tag, href) => {
    scanned++;
    let target;
    try { target = decodeURIComponent(href); } catch { return tag; }   // 주소가 깨졌으면 손대지 않는다
    if (!MINE.test(target)) return tag;                                 // 내 소관 밖
    if (exists(target)) return tag;
    hits++; detail.push(`${rel} → /${target}`);
    return '';
  });
  if (!hits) continue;
  let secs = 0;
  const after = after0.replace(EMPTY_SEC, () => { secs++; return ''; });
  removedA += hits; removedSec += secs; changed++;
  if (!DRY) writeFileSync(full, after, 'utf8');
}

console.log(`내부링크 청소: 페이지 ${files.length}개 · 검사한 링크 ${scanned}개`);
console.log(`  깨진 링크 ${removedA}건 제거 · 빈 칸 ${removedSec}개 제거 · 고친 페이지 ${changed}개${DRY ? ' (보기만 함)' : ''}`);
for (const d of detail.slice(0, 30)) console.log('   - ' + d);
if (detail.length > 30) console.log(`   … 외 ${detail.length - 30}건`);
// 깨진 게 없으면 조용히 끝난다 — 평소 회차에서는 이 줄만 남는다
process.exit(0);

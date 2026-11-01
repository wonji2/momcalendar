/**
 * 같은 셀러의 **비슷한 공구**를 찾는다 — 완전일치 중복검사가 놓치는 것을 잡는다
 *
 * 🔴 왜 (2026-10-05 검증자 지적)
 *   `cal_reg.mjs` 의 중복검사는 「같은 insta + **완전히 같은** open_date + **완전히 같은** 정규화 상품명」
 *   일 때만 막는다. 그래서 10월 달력 1,084건 중 **120건이 이미 있던 행과 같은 공구**로 들어가
 *   손님 화면에 같은 상품이 두 번(일부는 세 번) 떴다.
 *   메모리 `dup-check-three-holes` 가 말한 구멍이 그대로 샌 것이다:
 *     「퓌레/퓨레」 「네블/네뷸」(오타) · 「오리진·그로우 / 그로우 & 오리진」(어순) ·
 *     「휴브론 3in1 무선고데기 / 휴브론 무선고데기」(낱말 추가) · 오픈일 ±1~3일
 *
 * 판정: 같은 insta · 오픈일 ±N일 · **bigram Dice 유사도 ≥ 0.55**
 *   (완전일치 92건에 「퓌레/퓨레」가 잡히고, 「피타니 애사비 vs 피타니 레몬밤」처럼
 *    브랜드만 같은 쌍은 0.55 아래로 떨어지는 것을 양쪽 다 눈으로 확인한 임계값)
 *
 * 실행: node tools/daily/gonggu_near_dup.mjs [--since=2026-09-26] [--gap=3] [--sim=0.55] [--source=insta_cal]
 * 산출물: scratchpad/gonggu_near_dup.md  (사람이 읽고 **어느 쪽을 내릴지 판단**한다)
 * ⚠ 이 도구는 **찾기만 한다.** 내리는 것(approved=false)은 사람이 판단한다 — 둘 중 어느 쪽이
 *   맞는지는 셀러 원본을 봐야 안다(2026-10-05 실측: ameri._.mom 은 **새 행이 맞고 기존 행이 하루씩 틀렸다**).
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sbArgs, parseRows } from './sb_query.mjs';   // 🔴 CLI 출력은 환경마다 세 가지다 — 공용 파서를 쓴다

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const args = process.argv.slice(2);
const argv = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SINCE = argv('since', '2026-09-26');
const GAP = Number(argv('gap', '3'));
const SIM = Number(argv('sim', '0.55'));
const SRC = argv('source', 'insta_cal');
const NL = String.fromCharCode(10);

const norm = (s) => String(s || '').toLowerCase().replace(/[^가-힣a-z0-9]/g, '');
const bigrams = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
const dice = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const x of A) if (B.has(x)) hit++;
  return (2 * hit) / (A.size + B.size);
};
const days = (a, b) => Math.abs((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 864e5);

const sqlf = join(ROOT, 'scratchpad', '_near_dup.sql');
writeFileSync(sqlf, `select id, insta, influencer, name, open_date, end_date, source, approved
  from public.gonggu
 where approved and open_date >= '${SINCE}'
 order by insta, open_date;`, 'utf8');
// ⚠ maxBuffer 를 키우지 않으면 수천 행에서 ENOBUFS 로 죽는다(기본 1MB). 2026-10-05 실측 0.94MB.
const out = execFileSync(CLI, sbArgs(sqlf), { encoding: 'utf8', timeout: 300e3, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
const got = parseRows(out);
if (!got.ok) { console.log('🔴 CLI 출력을 못 읽었다 — 형식이 또 바뀌었거나 쿼리가 실패했다'); process.exit(1); }
const rows = got.rows;
console.log(`노출중 ${rows.length}행을 본다 (오픈일 ${SINCE} 이후)`);

const bySeller = new Map();
for (const r of rows) { if (!bySeller.has(r.insta)) bySeller.set(r.insta, []); bySeller.get(r.insta).push(r); }

const pairs = [];
for (const [insta, list] of bySeller) {
  if (!insta || list.length < 2) continue;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (days(a.open_date, b.open_date) > GAP) continue;
    // 한쪽은 이번 달력 배치, 다른 쪽은 기존 행 — 같은 소스끼리는 이미 중복검사가 봤다
    if (SRC && a.source === b.source) continue;
    const s = dice(norm(a.name), norm(b.name));
    if (s < SIM) continue;
    pairs.push({ insta, influencer: a.influencer, sim: s, a, b });
  }
}
pairs.sort((x, y) => y.sim - x.sim || x.insta.localeCompare(y.insta));

const md = [
  `# 같은 셀러의 비슷한 공구 — ${pairs.length}쌍 (오픈일 ±${GAP}일 · 유사도 ≥${SIM})`,
  '',
  '🔴 **도구는 찾기만 한다.** 어느 쪽을 내릴지는 **셀러 원본(달력 그림·캡션)을 보고** 판단한다.',
  '   2026-10-05 실측: `ameri._.mom` 13쌍은 **새 행이 맞고 기존 inpock 행이 하루씩 틀렸다.**',
  '',
  '| 유사도 | 셀러 | A(id·소스·오픈~마감·상품) | B(id·소스·오픈~마감·상품) |',
  '|---|---|---|---|',
  ...pairs.map((p) => `| ${p.sim.toFixed(2)} | ${p.influencer || p.insta} | ${p.a.id} \`${p.a.source || '-'}\` ${p.a.open_date}~${p.a.end_date} ${p.a.name} | ${p.b.id} \`${p.b.source || '-'}\` ${p.b.open_date}~${p.b.end_date} ${p.b.name} |`),
].join(NL);
const f = join(ROOT, 'scratchpad', 'gonggu_near_dup.md');
writeFileSync(f, md + NL, 'utf8');
console.log(`비슷한 쌍 ${pairs.length}건 → ${f}`);
const bySel = {};
for (const p of pairs) bySel[p.influencer || p.insta] = (bySel[p.influencer || p.insta] || 0) + 1;
console.log('많은 셀러:', Object.entries(bySel).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(' · '));

// 크몽 데이터 상품용 추출 — events 원본이 지워지기 전에 '팔 수 있는 모양'으로 빼낸다
//   왜 필요한가: 리포트 엔진(rpt_market·rpt_brand)의 검색수요·미충족수요·셀러TOP·브랜드TOP 섹션은
//   v_search_demand·v_card_clicks 를 거쳐 **events 원본**을 읽는다. events 보관일이 지나 지워지면
//   그 달 리포트를 **다시 만들 수 없다**. site_search_stats 는 최근 30일만 덮어쓰는 스냅샷이라 대체가 안 된다.
//
// 어디서 읽나: work-backup/db-export/events_*.jsonl (네트워크 안 씀 — 원본이 이미 디스크에 있다)
//   · events_2026-09_p01~p04.jsonl = 2026-06-02(id 1)부터의 첫 통째 내보내기
//   · events_YYYY-MM-DD.jsonl       = 그 뒤 날짜별
// 실행:  node tools/daily/data_product_export.mjs [--out <폴더>]
// 결과:  scratchpad/크몽_데이터/ 에 CSV 4개 (엑셀에서 한글이 깨지지 않게 UTF-8 BOM)
//
// ⚠ event_data 형식이 두 가지다 — 6월엔 평문, 나중엔 JSON. 둘 다 읽는다.
//     card_click 평문 = 인스타 핸들만 / JSON = {id,n(상품명),i(인스타),f(활동명),c(카테고리)}
//     search     평문 = 검색어만     / JSON = {q(검색어),n(결과수)}
// ⚠ 결과 파일에는 셀러 핸들·클릭수가 들어간다 → scratchpad(=gitignore) 밖으로 내보내지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const HOME = process.env.USERPROFILE || 'C:/Users/FAMILY';
const SRC = path.join(HOME, 'work-backup', 'db-export');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? process.argv[outIdx + 1]
  : path.join(process.cwd(), 'scratchpad', '크몽_데이터');

// 🔴 월 경계는 **한국시간(KST)** 으로 자른다. UTC 로 자르면 매월 1일 오전 9시 이전 기록이
//    전달로 밀려 리포트 월합이 틀어진다(실측: events_daily 와 월별로 ±수십~수백 건 어긋났다).
const month = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso).slice(0, 7);
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 7);
};
const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// 검색어: 월 → 검색어 → {n: 검색수, zero: 결과0건수}
const search = new Map();
// 카드클릭: 월 → 공구id|인스타 → {n, name, insta, seller, cat, clicks}
const click = new Map();
// 셀러: 월 → 인스타 → {seller, clicks}
const seller = new Map();
const typeByMonth = new Map();   // 대조용: 월 → 종류 → 건수

const bump = (m, k, init) => { if (!m.has(k)) m.set(k, init()); return m.get(k); };

let files = fs.readdirSync(SRC)
  .filter((f) => /^events_\d{4}-\d{2}(-\d{2})?(_p\d+)?\.jsonl$/.test(f))
  .sort();
if (!files.length) { console.error('🔴 events 백업 파일이 없다:', SRC); process.exit(1); }

let lines = 0, bad = 0;
for (const f of files) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(SRC, f), { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { bad++; continue; }
    lines++;
    const mo = month(d.visited_at || d.created_at);
    if (!mo) continue;
    const t = d.event_type;
    bump(typeByMonth, mo, () => new Map());
    const tm = typeByMonth.get(mo); tm.set(t, (tm.get(t) || 0) + 1);

    const raw = d.event_data;
    let obj = null;
    if (typeof raw === 'string' && raw.startsWith('{')) { try { obj = JSON.parse(raw); } catch { obj = null; } }
    else if (raw && typeof raw === 'object') obj = raw;

    if (t === 'search') {
      const q = clean(obj ? obj.q : raw);
      if (!q) continue;
      const s = bump(search, mo, () => new Map());
      const e = bump(s, q, () => ({ n: 0, zero: 0 }));
      e.n++;
      // 결과 0건(미충족 수요) — 평문 시절엔 결과수가 없어 셀 수 없다
      if (obj && Number(obj.n) === 0) e.zero++;
    } else if (t === 'card_click') {
      const insta = clean(obj ? obj.i : raw);
      const id = obj ? (obj.id ?? '') : '';
      const key = `${id}|${insta}`;
      const c = bump(click, mo, () => new Map());
      const e = bump(c, key, () => ({
        id, name: clean(obj ? obj.n : ''), insta,
        seller: clean(obj ? obj.f : ''), cat: clean(obj ? obj.c : ''), clicks: 0,
      }));
      e.clicks++;
      if (insta) {
        const sm = bump(seller, mo, () => new Map());
        const se = bump(sm, insta, () => ({ seller: clean(obj ? obj.f : ''), clicks: 0 }));
        se.clicks++;
        if (!se.seller && obj && obj.f) se.seller = clean(obj.f);
      }
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const csv = (rows) => '\uFEFF' + rows.map((r) => r.map((v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(',')).join('\r\n') + '\r\n';
const write = (name, rows) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, csv(rows), 'utf8');
  console.log(`  ${name}  ${rows.length - 1}행`);
  return p;
};

// 1) 검색 수요 (월별 검색어)
const r1 = [['월', '검색어', '검색수', '결과0건수']];
for (const [mo, m] of [...search].sort())
  for (const [q, e] of [...m].sort((a, b) => b[1].n - a[1].n)) r1.push([mo, q, e.n, e.zero]);

// 2) 미충족 수요 (결과 0건만)
const r2 = [['월', '검색어', '결과0건수']];
for (const [mo, m] of [...search].sort())
  for (const [q, e] of [...m].sort((a, b) => b[1].zero - a[1].zero)) if (e.zero) r2.push([mo, q, e.zero]);

// 3) 공구 카드 클릭 (월별 공구)
const r3 = [['월', '공구id', '상품명', '인스타', '셀러명', '카테고리', '클릭수']];
for (const [mo, m] of [...click].sort())
  for (const e of [...m.values()].sort((a, b) => b.clicks - a.clicks))
    r3.push([mo, e.id, e.name, e.insta, e.seller, e.cat, e.clicks]);

// 4) 셀러별 월간 클릭
const r4 = [['월', '인스타', '셀러명', '클릭수']];
for (const [mo, m] of [...seller].sort())
  for (const [insta, e] of [...m].sort((a, b) => b[1].clicks - a[1].clicks))
    r4.push([mo, insta, e.seller, e.clicks]);

console.log(`읽은 파일 ${files.length}개 · ${lines.toLocaleString()}줄 (깨진 줄 ${bad})`);
console.log(`내보낸 곳: ${OUT}`);
write('검색수요_월별.csv', r1);
write('미충족수요_결과0건.csv', r2);
write('공구카드클릭_월별.csv', r3);
write('셀러별_월간클릭.csv', r4);

// 대조표 — 월별·종류별 건수 (events_daily 와 맞춰보는 용도)
const r5 = [['월', '종류', '건수']];
for (const [mo, tm] of [...typeByMonth].sort())
  for (const [t, n] of [...tm].sort((a, b) => b[1] - a[1])) r5.push([mo, t, n]);
write('_대조_월별종류별건수.csv', r5);

console.log('\n월별 요약 (card_click / search)');
for (const [mo, tm] of [...typeByMonth].sort())
  console.log(`  ${mo}  클릭 ${(tm.get('card_click') || 0).toLocaleString().padStart(8)}  검색 ${(tm.get('search') || 0).toLocaleString().padStart(8)}`);

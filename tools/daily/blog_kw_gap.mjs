// 검색어 ↔ 공구 DB 대조 → 블로그 우선 키워드·파싱 목표 (2026-09-28, 사장님 "사이트 검색량 많은 걸 블로그 키워드로, 둘이 상호작용해서 디벨롭")
//
// 흐름
//   ① 사이트 검색어  site_search_stats(30일 집계 · supabase/sql/site_search_stats_65.sql) — CLI(관리자)로 읽는다. anon 은 못 읽는다.
//   ② 블로그 유입 검색어  sns-automation/state/blog-stats/<주 월요일>.json 의 searchAll(일별 합집합) 또는 search(주간 TOP20)
//   ③ 등록 공구  gonggu(approved, 오픈일 오늘−90일 이후) — REST anon, 1000건씩 페이지
//   → 검색어를 상품명과 대조해 세 갈래로 나눈다
//      A. 사이트에서 찾는데 공구가 없다  → 파싱 목표 (scratchpad/parsing_targets_kw.txt — 채널 4 블로그검색·5-b 카페검색의 검색어로 쓴다)
//      B. 블로그로 들어온 검색어인데 공구가 없다 → 파싱 목표 (같은 파일)
//      C. 양쪽 다 잡히는 브랜드 → 블로그 우선 키워드. make-card.mjs 가 site_search_stats 로 자동 반영하므로 여기선 보고만.
// 산출: scratchpad/blog_kw_gap.md (사장님용) · scratchpad/parsing_targets_kw.txt (세션이 읽는 검색 목표) · 반환값(주간 보고에 끼움)
// 실행: node tools/daily/blog_kw_gap.mjs [--week 2026-09-21]       (blog-stats.js 가 매주 월 09:30 에 부른다)
// ⚠ "공구가 없다" 는 지난 90일 등록 기준이다. 상품명이 검색어와 다르게 적혀 있으면(별칭) 없다고 나올 수 있다 — 승인표 올리기 전에 DB 를 한 번 더 본다.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sbArgs, parseRows } from './sb_query.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1';
const SB_KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const kstDate = (off = 0) => new Date(Date.now() + 9 * 3600e3 + off * 864e5).toISOString().slice(0, 10);

// 검색어 → 대조용 핵심어. 꼬리말(공구·9월·내돈내산…)을 떼고 공백을 없앤다. 너무 일반적인 말은 '' 로.
//   ⚠ 긴 말이 앞에 와야 한다 — '인스타' 가 '인스타그램' 앞에 있으면 "그램" 이 남는다(2026-09-28 실측 "인스타그램 공구 샤크닌자"→"그램샤크닌자").
const TAIL = /(인스타그램|공동구매|공구일정|공구 ?가격|공구중|공구|내돈내산|핫딜가|핫딜|후기|가격|정품|추천|일정|인스타|모음|할인|세일|링크|오픈|마감|구매|최저가|이벤트|사이트|찾는법|하는곳|진행중|\d+월)/g;
const GENERIC = /^(인스타|공구|공동구매|육아템|오늘|모음|일정|사이트|찾는법|기타|맘캘린더|맘캘|캘린더|달력|공구캘린더|공구달력)$/;
const DROP_TOKEN = /^(중|가|것|곳|거|중인|하는|하는곳|어디|어디서|어때|뭐|왜)$/;
/** 검색어 → 낱말 배열(꼬리말 제거). 첫 낱말이 보통 브랜드다. */
export const tokensOf = (q) => {
  const raw = String(q || '').toLowerCase().trim();
  // "inwoomom.somin" · "inwoomom.somin 공구" 같은 인스타 핸들(점·밑줄이 든 영문 낱말) — 점으로 쪼개면 낱말 하나가 새어 나온다 (검증 지적 2026-09-28).
  //   ⚠ 영문 8자 이상을 통째로 버리던 규칙은 뺐다 — ergobaby·numberblocks 같은 영문 브랜드가 죽는다.
  if (raw.split(/\s+/).some((w) => /^[a-z0-9]+[._][a-z0-9._]*$/.test(w))) return [];
  // 영문과 한글이 붙은 말("ovroom액션캠")은 경계에서 나눈다 — DB 엔 "OVROOM 초미니 액션캠" 으로 있어 통째로는 못 찾는다
  const s = raw.replace(/([a-z0-9])(?=[가-힣])/g, '$1 ').replace(/([가-힣])(?=[a-z])/g, '$1 ').replace(TAIL, ' ').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().replace(/\s+/g, ' ');
  if (!s || GENERIC.test(s.replace(/\s/g, ''))) return [];
  const toks = s.split(' ').filter((t) => t && !DROP_TOKEN.test(t));
  const core = toks.join('');
  return core.length >= 2 && core.length <= 20 ? toks : [];
};
export const coreOf = (q) => tokensOf(q).join('');

async function fetchGonggu(sinceDate) {
  const out = []; let from = 0;
  for (;;) {
    const r = await fetch(`${SB}/gonggu?select=name,open_date&approved=eq.true&open_date=gte.${sinceDate}&order=id.asc`, { headers: { apikey: SB_KEY, Range: `${from}-${from + 999}` } });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error('gonggu REST ' + r.status);
    out.push(...j); if (j.length < 1000) break; from += 1000;
  }
  return out;
}
function readSiteSearch() {
  const f = path.join(tmpdir(), 'mc_kw_gap.sql');
  writeFileSync(f, 'select term, c30, c7, miss30 from public.site_search_stats order by c30 desc limit 600;');
  // ⚠ cwd 는 레포 루트여야 한다 — `--linked` 가 supabase/ 설정 폴더를 cwd 에서 찾는다. blog-stats.js(cwd=sns-automation)에서 부르면 여기 없이는 실패한다(2026-09-28 실측).
  const out = execFileSync(CLI, sbArgs(f), { cwd: REPO, encoding: 'utf8', timeout: 90e3, stdio: ['ignore', 'pipe', 'pipe'] });
  const p = parseRows(out); if (!p.ok) throw new Error('site_search_stats CLI 출력 못 읽음');
  return p.rows.map((r) => ({ term: String(r.term || ''), c30: +r.c30 || 0, c7: +r.c7 || 0, miss30: +r.miss30 || 0 }));
}

/** @param {{week?:string, blogSearch?:Array<{searchQuery:string,cv:number}>}} o  → { md, targets, siteMiss, blogMiss, both, error } */
export async function kwGap({ week, blogSearch } = {}) {
  const res = { week, siteMiss: [], blogMiss: [], both: [], targets: [], md: '', error: '' };
  // ② 블로그 검색어
  let blog = blogSearch;
  if (!blog) {
    const dir = path.join(REPO, 'sns-automation', 'state', 'blog-stats');
    if (!week && existsSync(dir)) week = (await import('node:fs')).readdirSync(dir).filter((f) => f.endsWith('.json')).sort().pop()?.slice(0, 10);
    const f = week && path.join(dir, `${week}.json`);
    if (f && existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); blog = j.searchAll || j.search || []; res.week = week; }
    else blog = [];
  }
  let site = [], gonggu = [];
  try { site = readSiteSearch(); } catch (e) { res.error += `사이트 검색어 못 읽음(${String(e.message).slice(0, 60)}) `; }
  try { gonggu = await fetchGonggu(kstDate(-90)); } catch (e) { res.error += `공구 목록 못 읽음(${String(e.message).slice(0, 60)}) `; }
  // 별칭 표(bot_alias, 사이트·챗봇과 같은 한 곳) — "쉐프원"→"쉐프윈" 같은 오타·표기 변형만 대조 전에 정규화한다.
  //   ⚠ 표에는 카테고리 별칭(디자인스킨→플레이테이블, 빼빼구마→룰루맘)도 있다. 그걸 쓰면 실수요 목표(디자인스킨 28회·결과 0건)가 사라진다(검증 2차 지적)
  //   → 글자 편집거리 2 이하·길이 차 1 이하인 것(표기 변형)만 쓴다. 못 읽으면(비배열 응답 포함) 오류로 남기고 별칭 없이 간다.
  const alias = new Map();
  const lev = (a, b) => { const m = a.length, n = b.length; if (Math.abs(m - n) > 1) return 9; let p = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; } return p[n]; };
  try {
    const r = await fetch(`${SB}/bot_alias?select=term,expand&limit=2000`, { headers: { apikey: SB_KEY } }); const j = await r.json();
    if (!Array.isArray(j)) throw new Error('bot_alias 응답이 목록이 아님 ' + r.status);
    for (const a of j) { const t = String(a.term || '').toLowerCase().replace(/\s/g, ''), x = String(a.expand || '').toLowerCase().replace(/\s/g, ''); if (t && x && t !== x && t.length >= 3 && lev(t, x) <= 2) alias.set(t, x); }
  } catch (e) { res.error += `별칭 표 못 읽음(${String(e.message).slice(0, 40)}) `; }
  const canon = (c) => alias.get(c) || c;
  const names = gonggu.map((g) => String(g.name || '').toLowerCase().replace(/\s/g, ''));
  // "공구가 있다" = 상품명(공백 제거)에 검색어 전체가 들어 있거나, **첫 낱말(브랜드, 2자↑)** 또는 **둘째 낱말(3자↑)** 이 들어 있으면 된다.
  //   "윙플라 프라이팬" 은 DB 에 "아롱레시피 윙플라" 로 있고, "아롱레시피 윙플라"(셀러명이 앞) 는 둘째 낱말로만 잡힌다(검증 2차 지적).
  const wordHit = (w, min) => !!w && w.length >= min && !/^\d+$/.test(w) && names.some((n) => n.includes(w));
  const has = (core, first, second) => names.some((n) => n.includes(core)) || wordHit(first, 2) || wordHit(second, 3);
  const hasCount = (core, first, second) => names.filter((n) => n.includes(core) || (first && first.length >= 2 && n.includes(first)) || (second && second.length >= 3 && n.includes(second))).length;

  // A. 사이트 검색 — 30일 5회 이상인데 등록 공구 없음
  for (const r of site) { const t = tokensOf(r.term), c = canon(t.join('')); if (!c || r.c30 < 5) continue; if (!has(c, canon(t[0]), t[1])) res.siteMiss.push({ term: r.term, core: c, c30: r.c30, c7: r.c7, miss30: r.miss30 }); }
  // B. 블로그 유입 검색어 — 등록 공구 없음 (같은 핵심어는 합친다)
  const bm = new Map();
  for (const r of blog) { if (r.searchQuery === '기타') continue; const t = tokensOf(r.searchQuery), c = canon(t.join('')); if (!c) continue; const o = bm.get(c) || { core: c, first: canon(t[0]), second: t[1], cv: 0, q: [] }; o.cv += +r.cv || 0; if (!o.q.includes(r.searchQuery)) o.q.push(r.searchQuery); bm.set(c, o); }
  for (const o of bm.values()) if (!has(o.core, o.first, o.second)) res.blogMiss.push(o);
  res.blogMiss.sort((a, b) => b.cv - a.cv);
  // C. 양쪽에 다 있고 공구도 있는 브랜드 → 블로그 우선 키워드 (블로그 검색어의 첫 낱말 = 사이트 검색어 로 잇는다)
  const siteMap = new Map(); for (const r of site) { const c = canon(coreOf(r.term)); if (c && !siteMap.has(c)) siteMap.set(c, r); }
  const seenBoth = new Set();
  for (const o of bm.values()) {
    const key = siteMap.has(o.core) ? o.core : (siteMap.has(o.first) ? o.first : ''); const s = key && siteMap.get(key);
    if (!s || seenBoth.has(key) || !has(key, key)) continue; seenBoth.add(key);
    res.both.push({ core: key, site30: s.c30, blog: [...bm.values()].filter((x) => x.core === key || x.first === key).reduce((t, x) => t + x.cv, 0), gonggu90: hasCount(key, key) });
  }
  res.both.sort((a, b) => b.site30 - a.site30);
  // 파싱 목표 파일 — 세션이 채널 4·5-b 검색어로 쓴다 (핵심어 · 근거 · 수치)
  const tg = new Map();
  for (const r of res.siteMiss) tg.set(r.core, { core: r.core, why: `사이트 검색 ${r.c30}회/30일${r.miss30 ? ` (결과 0건 ${r.miss30}회)` : ''}`, score: r.c30 });
  // 블로그 쪽은 유입 2 이상만 목표로 (1건짜리는 오타·우연이 많다 — "A 드미노" 류). B 표에는 그대로 남긴다.
  for (const o of res.blogMiss) { const p = tg.get(o.core); if (p) p.why += ` · 블로그 유입 ${o.cv}`; else if (o.cv >= 2) tg.set(o.core, { core: o.core, why: `블로그 유입 ${o.cv} (${o.q.slice(0, 2).join(', ')})`, score: o.cv }); }
  res.targets = [...tg.values()].sort((a, b) => b.score - a.score);
  const sp = path.join(REPO, 'scratchpad'); mkdirSync(sp, { recursive: true });
  writeFileSync(path.join(sp, 'parsing_targets_kw.txt'), `# 검색어 기반 파싱 목표 (${kstDate()} · blog_kw_gap.mjs). 핵심어\t근거 — 네이버 블로그/카페 검색(채널 4·5-b)에 "<핵심어> 공구" 로 넣어 셀러를 찾는다\n` + res.targets.map((t) => `${t.core}\t${t.why}`).join('\n') + '\n', 'utf8');

  const L = [`# 🔎 검색어 ↔ 공구 대조 (${kstDate()}${res.week ? ` · 블로그 주 ${res.week}` : ''})`, ''];
  if (res.error) L.push(`🔴 ${res.error}`, '');
  L.push(`읽은 것: 사이트 검색어 ${site.length}개(30일) · 블로그 유입 검색어 ${blog.length}개 · 등록 공구 ${gonggu.length}건(90일)`, '');
  L.push(`## A. 사이트에서 많이 찾는데 등록 공구가 없다 — 파싱 목표 ${res.siteMiss.length}개`, '| 검색어 | 30일 | 7일 | 결과0건 |', '|---|---|---|---|');
  for (const r of res.siteMiss.slice(0, 40)) L.push(`| ${r.term} | ${r.c30} | ${r.c7} | ${r.miss30 || ''} |`);
  L.push('', `## B. 블로그로 들어온 검색어인데 등록 공구가 없다 — ${res.blogMiss.length}개`, '| 핵심어 | 유입 | 실제 검색어 |', '|---|---|---|');
  for (const o of res.blogMiss.slice(0, 40)) L.push(`| ${o.core} | ${o.cv} | ${o.q.slice(0, 3).join(', ')} |`);
  L.push('', `## C. 사이트·블로그 양쪽에서 찾고 공구도 있는 브랜드 — 블로그 우선 키워드 ${res.both.length}개 (make-card 가 제목·태그 앞자리에 자동 배치)`, '| 브랜드 | 사이트 30일 | 블로그 유입 | 등록 공구(90일) |', '|---|---|---|---|');
  for (const o of res.both.slice(0, 30)) L.push(`| ${o.core} | ${o.site30} | ${o.blog} | ${o.gonggu90} |`);
  L.push('', `파싱 목표 파일: \`scratchpad/parsing_targets_kw.txt\` (${res.targets.length}개) — 채널 4·5-b 에서 "<핵심어> 공구" 로 검색`, '');
  res.md = L.join('\n');
  writeFileSync(path.join(sp, 'blog_kw_gap.md'), res.md, 'utf8');
  return res;
}

if (process.argv[1] && /blog_kw_gap\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const i = process.argv.indexOf('--week');
  const r = await kwGap({ week: i > 0 ? process.argv[i + 1] : undefined });
  console.log(r.md);
  if (r.error) process.exitCode = 1;
}

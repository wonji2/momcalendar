/**
 * 🔍 구글 「"브랜드" 공구 site:instagram.com」(최근 1주) 발굴 결과 → 신규 셀러 후보 합치기 (2026-10-07 신설)
 *
 * 사장님 지시 2026-10-07:
 *   *"셀러는 1만명도 넘는데 우리가 가진 db가 한정적이니 신규셀러도 계속 발굴해야지"*
 *   *"구글에 브랜드명 공구 해서 최신 게시글로 필터걸면 인스타 공구 나오던데 그런식으로라도 해봐"*
 *
 * 흐름 (세션이 한다 — 구글은 브라우저 패널에서만 열린다, curl·빙·DDG·네이버는 막히거나 빈 응답 실측)
 *   ① 브랜드 목록: 최근 공구 상품명 첫 낱말 상위(`scratchpad/_brand_top.tsv`) 또는 손으로
 *   ② `node tools/daily/google_brand_leads_batch.mjs 브랜드1 브랜드2 …` → 브라우저 패널 browser_batch 에 넣을 actions JSON
 *      (한 브랜드 = 구글 검색 1회 + 글쓴이(A)·@언급(M) 추출. 3초 간격, 8개씩. 2026-10-07 실측 46개 연속 captcha 0)
 *   ③ 결과를 `scratchpad/_google_leads_<날짜>.txt` 에 `브랜드<TAB>A|M<TAB>핸들 핸들 …` 로 쌓는다
 *   ④ 이 도구: 아는 셀러(gonggu·sellers)·집계계정·브랜드 공식계정을 빼고 **신규 후보**를
 *      `scratchpad/_new_sellers.txt` 에 붙인다 → `parsing_nightly.mjs` 가 다음 회차에 인포크를 직접 본다(미확인 우선).
 *      인포크가 있고 일정이 있으면 그 셀러는 거기서 등록까지 간다. 없으면 그냥 지나간다(등록은 수확기가 판단).
 *
 *   node tools/daily/google_leads_merge.mjs scratchpad/_google_leads_2026-10-07.txt [--dry]
 * 실측 2026-10-07: 브랜드 46개 → 핸들 300여 개 → 신규 후보 1xx 명 (아래 로그)
 * 로그: scratchpad/google_leads_log.txt
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const SB = 'C:/Users/FAMILY/supabase-cli/supabase.exe';
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry');
if (!file) { console.log('발굴 파일을 주세요'); process.exit(1); }
const log = (s) => { const t = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); console.log(s); try { appendFileSync(SP('google_leads_log.txt'), `[${t}] ${s}\n`); } catch { } };

// 셀러가 아닌 것 — 집계계정·브랜드 공식계정·카페·쇼핑몰. 이름 꼴로 거른다(완벽하지 않다 — 수확기가 다시 본다)
const NOT_SELLER = /official|\.co$|\.kr$|\.biz$|\.com$|_korea$|korea$|^gonggu_|jupjup|ssokssok|gong\.gu|^we09|pangpang|kakaoshopping|sellerconnect|^momcal|wondermoms|medimantv|parents_school/i;

// 아는 셀러 — DB 에서 새로 뽑는다(파일 사본이 낡으면 안 된다)
let known = new Set();
try {
  const out = execFileSync(SB, ['db', 'query', '--linked', '--output-format', 'json',
    "select string_agg(h, ' ') hs from (select distinct lower(insta) h from gonggu where coalesce(insta,'')<>'' union select distinct lower(insta) from sellers where coalesce(insta,'')<>'') t;"],
    { encoding: 'utf8', timeout: 120000 });
  const m = out.match(/"hs":\s*"([^"]*)"/);
  if (m) known = new Set(m[1].split(' ').filter(Boolean));
} catch (e) { log('⚠ DB 셀러 목록을 못 읽었다(' + String(e.message).slice(0, 60) + ') — 파일 사본으로'); }
if (!known.size && existsSync(SP('_known_handles.txt'))) known = new Set(readFileSync(SP('_known_handles.txt'), 'utf8').split(/\r?\n/).filter(Boolean));
if (!known.size) { log('🔴 아는 셀러 목록이 비었다 — 중단'); process.exit(1); }

const already = new Set(existsSync(SP('_new_sellers.txt')) ? readFileSync(SP('_new_sellers.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
const authors = new Set(), mentions = new Set(); let total = new Set(), brands = new Set(), dropped = [];
for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!l || l.startsWith('#')) continue;
  const [b, k, hs] = l.split('\t'); if (!hs) continue;
  brands.add(b);
  for (const h0 of hs.split(/\s+/)) {
    const h = h0.toLowerCase().replace(/^@/, '').replace(/[.]+$/, ''); if (!/^[a-z0-9._]{3,30}$/.test(h)) continue;
    total.add(h);
    if (known.has(h)) continue;
    if (NOT_SELLER.test(h)) { dropped.push(h); continue; }
    (k === 'M' ? mentions : authors).add(h);
  }
}
for (const h of authors) mentions.delete(h);
const fresh = [...authors, ...mentions].filter((h) => !already.has(h));
log(`브랜드 ${brands.size}개 · 핸들 ${total.size} · 아는 셀러 제외 → 글쓴이 ${authors.size} · @언급 ${mentions.size} · 비셀러꼴 제외 ${new Set(dropped).size} · 후보파일에 이미 있음 ${[...authors, ...mentions].length - fresh.length}`);
if (DRY) { console.log(fresh.join(' ')); process.exit(0); }
if (fresh.length) appendFileSync(SP('_new_sellers.txt'), fresh.join('\n') + '\n');
log(`→ _new_sellers.txt 에 ${fresh.length}명 추가 (parsing_nightly 가 다음 회차에 인포크를 직접 본다)`);

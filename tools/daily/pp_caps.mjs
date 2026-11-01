// 공구팡팡 단서 → 셀러 인스타 원본 캡션 수집기 (사장님 2026-09-15 "429 풀렸으니 공구팡팡처럼 파싱 계속해")
//
// 흐름: scratchpad/pp_leads/<오늘·어제>.md (pp_leads.mjs 가 매시간 xx:12 에 쌓는 단서, 09pangpang post id 포함)
//   → 09pangpang.com/post/<id> 페이지에서 인스타 shortcode · 셀러 핸들 · 게시시각(article:published_time, UTC) 추출
//   → instagram.com/p/<code>/ og:description 으로 캡션 수확 (로그인 불필요, node fetch 로 200)
//   → scratchpad/ig_feed/<오늘>.jsonl 에 {code,u,fn,t,ad,src:'pp',cap} 로 추가 + ig_feed_seen.txt 에 code 기록
//   → 이후는 무인 파이프라인(ig_feed_pipeline.sh, 매시간 xx:25)이 변환·게이트·등록한다.
// 규칙 8: 공구팡팡은 단서일 뿐이다. 상품·날짜는 전부 셀러 캡션에서 변환기가 다시 읽는다(단서의 날짜·상품명은 안 쓴다).
//
// 실행: node tools/daily/pp_caps.mjs           (예약작업 momcal-pp-caps, 매시간 xx:18 — pp_leads 뒤·pipeline 앞)
// 상태: scratchpad/pp_caps_state.json · 처리 끝난 post id: scratchpad/pp_caps_seen.txt · 실패 횟수: scratchpad/pp_caps_fail.json
// 로그: scratchpad/pp_caps_log.txt (run_hidden.vbs 경유라 stderr 가 사라진다 — 모든 오류를 여기 남긴다)
//
// 🔴 2026-09-15 검증자 지적으로 고친 것
//   · og:description 의 날짜는 UTC 가 아니라 **미국 태평양 시간**(KST−16h) → 09pangpang 의 article:published_time(UTC) 로 t 를 정한다.
//     스윕(taken_at UTC 날짜)과 같은 기준이 된다. published_time 이 없을 때만 og 날짜를 쓰고 로그에 남긴다.
//   · og 의 핸들 정규식이 "좋아요수 없는 형식"에 안 맞아 단서 핸들로 폴백하던 것 → 09pangpang 페이지의 instagram.com/<핸들>/ 링크가 1순위,
//     og 에서 핸들이 읽히면 그것으로 덮는다(게시물 페이지가 더 정확). 둘이 다르면 로그.
//   · seen 을 결과 확인 전에 기록하던 것 → 성공(또는 09pangpang 에 인스타 링크 자체가 없음)일 때만 기록. 실패는 3회까지 재시도.
//   · 스윕이 **빈 캡션**으로 seen 처리한 게시물은 캡션이 없는 것이다 → 다시 받아 넣고, 변환기가 다시 보게 conv_seen 에서 그 code 를 뺀다.
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const LEADS = path.join(ROOT, 'scratchpad', 'pp_leads');
const FEED = path.join(ROOT, 'scratchpad', 'ig_feed');
const STATE = path.join(ROOT, 'scratchpad', 'pp_caps_state.json');
const FAILS = path.join(ROOT, 'scratchpad', 'pp_caps_fail.json');
const SEEN_PP = path.join(ROOT, 'scratchpad', 'pp_caps_seen.txt');
const SEEN_IG = path.join(ROOT, 'scratchpad', 'ig_feed_seen.txt');
const SEEN_CONV = path.join(ROOT, 'scratchpad', 'ig_feed_conv_seen.txt');
const LOG = path.join(ROOT, 'scratchpad', 'pp_caps_log.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128';
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace('Z', '+09:00');
const today = KST().slice(0, 10);
const log = (s) => { const l = `[${KST().slice(0, 16).replace('T', ' ')}] ${s}`; console.log(l); appendFileSync(LOG, l + '\n'); };
const rd = (p) => existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
const rdJson = (p, d) => { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d; } catch { return d; } };
const state = rdJson(STATE, { runs: 0 });
const fails = rdJson(FAILS, {});
const save = (p) => { Object.assign(state, p, { lastRun: KST() }); writeFileSync(STATE, JSON.stringify(state, null, 2)); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (url, extra = {}) => fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'ko', ...extra }, signal: AbortSignal.timeout(20000) });
const dec = (s) => s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const MON = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };
const LIMIT = Number(process.env.LIMIT || 120);
const MAX_FAIL = 3;

try {
  // 오늘·어제 단서 파일 (자정 직후 회차가 어제 것을 놓치지 않게)
  const files = readdirSync(LEADS).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().slice(-2);
  const seenPP = new Set(rd(SEEN_PP));
  const leads = []; const seenId = new Set();
  for (const f of files) for (const l of readFileSync(path.join(LEADS, f), 'utf8').split('\n')) {
    const m = l.match(/^\| [\d:]+ \| (\S+) \| .+? \| \d{4}-\d\d-\d\d \| [^|]* \| [^|]* \| 09pangpang\.com\/post\/(\d+)/);
    if (!m || seenPP.has(m[2]) || seenId.has(m[2])) continue;
    if ((fails[m[2]] || 0) >= MAX_FAIL) continue;
    seenId.add(m[2]); leads.push({ h: m[1], id: m[2] });
  }
  // 스윕이 이미 캡션까지 받아둔 code — 이건 건너뛴다. 빈 캡션으로만 본 code 는 다시 받는다.
  const hasCap = new Set();
  for (const f of readdirSync(FEED).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-3)) {
    for (const line of readFileSync(path.join(FEED, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const j = JSON.parse(line); if (j.code && j.cap && j.cap.trim()) hasCap.add(j.code); } catch { }
    }
  }
  const seenIG = new Set(rd(SEEN_IG));
  const out = path.join(FEED, today + '.jsonl');
  let resolved = 0, fetched = 0, skipped = 0, refetched = 0, fail = 0, stop = '';
  const unconv = [];   // 변환기가 다시 보게 conv_seen 에서 뺄 code
  for (const L of leads.slice(0, LIMIT)) {
    let code = '', handle = '', pub = '';
    try {
      const h = await get('https://09pangpang.com/post/' + L.id).then(r => r.text());
      code = (h.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/) || [])[1] || '';
      handle = (h.match(/instagram\.com\/([A-Za-z0-9._]+)\/?"/) || [])[1] || '';
      pub = (h.match(/article:published_time" content="([^"]+)"/) || [])[1] || '';
      if (!code) { appendFileSync(SEEN_PP, L.id + '\n'); fail++; log(`인스타 링크 없음 post ${L.id} ${L.h}`); await sleep(400); continue; }
    } catch (e) { fails[L.id] = (fails[L.id] || 0) + 1; fail++; log(`09pangpang 실패 ${L.id} ${String(e).slice(0, 60)}`); await sleep(1000); continue; }
    resolved++;
    if (hasCap.has(code)) { appendFileSync(SEEN_PP, L.id + '\n'); skipped++; await sleep(300); continue; }
    try {
      const res = await get('https://www.instagram.com/p/' + code + '/');
      if (res.status === 429) { stop = '429'; log(`🔴 인스타 429 — 중단 (${code})`); break; }
      const html = await res.text();
      const og = (html.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
      if (!og) { fails[L.id] = (fails[L.id] || 0) + 1; fail++; log(`캡션 없음 ${code} ${handle || L.h} status ${res.status} (${fails[L.id]}회)`); await sleep(1500); continue; }
      const d = dec(og);
      const m = d.match(/([A-Za-z0-9._]+) - ([A-Za-z]+) (\d{1,2}), (\d{4}): "([\s\S]*)"\.?\s*$/);
      let cap = d, ogHandle = '', ogDate = '';
      if (m) { ogHandle = m[1]; ogDate = m[4] + '-' + (MON[m[2]] || '00') + '-' + String(m[3]).padStart(2, '0'); cap = m[5]; }
      else { const m2 = d.match(/^[^:]*?: "([\s\S]*)"/); if (m2) cap = m2[1]; }
      // 게시일: 09pangpang 의 published_time(UTC) → 스윕의 taken_at UTC 날짜와 같은 기준. 없으면 og 날짜(태평양시)로 대신하고 남긴다.
      let t = pub ? new Date(pub).toISOString().slice(0, 10) : '';
      if (!t || t === 'Invalid Date') { t = ogDate || today; log(`published_time 없음 ${code} → og 날짜 ${t} 사용`); }
      let u = ogHandle || handle || L.h;
      if (ogHandle && handle && ogHandle !== handle) log(`핸들 불일치 ${code}: 09pangpang ${handle} / og ${ogHandle} → og 채택`);
      appendFileSync(out, JSON.stringify({ code, u, fn: '', t, ad: false, src: 'pp', cap, seenAt: KST() }) + '\n');
      if (seenIG.has(code)) { refetched++; unconv.push(code); } else { appendFileSync(SEEN_IG, code + '\n'); seenIG.add(code); }
      appendFileSync(SEEN_PP, L.id + '\n');
      delete fails[L.id];
      fetched++;
    } catch (e) { fails[L.id] = (fails[L.id] || 0) + 1; fail++; log(`인스타 실패 ${code} ${String(e).slice(0, 60)}`); }
    await sleep(900 + Math.random() * 600);
  }
  // 빈 캡션으로 이미 변환됐던 code 는 변환기가 다시 보게 conv_seen 에서 뺀다
  if (unconv.length && existsSync(SEEN_CONV)) {
    const drop = new Set(unconv);
    const kept = readFileSync(SEEN_CONV, 'utf8').split(/\r?\n/).filter(c => c && !drop.has(c.trim()));
    writeFileSync(SEEN_CONV, kept.join('\n') + '\n');
  }
  writeFileSync(FAILS, JSON.stringify(fails, null, 2));
  save({ runs: (state.runs || 0) + 1, lastLeads: leads.length, lastResolved: resolved, lastFetched: fetched, lastRefetched: refetched, lastSkipped: skipped, lastFail: fail, lastErr: stop || (fail && !fetched && !skipped ? 'all-fail' : null) });
  log(`단서 ${leads.length} · 코드 ${resolved} · 스윕이 캡션까지 본 것 ${skipped} · 새 캡션 ${fetched}(빈캡션 재수확 ${refetched}) · 실패 ${fail}${stop ? ' · 중단 ' + stop : ''}`);
} catch (e) {
  log(`🔴 최상위 오류: ${String(e && e.stack || e).slice(0, 300)}`);
  save({ lastErr: String(e).slice(0, 120) });
  process.exit(1);
}

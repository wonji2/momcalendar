// 매일 자동 마케팅 키워드 수집 (사장님 지시 2026-08-31 "매일 자동으로 키워드 세팅하고 연관검색어 등")
// 윈도우 예약작업 momcal-kw-daily 가 매일 07:40 실행. Claude 앱과 무관하게 돈다.
//
// 하는 일
//  1) 공구브랜드.html 의 전체 브랜드 목록을 매일 150개씩 순환하며 "브랜드 공구" 월간 검색량 수집
//     → scratchpad/kw_volume_log.tsv 누적 (커서: scratchpad/kw_brand_cursor.txt)
//  2) API 응답의 연관검색어 중 '공구' 포함 + 월 100회 이상 → scratchpad/kw_related_log.tsv 누적
//     (우리가 몰랐던 "OO 공구" 수요를 자동 발굴하는 통로)
//  3) 월요일엔 핵심 키워드(scratchpad/kw_targets.txt)도 재측정 (월간값이라 주 1회면 충분)
//
// 키: ~/.momcal_naverad.json (절대 커밋·출력 금지)
// 한도: 배치 5개/호출·1.2초 간격 = 하루 31회 호출 수준. 429 면 30초 쉬고 재시도.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

const ROOT = 'C:/Users/FAMILY/Desktop/MOMCALENDAR';
const SCR = path.join(ROOT, 'scratchpad');
const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.momcal_naverad.json'), 'utf8'));
const BASE = 'https://api.searchad.naver.com', URI = '/keywordstool';
const PER_DAY = parseInt(process.env.KW_PER_RUN || '150', 10); // 전량 스윕은 KW_PER_RUN=9999 로

function headers() {
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', cfg.secret_key).update(`${ts}.GET.${URI}`).digest('base64');
  return { 'X-Timestamp': ts, 'X-API-KEY': cfg.access_license, 'X-Customer': String(cfg.customer_id), 'X-Signature': sig };
}
const numOf = v => (typeof v === 'number') ? v : (/^<\s*10/.test(String(v)) ? 5 : parseInt(String(v).replace(/,/g, '')) || 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const today = kst.toISOString().slice(0, 10);
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

// ── 브랜드 목록: 허브 페이지에서 읽는다 (빌드가 매일 최신으로 갱신하는 정본)
const hub = fs.readFileSync(path.join(ROOT, '공구브랜드.html'), 'utf8');
const brands = [...hub.matchAll(/<a href="\/g\/[^"]+">([^<]+)<\/a>/g)].map(m => unesc(m[1]).trim())
  .filter(b => b.length >= 2 && !/^\d+$/.test(b));
if (brands.length < 100) { console.error('브랜드 목록 비정상:', brands.length); process.exit(1); }

const CUR = path.join(SCR, 'kw_brand_cursor.txt');
let cur = 0; try { cur = parseInt(fs.readFileSync(CUR, 'utf8')) || 0; } catch {}
if (cur >= brands.length) cur = 0;
const batchBrands = brands.slice(cur, cur + PER_DAY);

// 월요일이면 핵심 키워드도 같이
let core = [];
if (kst.getUTCDay() === 1) {
  try { core = fs.readFileSync(path.join(SCR, 'kw_targets.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')); } catch {}
}
const queries = [...core, ...batchBrands.map(b => `${b} 공구`)];
// 힌트는 한글·영숫자만 허용된다 — 특수문자(·&.+% 등) 섞이면 배치 전체가 400 난다(2026-08-31 실측)
const hintOf = k => k.replace(/[^가-힣A-Za-z0-9]/g, '');
const uniq = [...new Map(queries.map(k => [hintOf(k), k])).entries()].filter(([h]) => h.length >= 2);

const volRows = [], relSeen = new Set(), relRows = [];
let calls = 0;
for (let i = 0; i < uniq.length; i += 5) {
  const batch = uniq.slice(i, i + 5);
  const q = 'hintKeywords=' + encodeURIComponent(batch.map(b => b[0]).join(',')) + '&showDetail=1';
  let res;
  try { res = await fetch(`${BASE}${URI}?${q}`, { headers: headers() }); }
  catch (e) { console.error('네트워크 실패:', e.message); await sleep(10000); i -= 5; continue; }
  calls++;
  if (!res.ok) {
    if (res.status === 429) { await sleep(30000); i -= 5; continue; }
    // 400(유효하지 않은 키워드)은 이 배치만 버리고 계속 간다 — 전체 스윕을 멈추지 않는다
    console.error(`API ${res.status} (배치 스킵: ${batch.map(b => b[1]).join(',')})`, (await res.text()).slice(0, 120));
    if (res.status === 400) continue;
    break;
  }
  const j = await res.json();
  const list = j.keywordList || [];
  const map = new Map(list.map(r => [r.relKeyword.replace(/\s+/g, '').toUpperCase(), r]));
  for (const [hint, orig] of batch) {
    const r = map.get(hint.toUpperCase());
    if (!r) { volRows.push([today, orig, 0, 0, 0, '']); continue; }
    const pc = numOf(r.monthlyPcQcCnt), mo = numOf(r.monthlyMobileQcCnt);
    volRows.push([today, orig, pc, mo, pc + mo, r.compIdx || '']);
  }
  // 연관검색어 발굴: '공구' 포함 + 월 100회 이상
  for (const r of list) {
    const k = r.relKeyword;
    if (!k.includes('공구')) continue;
    const tot = numOf(r.monthlyPcQcCnt) + numOf(r.monthlyMobileQcCnt);
    if (tot < 100 || relSeen.has(k)) continue;
    relSeen.add(k);
    relRows.push([today, k, tot, r.compIdx || '']);
  }
  if (i + 5 < uniq.length) await sleep(1200);
}

fs.appendFileSync(path.join(SCR, 'kw_volume_log.tsv'), volRows.map(r => r.join('\t')).join('\n') + '\n', 'utf8');
if (relRows.length) {
  relRows.sort((a, b) => b[2] - a[2]);
  fs.appendFileSync(path.join(SCR, 'kw_related_log.tsv'), relRows.map(r => r.join('\t')).join('\n') + '\n', 'utf8');
}
fs.writeFileSync(CUR, String(cur + PER_DAY >= brands.length ? 0 : cur + PER_DAY), 'utf8');
const top = volRows.filter(r => r[4] >= 300).sort((a, b) => b[4] - a[4]).slice(0, 15);
const log = [`[${today}] 브랜드 ${cur}~${cur + batchBrands.length}/${brands.length} · 호출 ${calls} · 검색량300+ ${top.length}건 · 연관발굴 ${relRows.length}건`,
  ...top.map(r => `  ${r[1]} = ${r[4]} (${r[5]})`)].join('\n');
fs.appendFileSync(path.join(SCR, 'kw_daily_report.txt'), log + '\n', 'utf8');
console.log(log);

// ── 검색량 지도 재생성 → 저장소 자동 반영 (사장님 지시 2026-08-31 "매일 자동으로 돌아가게") ──
// 누적 로그 전체에서 tools/seo/kw_volume.json 을 다시 만들고, 경량 클론(momcal-kwbot)으로
// commit·push 한다. 다음 날 새벽빌드가 이 지도를 읽어 내부링크를 검색량순으로 재배치한다.
// 잡음(일반어·하드웨어 공구)은 NOISE 로 제외 — 여기 한 줄 추가가 유일한 관리 지점.
const NOISE = new Set(['우리', '자동차', '지금', '오늘', '한일', '스탠리', '보쉬', '디월트', '마끼다', '공구', '가정용', '전동', '국산']);
try {
  const brandSetL = new Set(brands.map(b => b.trim()));
  const vol = {};
  for (const line of fs.readFileSync(path.join(SCR, 'kw_volume_log.tsv'), 'utf8').split(/\r?\n/)) {
    const c = line.split('\t');
    if (c.length < 5 || !c[1].endsWith(' 공구')) continue;
    const brand = c[1].slice(0, -3).trim();
    const tot = parseInt(c[4]) || 0;
    if (NOISE.has(brand)) continue;
    if (brandSetL.has(brand) && tot >= 50) vol[brand] = tot; // 뒤 행(최신)이 덮어씀
  }
  const json = JSON.stringify(Object.fromEntries(Object.entries(vol).sort((a, b) => b[1] - a[1])), null, 1);
  fs.writeFileSync(path.join(ROOT, 'tools', 'seo', 'kw_volume.json'), json, 'utf8'); // 로컬 빌드용
  const BOT = 'C:/Users/FAMILY/momcal-kwbot';
  if (fs.existsSync(BOT)) {
    execSync('git pull --rebase -q', { cwd: BOT, stdio: 'pipe' });
    fs.writeFileSync(path.join(BOT, 'tools', 'seo', 'kw_volume.json'), json, 'utf8');
    const st = execSync('git status --porcelain tools/seo/kw_volume.json', { cwd: BOT }).toString().trim();
    if (st) {
      execSync('git add tools/seo/kw_volume.json', { cwd: BOT });
      execSync(`git commit -q -m "검색량 지도 자동 갱신 (${today}, ${Object.keys(vol).length}개 브랜드)"`, { cwd: BOT });
      execSync('git push -q', { cwd: BOT, stdio: 'pipe' });
      console.log(`검색량 지도 push 완료 (${Object.keys(vol).length}개 브랜드)`);
    } else console.log('검색량 지도 변화 없음 — push 생략');
  } else {
    fs.appendFileSync(path.join(SCR, 'kw_daily_report.txt'), `  🔴 momcal-kwbot 클론 없음 — 지도 push 생략\n`, 'utf8');
  }
} catch (e) {
  // schtasks 는 콘솔을 버린다 — 실패는 보고 파일에 남겨 세션이 발견하게 한다
  fs.appendFileSync(path.join(SCR, 'kw_daily_report.txt'), `  🔴 검색량 지도 push 실패: ${e.message.slice(0, 150)}\n`, 'utf8');
}

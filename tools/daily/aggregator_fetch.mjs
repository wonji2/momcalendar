/**
 * 📥 집계 사이트 두 곳의 공구 일정을 **브라우저 없이** 받아 파일로 둔다 (2026-10-07)
 *   사장님: "공구팡팡이 오늘 있는글들 우리 다 올린거 맞아? 공구모아 사이트에 있는것도 우리가 전부 다 미리 갖고 있어야해"
 *
 * ① 공구모아(gonggumoa.com) — 화면은 GitHub Pages 지만 데이터는 **Apps Script 프록시**에서 쪽 단위로 받는다
 *      GET <PROXY>?offset=0&limit=1000 → {items:[{cat,sub,date,end_date,name,inf,insta,url}], total, hasMore}
 *    🔑 `insta` 핸들이 그대로 들어 있다 — 화면에는 한글명만 보이지만 원천엔 핸들이 있다(2026-10-07 실측 3,389건 전부).
 *       그래서 한글명→핸들 추정이 필요 없고, 동명이인 사고(콩알맘/콩알픽)도 안 난다.
 *    ⚠ 상품명에 zero-width 문자(​⁠)가 섞여 있다 → 지운다. 집계처 url 은 남의 어필리에이트일 수 있어 **안 쓴다**.
 * ② 공구팡팡(09pangpang.com/calendar) — 오늘 오픈·진행 카드가 SSR HTML 에 다 있다(<a title="상품" href="/post/ID">…핸들…팔로워)
 *
 * 출력  scratchpad/_gonggumoa_latest.json  ([{major,minor,open,end,name,seller,insta}] — 마감 안 지난 것만, 날짜별 사본 _gonggumoa_<날짜>.json)
 *       scratchpad/_pangpang_today.tsv      (핸들\t상품\t날짜표기\t상태\t대분류\t소분류\t팔로워\t태그)
 * 실행  node tools/daily/aggregator_fetch.mjs      (aggregator_register.mjs 가 먼저 부른다)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SP = (f) => path.join(ROOT, 'scratchpad', f);
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROXY = 'https://script.google.com/macros/s/AKfycbwvqvbGVLOUBhIqITLa1SmzG_v-OB-tZRhJxFmO6VMV_ntVDuwRordm2OcHCtRSmRytMg/exec';

async function getText(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60e3) });
      if (!r.ok) throw new Error('http ' + r.status);
      return await r.text();
    } catch (e) { last = e; await sleep(5000 * (i + 1)); }
  }
  throw last;
}
const zw = (s) => String(s || '').replace(/[​-‏⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'");

export async function fetchGonggumoa() {
  const all = []; let off = 0;
  for (let p = 0; p < 20; p++) {
    const j = JSON.parse(await getText(`${PROXY}?offset=${off}&limit=1000`));
    const items = j.items || []; all.push(...items);
    if (!j.hasMore || !items.length) break;
    off += items.length; await sleep(800);
  }
  const rows = all.map((x) => ({
    id: x.id, major: zw(x.cat), minor: zw(x.sub), open: zw(x.date), end: zw(x.end_date) || zw(x.date),
    name: zw(x.name), seller: zw(x.inf), insta: zw(x.insta).toLowerCase().replace(/^@/, ''),
  })).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.open) && r.name);
  const live = rows.filter((r) => r.end >= today);
  // 핸들 등장 횟수(전체 3,389건 기준) — 1번만 나온 핸들은 오타일 수 있다(won_monny ↔ won_moony, 2026-10-07 실측)
  const cnt = {}; for (const r of rows) if (r.insta) cnt[r.insta] = (cnt[r.insta] || 0) + 1;
  writeFileSync(SP('_gonggumoa_handle_counts.json'), JSON.stringify(cnt));
  writeFileSync(SP(`_gonggumoa_${today}.json`), JSON.stringify(live));
  writeFileSync(SP('_gonggumoa_latest.json'), JSON.stringify(live));
  return { all: all.length, live: live.length, withInsta: live.filter((r) => r.insta).length };
}

export async function fetchPangpang() {
  const h = await getText('https://09pangpang.com/calendar');
  const re = /<a [^>]*title="([^"]*)"[^>]*href="\/post\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const out = []; const seen = new Set(); let m;
  while ((m = re.exec(h))) {
    const title = zw(dec(m[1]));
    const parts = m[3].replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, '|').split('|').map((s) => zw(dec(s))).filter(Boolean);
    const fi = parts.findLastIndex((p) => /^[\d.]+(만|천)?$/.test(p));
    const handle = fi > 0 ? parts[fi - 1] : '';
    if (!/^[a-z0-9._]{2,30}$/i.test(handle)) continue;
    const dates = parts.find((p) => /^\d{1,2}\/\d{1,2}/.test(p)) || '';
    const status = dates ? parts[parts.indexOf(dates) - 1] || '' : '';
    const gi = parts.indexOf('>'); const major = gi > 0 ? parts[gi - 1] : ''; const minor = gi > 0 ? parts[gi + 1] : '';
    const tags = parts.filter((p, i) => parts[i - 1] === '#');
    const key = `${handle.toLowerCase()}|${title}|${dates}`; if (seen.has(key)) continue; seen.add(key);
    out.push([handle.toLowerCase(), title, dates, status, major, minor, parts[fi] || '', tags.join(',')].join('\t'));
  }
  writeFileSync(SP('_pangpang_today.tsv'), out.join('\n') + (out.length ? '\n' : ''));
  return { cards: out.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const g = await fetchGonggumoa().catch((e) => ({ error: String(e.message || e) }));
  const p = await fetchPangpang().catch((e) => ({ error: String(e.message || e) }));
  console.log('공구모아', JSON.stringify(g), '· 공구팡팡', JSON.stringify(p));
  if (g.error || p.error) process.exit(1);
}

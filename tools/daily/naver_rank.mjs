// 네이버 통합검색 "진짜 순위" 일일 실측 (사장님 지시 2026-09-07 "관련 검색어 다 1위로 올려놔")
//
// 왜 따로 있나: serp_check.sh 가 남기는 값은 HTML 바이트 오프셋이라 순위가 아니다.
// 네이버 통합검색은 결과 하나가 블록(sc_new) 하나다 → 광고·네이버 자체 블록(쇼핑·클립·페이 등)을 뺀
// **유기 블록 순번** = 손님이 보는 순위. 우리 = momcalendar.com / blog.naver.com/momcal / cafe.naver.com/momcal.
//
//   node tools/daily/naver_rank.mjs                 → 아래 QUERIES 전부, scratchpad/naver_rank_log.tsv 에 한 줄씩 추가
//   node tools/daily/naver_rank.mjs "검색어" ...     → 그 검색어만 (로그에도 남긴다)
//   WHERE=web node tools/daily/naver_rank.mjs …     → 웹문서 탭 (색인 여부 확인용)
//
// 로그 형식: date  query  rank  organic_total  kind(사이트/블로그/카페)  ahead(앞 3개 도메인)  url
// 주기: 매일 21시 ops_backup.ps1 → serp_check.sh 끝에서 호출. 추세는 `awk -F'\t' '$2=="인스타 공구"' scratchpad/naver_rank_log.tsv`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG = path.join(ROOT, 'scratchpad', 'naver_rank_log.tsv');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// 노리는 검색어 (검색량·GSC 실측 순). 바꾸면 이 목록만 고친다.
const QUERIES = [
  '인스타 공구', '인스타공구', '인스타 공구 모음', '인스타 공구 사이트', '인스타 공구 어플', '인스타 공구일정', '인스타 공동구매',
  '공구 사이트', '공동구매 사이트', '공구 일정', '공구일정', '공구 일정 사이트', '오늘 공구', '공구 모음 사이트', '공구하는 곳', '공구 캘린더', '맘캘린더',
  '무아스 공구', '바크 공구', '유라이크 공구', '상떼 공구', '알텐바흐 공구', '세이펜 공구', '탁가온 공구', '바이칸 공구',
];
const OURS = /momcalendar\.com|blog\.naver\.com\/momcal\b|cafe\.naver\.com\/momcal\b/;
const SKIP = /ader\.naver|pay\.naver|keep\.naver|shopping\.naver|mkt\.naver|policy\.naver|navercorp|whale\.naver|naver\.com\/?$|pstatic|search\.naver|help\.naver|nid\.naver/;
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rankOf(q) {
  const where = process.env.WHERE ? `where=${process.env.WHERE}&` : '';
  const h = await (await fetch(`https://search.naver.com/search.naver?${where}query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': UA } })).text();
  const idx = [...h.matchAll(/<(?:div|section)[^>]+class="[^"]*\bsc_new\b[^"]*"/g)].map((m) => m.index);
  const rows = [];
  idx.forEach((p, i) => {
    const b = h.slice(p, idx[i + 1] ?? p + 400000);
    const links = [...b.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/g)].map((x) => ({ u: x[1], t: strip(x[2]) })).filter((x) => x.t.length > 6 && !SKIP.test(x.u));
    if (!links.length) return;
    const first = links.find((x) => !/^(네이버|Keep)/.test(x.t)) || links[0];
    const our = links.find((x) => OURS.test(x.u));
    const isAd = /ader\.naver/.test(b.slice(0, 3000)) && !our;
    rows.push({ dom: first.u.replace(/^https?:\/\/(www\.|m\.)?/, '').split('/')[0], ours: !!our, ad: isAd, url: our?.u || '' });
  });
  const org = rows.filter((r) => !r.ad);
  const oi = org.findIndex((r) => r.ours);
  const me = oi >= 0 ? org[oi] : null;
  const kind = me ? (/blog\.naver/.test(me.url) ? '블로그' : /cafe\.naver/.test(me.url) ? '카페' : '사이트') : '';
  return { q, rank: oi >= 0 ? oi + 1 : 0, total: org.length, kind, ahead: org.slice(0, Math.max(0, Math.min(oi, 3))).map((r) => r.dom).join(','), url: me?.url || '' };
}

const qs = process.argv.slice(2).length ? process.argv.slice(2) : QUERIES;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'date\tquery\trank\torganic_total\tkind\tahead\turl\n');
for (const q of qs) {
  try {
    const r = await rankOf(q);
    fs.appendFileSync(LOG, [date, r.q, r.rank || '-', r.total, r.kind, r.ahead, r.url].join('\t') + '\n');
    console.log(`${r.q.padEnd(12)} | ${r.rank ? `${r.rank}위/${r.total} (${r.kind})` : `🔴 없음/${r.total}`}${r.ahead ? ' | 앞: ' + r.ahead : ''}`);
  } catch (e) { console.log(`${q.padEnd(12)} | ⚠ ${e.message}`); }
  await sleep(2200);
}

// 🌉 ig_feed 스윕(jsonl) → 캡션 수확 형식(_feed_sweep.json) 변환기 (2026-09-29 신설)
//
// 왜 필요한가 (규칙 0-C 가 22일째 안 지켜진 진짜 원인)
//   · 캡션을 붙이는 도구(caption_attach.mjs · gen_insert_gonggu.mjs)는 **`{h, p:[{d,t}]}`** 형식만 읽는다.
//     읽는 자리는 `scratchpad/_feed_final.json` 과 `Downloads/mc_feed*.json` 두 곳뿐이고
//     이 파일들은 **2026-08-30 이후로 새로 생기지 않았다.**
//   · 그런데 실제 수확은 멈춘 적이 없다 — `ig_feed_sweep.mjs`(30분 예약작업)가
//     `scratchpad/ig_feed/<날짜>.jsonl` 에 **{code,u,t(게시일),cap}** 으로 5만 건을 쌓아 왔다.
//   · 즉 캡션은 있었고 **형식이 달라서 못 읽고 있었다.** 그래서 채움률이 0% 였다.
//     (2026-09-29 실측: 오늘 등록 161건 중 캡션 0건 · 스윕 파일엔 895줄/일)
//
// 흐름:  scratchpad/ig_feed/*.jsonl  →  핸들별로 묶어  →  scratchpad/_feed_sweep.json
// 실행:  node tools/daily/feed_sweep_to_harvest.mjs [--days 60]
//        (caption_attach.mjs · gen_insert_gonggu.mjs 가 이 파일을 자동으로 읽는다)
// 주기:  등록 직전 · parsing_nightly 회차 ⑤ 앞
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/FAMILY/Desktop/MOMCALENDAR';
const DIR = path.join(ROOT, 'scratchpad', 'ig_feed');
const OUT = path.join(ROOT, 'scratchpad', '_feed_sweep.json');
const DAYS = Number((process.argv.find((a) => a.startsWith('--days=')) || '').split('=')[1] || process.env.DAYS || 90);

const cutoff = new Date(Date.now() + 9 * 3600e3 - DAYS * 864e5).toISOString().slice(0, 10);
const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= cutoff).sort();

const byHandle = new Map();
let posts = 0, skipped = 0;
for (const f of files) {
  for (const ln of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const h = String(o.u || '').toLowerCase();
    const cap = o.cap || '';
    // 게시일이 없으면 파일 이름의 날짜(수확일)를 쓴다 — 날짜창 판정에 쓰이므로 비우면 안 된다
    const d = /^\d{4}-\d{2}-\d{2}$/.test(o.t || '') ? o.t : f.slice(0, 10);
    if (!h || cap.length < 60) { skipped++; continue; }
    if (!byHandle.has(h)) byHandle.set(h, []);
    const list = byHandle.get(h);
    if (list.some((x) => x.d === d && x.t === cap)) continue;
    list.push({ d, t: cap }); posts++;
  }
}

const out = [...byHandle.entries()].map(([h, p]) => ({ h, p }));
fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
console.log(`스윕 파일 ${files.length}일치 → 셀러 ${out.length}명 · 게시물 ${posts}건 (짧은 캡션 제외 ${skipped}) → ${OUT}`);

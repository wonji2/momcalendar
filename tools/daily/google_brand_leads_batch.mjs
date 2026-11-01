// 🔍 구글 「"브랜드" 공구 site:instagram.com」 검색 배치 생성기 (2026-10-07) — 쓰는 법은 google_leads_merge.mjs 머리말. node tools/daily/google_brand_leads_batch.mjs 브랜드1 브랜드2 … > actions.json
// 구글 「"브랜드" 공구 site:instagram.com」(최근 1주) 검색 배치 — 브라우저 패널용 actions JSON 을 찍는다
const js = String.raw`const t=document.body.innerText; const A=new Set(),M=new Set(); for(const m of t.matchAll(/Instagram\s*·\s*([A-Za-z0-9._]{2,30})/g)) A.add(m[1].toLowerCase()); for(const m of t.matchAll(/@([A-Za-z0-9._]{3,30})/g)) M.add(m[1].toLowerCase().replace(/\.$/,'')); ({cap:/unusual traffic|captcha/i.test(t)||location.pathname.indexOf("/sorry")===0, a:[...A].join(' '), m:[...M].filter(x=>!A.has(x)).join(' ')})`;
const brands = process.argv.slice(2);
const acts = [];
for (const b of brands) {
  // 2026-10-08 (사장님 "10월공구 공구일정 공구예고 공구오픈 이런걸로도 쭉 훑어"): `q:낱말` = 브랜드 따옴표 없이 그 말로 그대로 검색(최근 1주), `qd:낱말` = 최근 24시간
  const raw = b.startsWith('qd:') ? [b.slice(3), 'd'] : b.startsWith('q:') ? [b.slice(2), 'w'] : null;
  const query = raw ? raw[0] + ' site:instagram.com' : '"' + b + '" 공구 site:instagram.com';
  acts.push({ name: 'navigate', input: { url: 'https://www.google.com/search?q=' + encodeURIComponent(query) + '&tbs=qdr%3A' + (raw ? raw[1] : 'w') + '&hl=ko' } });
  acts.push({ name: 'javascript_tool', input: { action: 'javascript_exec', text: js } });
  acts.push({ name: 'computer', input: { action: 'wait', duration: 3 } });
}
acts.pop();
process.stdout.write(JSON.stringify(acts));

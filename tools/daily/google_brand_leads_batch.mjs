// 🔍 구글 「"브랜드" 공구 site:instagram.com」 검색 배치 생성기 (2026-10-07) — 쓰는 법은 google_leads_merge.mjs 머리말. node tools/daily/google_brand_leads_batch.mjs 브랜드1 브랜드2 … > actions.json
// 구글 「"브랜드" 공구 site:instagram.com」(최근 1주) 검색 배치 — 브라우저 패널용 actions JSON 을 찍는다
const js = String.raw`const t=document.body.innerText; const A=new Set(),M=new Set(); for(const m of t.matchAll(/Instagram\s*·\s*([A-Za-z0-9._]{2,30})/g)) A.add(m[1].toLowerCase()); for(const m of t.matchAll(/@([A-Za-z0-9._]{3,30})/g)) M.add(m[1].toLowerCase().replace(/\.$/,'')); ({cap:/unusual traffic|captcha/i.test(t), a:[...A].join(' '), m:[...M].filter(x=>!A.has(x)).join(' ')})`;
const brands = process.argv.slice(2);
const acts = [];
for (const b of brands) {
  acts.push({ name: 'navigate', input: { url: 'https://www.google.com/search?q=' + encodeURIComponent('"' + b + '" 공구 site:instagram.com') + '&tbs=qdr%3Aw&hl=ko' } });
  acts.push({ name: 'javascript_tool', input: { action: 'javascript_exec', text: js } });
  acts.push({ name: 'computer', input: { action: 'wait', duration: 3 } });
}
acts.pop();
process.stdout.write(JSON.stringify(acts));

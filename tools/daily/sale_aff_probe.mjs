// 세일 일정(sale_events) 브랜드가 링크프라이스 수익링크로 통과되는지 확인하고, 통과하면 aff_merchant 를 채운다
//   node tools/daily/sale_aff_probe.mjs           → 확인만
//   node tools/daily/sale_aff_probe.mjs --apply   → 통과한 머천트를 sale_events.aff_merchant 에 반영
// 흐름: 머천트 코드 후보 → click.linkprice.com/click.php?m=<코드>&a=A100706561&tu=<공식주소> 의 첫 응답 Location 이
//       view/error/error.php 면 막힘, 아니면 통과. (2026-10-13 실측: 무신사·지그재그·유니클로·SSF(에잇세컨즈)는 코드는 있으나 "승인되지 않은 링크" — 제휴 승인 대기)
// 상태파일 없음(상태는 DB). 제휴가 승인되면 이 도구를 한 번 돌리면 카드가 자동으로 수익링크가 된다(클라이언트 _saleUrl).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const APPLY = process.argv.includes('--apply');
const AFF = 'A100706561';
const CLI = process.env.SUPABASE_CLI || 'C:/Users/FAMILY/supabase-cli/supabase.exe';
// slug → [후보 머천트 코드들, 공식 주소]
const BRANDS = {
  oliveyoung: [['oliveyoung', 'cjoliveyoung'], 'https://www.oliveyoung.co.kr/'],
  musinsa: [['musinsa'], 'https://www.musinsa.com/'],
  ably: [['ably', 'a-bly'], 'https://a-bly.com/'],
  zara: [['zara'], 'https://www.zara.com/kr/'],
  zigzag: [['zigzag'], 'https://zigzag.kr/'],
  uniqlo: [['uniqlo'], 'https://www.uniqlo.com/kr/ko/'],
  topten: [['topten', 'topten10', 'goodwearmall'], 'https://topten10.goodwearmall.com/'],
  '8seconds': [['ssfshop', '8seconds'], 'https://www.ssfshop.com/8seconds/main'],
};
async function probe(m, tu) {
  const u = `https://click.linkprice.com/click.php?m=${encodeURIComponent(m)}&a=${AFF}&l=9999&l_cd1=3&l_cd2=0&tu=${encodeURIComponent(tu)}`;
  const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36' } });
  const loc = r.headers.get('location') || '';
  return { ok: r.status >= 300 && r.status < 400 && loc && !/view\/error\/error\.php/.test(loc), loc: loc.slice(0, 120) };
}
const pass = [];
for (const [slug, [codes, tu]] of Object.entries(BRANDS)) {
  let hit = '';
  for (const c of codes) {
    const p = await probe(c, tu);
    if (p.ok) { hit = c; break; }
  }
  console.log(hit ? '✅' : '⛔', slug.padEnd(11), hit || '(통과 머천트 없음 — 제휴 미승인이거나 코드 불명)');
  if (hit) pass.push([slug, hit]);
}
if (APPLY && pass.length) {
  const sql = pass.map(([s, c]) => `update public.sale_events set aff_merchant='${c.replace(/'/g, "''")}' where slug='${s.replace(/'/g, "''")}';`).join('\n') + '\nselect slug, aff_merchant from public.sale_events group by slug, aff_merchant;';
  fs.writeFileSync('scratchpad/_sale_aff.sql', sql);
  const out = execFileSync(CLI, ['db', 'query', '--linked', '--file', 'scratchpad/_sale_aff.sql', '--output-format', 'json'], { encoding: 'utf8', timeout: 90000 });
  console.log('반영', pass.length, '개', out.includes('"rows"') ? '' : out.slice(0, 200));
}

// 우리 카페(momcal) 본문이 로그인 프로필로 읽히는지 1건만 시험 (2026-10-05)
//   gongtok_body.mjs 와 같은 방식 — 복사한 프로필을 playwright 로 띄운다.
//   ⚠ 원본 browser-profile-cafe 는 절대 쓰지 않는다(발행기와 겹치면 세션이 날아간다 — 9/14 사고).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = path.join(ROOT, 'sns-automation', 'browser-profile-momcalread');
const ids = process.argv.slice(2).filter((x) => /^\d+$/.test(x));
if (!ids.length) { console.log('글번호를 주세요'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: true, channel: 'chrome', args: ['--no-sandbox'],
});
try {
  for (const id of ids) {
    const p = await ctx.newPage();
    try {
      await p.goto(`https://cafe.naver.com/momcal/${id}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await p.waitForTimeout(2200);
      let got = null;
      for (const f of p.frames()) {
        if (!/ca-fe\/cafes/.test(f.url())) continue;
        got = await f.evaluate(() => {
          const box = document.querySelector('.ArticleContentBox');
          if (!box) return null;
          return {
            title: document.querySelector('.title_text')?.innerText || '',
            writer: document.querySelector('.nick_btn, .nickname')?.innerText || '',
            text: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
            links: [...box.querySelectorAll('a')].map((a) => a.href)
              .filter((h) => !/cafe\.naver\.com|naver\.com\/ca-fe/.test(h)).slice(0, 12),
          };
        }).catch(() => null);
        if (got) break;
      }
      if (!got) { console.log(`🔴 ${id} 본문 칸을 못 찾음 (로그인이 안 됐거나 글이 없다)`); continue; }
      const blob = got.text + ' ' + got.links.join(' ');
      const handle = (blob.match(/instagram\.com\/([A-Za-z0-9._]{3,30})/) || [])[1] || '';
      const slug = (blob.match(/(?:link\.inpock\.co\.kr|inpk\.link)\/([A-Za-z0-9._-]{2,40})/) || [])[1] || '';
      console.log(`✅ ${id} 「${got.title.slice(0, 40)}」 작성자:${got.writer}`);
      console.log(`   인스타핸들: ${handle || '(없음)'} · 인포크슬러그: ${slug || '(없음)'}`);
      console.log(`   본문앞: ${got.text.slice(0, 150)}`);
      console.log(`   링크: ${got.links.slice(0, 4).join(' | ') || '(없음)'}`);
    } finally { await p.close().catch(() => {}); }
  }
} finally { await ctx.close().catch(() => {}); }

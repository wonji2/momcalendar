/**
 * 🖼 핫딜 썸네일 전수조사 (사장님 지시 2026-09-02 "사진 나오고 제대로 작동하는지 전수조사해봐")
 *
 * 챗봇이 "공구는 없지만 핫딜이 떴어요"(basicCard) 로 내보낼 수 있는 **노출 중 핫딜 전건**의
 * 사진을 실제로 받아보고, 카카오가 읽을 수 있는 형태인지 확인한다.
 *   · 챗봇과 **같은 변환 규칙**(thumbOf)을 적용해서 본다 — 코드와 검사가 어긋나면 의미가 없다
 *   · HEAD 로 실제 status·content-type 을 받는다 (URL 이 있다고 사진이 뜨는 게 아니다)
 *
 * 실행  node tools/daily/hd_thumb_audit.mjs
 */
const SB = 'https://hycaqsqeogjtbscmzrtm.supabase.co';
const KEY = 'sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE';
const FALLBACK = 'https://momcalendar.com/momcal-appicon.png';

// ⚠ kakao-skill 의 thumbOf 와 **같은 규칙**이어야 한다. 저기를 고치면 여기도 고칠 것.
const thumbOf = (u) => {
  let s = String(u || "").trim();
  if (!s) return FALLBACK;
  if (s.startsWith("http://")) s = "https://" + s.slice(7);
  if (!s.startsWith("https://")) return FALLBACK;
  return s;
};

const nowIso = new Date().toISOString();
const rows = await fetch(
  `${SB}/rest/v1/hotdeals?select=id,title,mall,img_url,link&or=(expires_at.is.null,expires_at.gt.${nowIso})&order=id.desc`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).then((r) => r.json());

console.log(`노출 중 핫딜 ${rows.length}건 — 챗봇이 보낼 사진을 전부 받아봅니다\n`);

const bad = [], fallback = [], byType = {};
let done = 0;
const CHUNK = 12;
for (let i = 0; i < rows.length; i += CHUNK) {
  await Promise.all(rows.slice(i, i + CHUNK).map(async (d) => {
    const url = thumbOf(d.img_url);
    if (url === FALLBACK) fallback.push(d);
    try {
      const r = await fetch(url, { method: 'HEAD' });
      const ct = r.headers.get('content-type') || '';
      byType[ct] = (byType[ct] || 0) + 1;
      // 형식은 참고만 — 카카오가 webp 를 실제로 거부하는지는 확인된 바 없다. 200 이면 사진은 있는 것이다.
      const okType = ct.startsWith('image/');
      if (!r.ok || !okType) bad.push({ id: d.id, mall: d.mall, title: String(d.title).slice(0, 28), status: r.status, ct, url: url.slice(0, 70) });
    } catch (e) {
      bad.push({ id: d.id, mall: d.mall, title: String(d.title).slice(0, 28), status: 'ERR', ct: String(e.message).slice(0, 30), url: url.slice(0, 70) });
    }
    done++;
  }));
  process.stdout.write(`\r  ${done}/${rows.length}`);
}
console.log('\n');

console.log('■ 실제 받아온 형식');
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}건  ${k}`);

console.log(`\n■ 상품 사진 대신 앱아이콘이 나가는 것: ${fallback.length}건`);
fallback.slice(0, 8).forEach((d) => console.log(`   id ${d.id} ${d.mall || ''} ${String(d.title).slice(0, 30)} — img_url: ${d.img_url || '(비어 있음)'}`));

console.log(`\n■ 🔴 카카오가 못 읽을 사진: ${bad.length}건`);
bad.slice(0, 15).forEach((b) => console.log(`   id ${b.id} [${b.mall}] ${b.title} → ${b.status} ${b.ct}\n      ${b.url}`));

console.log(`\n요약 — 전체 ${rows.length} · 정상 ${rows.length - bad.length} · 🔴문제 ${bad.length} · 앱아이콘 대체 ${fallback.length}`);

// 도우인·샤오홍슈 공유문구 → 원본 영상/이미지 주소 뽑기 (네트워크 없이 테스트할 수 있게 파싱만 따로 둔다)
//
// 공유 버튼을 누르면 이런 문구가 복사된다. URL 만 골라낸다.
//   도우인   "7.43 复制打开抖音，看看【xx的作品】… https://v.douyin.com/iABCdef/ Kjc:/ 08/12"
//   샤오홍슈 "【xx】… http://xhslink.com/a/AbCdEf，复制本条信息，打开【小红书】App查看精彩内容！"

export const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export function pickUrl(text) {
  const m = String(text).match(/https?:\/\/[^\s，。！!【】<>"'）)]+/);
  return m ? m[0].replace(/[,.;]+$/, '') : null;
}

export function platformOf(url) {
  const h = new URL(url).hostname;
  if (/(^|\.)(douyin|iesdouyin)\.com$/.test(h)) return 'douyin';
  if (/(^|\.)(xiaohongshu\.com|xhslink\.com)$/.test(h)) return 'xhs';
  return null;
}

// https://www.douyin.com/video/7412345678901234567 · /note/… · ?modal_id=… · iesdouyin.com/share/video/…/
export function douyinIdOf(url) {
  const u = new URL(url);
  const m = u.pathname.match(/\/(?:video|note|slides)\/(\d{8,})/);
  if (m) return m[1];
  return u.searchParams.get('modal_id') || u.searchParams.get('aweme_id') || null;
}

// https://www.xiaohongshu.com/explore/66a1b2c3… · /discovery/item/… · /user/profile/<uid>/<noteId>
export function xhsIdOf(url) {
  const m = new URL(url).pathname.match(/\/(?:explore|discovery\/item|user\/profile\/[0-9a-f]+)\/([0-9a-f]{24})/);
  return m ? m[1] : null;
}

// <script>window._ROUTER_DATA = {...}</script> 처럼 HTML 안에 박힌 JSON 덩어리를 꺼낸다.
// 샤오홍슈는 JSON 이 아니라 JS 객체라 undefined 가 섞여 있다 → null 로 바꾼다.
export function embeddedJson(html, varName) {
  const i = html.indexOf(varName);
  if (i < 0) return null;
  const eq = html.indexOf('=', i + varName.length);
  const end = html.indexOf('</script>', eq);
  if (eq < 0 || end < 0) return null;
  const raw = html.slice(eq + 1, end).trim().replace(/;$/, '').replace(/:\s*undefined\b/g, ':null');
  try { return JSON.parse(raw); } catch { return null; }
}

// iesdouyin.com/share/video/<id>/ 페이지 → 정보
export function parseDouyinPage(html) {
  const data = embeddedJson(html, 'window._ROUTER_DATA');
  const loader = data?.loaderData || {};
  const page = Object.entries(loader).find(([k, v]) => /^(video|note)_/.test(k) && v?.videoInfoRes)?.[1];
  const item = page?.videoInfoRes?.item_list?.[0];
  if (!item) throw new Error('도우인 페이지에서 작품 정보를 못 찾았습니다 (구조 변경 또는 차단)');

  const images = (item.images || [])
    .map((im) => (im.url_list || []).find((u) => !/\.webp/.test(u)) || im.url_list?.[0])
    .filter(Boolean);
  // 재생주소의 playwm 이 워터마크 버전, play 가 원본이다
  const wm = item.video?.play_addr?.url_list?.[0] || '';
  const video = images.length ? null : wm.replace('/playwm/', '/play/') || null;

  return {
    platform: 'douyin',
    id: String(item.aweme_id),
    type: images.length ? 'images' : 'video',
    title: item.desc || '',
    desc: item.desc || '',
    author: item.author?.nickname || '',
    tags: (item.text_extra || []).map((t) => t.hashtag_name).filter(Boolean),
    video,
    images,
    cover: item.video?.cover?.url_list?.[0] || null,
  };
}

// 샤오홍슈 이미지 주소에서 !nd_dft_wlteh_webp_3 같은 꼬리(워터마크·리사이즈 지시)를 떼고 원본 CDN 주소로 바꾼다
export function xhsOriginalImage(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // /202410151234/<hash>/<token>!nd_… 또는 /spectrum/<token>!… 형태
    const startsWithDate = /^\d{12}$/.test(parts[0]);
    const token = (startsWithDate ? parts.slice(2) : parts).join('/').split('!')[0];
    return token ? `https://sns-img-bd.xhscdn.com/${token}` : url;
  } catch { return url; }
}

// xiaohongshu.com/explore/<id> 페이지 → 정보
export function parseXhsPage(html, noteId) {
  const st = embeddedJson(html, 'window.__INITIAL_STATE__');
  if (!st) throw new Error('샤오홍슈 페이지에서 데이터를 못 찾았습니다 (로그인 요구일 수 있음 → XHS_COOKIE 설정)');
  const map = st.note?.noteDetailMap || {};
  const note =
    map[noteId]?.note ||
    Object.values(map).find((v) => v?.note?.noteId)?.note ||
    st.noteData?.data?.noteData ||
    null;
  if (!note) throw new Error('샤오홍슈 노트 정보가 비어 있습니다 (삭제·비공개·로그인 필요)');

  const isVideo = note.type === 'video';
  let video = null;
  if (isVideo) {
    const key = note.video?.consumer?.originVideoKey;
    const streams = note.video?.media?.stream || {};
    const first = ['h264', 'h265', 'av1'].map((k) => streams[k]?.[0]).find(Boolean);
    video = key ? `https://sns-video-bd.xhscdn.com/${key}` : first?.masterUrl || first?.backupUrls?.[0] || null;
  }
  const images = isVideo ? [] : (note.imageList || []).map((im) => im.urlDefault || im.url).filter(Boolean);

  return {
    platform: 'xhs',
    id: note.noteId || noteId,
    type: isVideo ? 'video' : 'images',
    title: note.title || '',
    desc: note.desc || '',
    author: note.user?.nickname || note.user?.nickName || '',
    tags: (note.tagList || []).map((t) => t.name).filter(Boolean),
    video,
    // 원본 주소 먼저, 실패하면 받은 주소 그대로 (download.mjs 가 순서대로 시도)
    images: images.map((u) => [xhsOriginalImage(u), u]),
    cover: note.imageList?.[0]?.urlDefault || null,
  };
}

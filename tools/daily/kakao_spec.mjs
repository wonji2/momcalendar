/**
 * 📏 카카오 말풍선 규격 검사 (사장님 지시 2026-09-02 "규격검사도 감시넣어")
 *
 * 왜 필요한가
 *   우리 서버는 200 을 보내도 **카카오가 규격 위반이면 말풍선을 버린다.**
 *   손님에겐 무응답이고, 오류는 오픈빌더 '스킬 > 오류 내역' 에만 남아 우리가 모른다.
 *   실사고 2026-09-02 04:23 — basicCard 에 thumbnail 이 없어 "곧 미발송 처리" 경고를 받았다.
 *   ⚠ 봇테스트는 이 검사를 하지 않는다. 그래서 우리가 직접 본다.
 *
 * 규격 근거 (카카오 i 오픈빌더 응답 타입 문서 + 우리가 실제로 맞은 경고)
 *   · carousel 최대 5장 · carousel 안 listCard 항목 최대 4개 · 단일 listCard 항목 최대 5개
 *   · basicCard: thumbnail 필수 · textCard 400자 · 버튼 최대 3개 · 버튼 label 14자
 *   · 이미지·링크는 https · 이미지 형식은 jpg/png (webp 는 안 읽는다)
 *
 * 쓰는 법  import { checkSpec } from './kakao_spec.mjs';  checkSpec(outputs[0]) → ['위반내용', …]
 */

const MAX_CAROUSEL = 5;      // 캐러셀 장 수
const MAX_ITEM_IN_CAROUSEL = 4;  // 캐러셀 안 listCard 항목
const MAX_ITEM_SINGLE = 5;   // 단독 listCard 항목
const MAX_TEXTCARD = 400;
const MAX_BUTTONS = 3;
const MAX_LABEL = 14;

const isHttps = (u) => typeof u === 'string' && u.startsWith('https://');
const isOkImage = (u) => {
  if (!isHttps(u)) return false;
  const low = String(u).toLowerCase().split('?')[0];
  return low.endsWith('.jpg') || low.endsWith('.jpeg') || low.endsWith('.png');
};

function checkButtons(bs, where, out) {
  if (!Array.isArray(bs)) return;
  if (bs.length > MAX_BUTTONS) out.push(`${where} 버튼 ${bs.length}개 (최대 ${MAX_BUTTONS})`);
  for (const b of bs) {
    const label = String(b?.label ?? '');
    if (!label) out.push(`${where} 버튼 label 이 비었다`);
    else if ([...label].length > MAX_LABEL) out.push(`${where} 버튼 label ${[...label].length}자 "${label}" (최대 ${MAX_LABEL})`);
    if (b?.action === 'webLink' && !isHttps(b?.webLinkUrl)) out.push(`${where} 버튼 링크가 https 가 아니다`);
  }
}

function checkListCard(lc, where, maxItem, out) {
  if (!lc?.header?.title) out.push(`${where} header.title 이 없다`);
  const items = Array.isArray(lc?.items) ? lc.items : [];
  if (!items.length) out.push(`${where} 항목이 0개다`);
  if (items.length > maxItem) out.push(`${where} 항목 ${items.length}개 (최대 ${maxItem})`);
  items.forEach((it, i) => {
    if (!it?.title) out.push(`${where} ${i + 1}번 항목 title 이 없다`);
    if (it?.link?.web && !isHttps(it.link.web)) out.push(`${where} ${i + 1}번 항목 링크가 https 가 아니다`);
    if (it?.imageUrl && !isOkImage(it.imageUrl)) out.push(`${where} ${i + 1}번 항목 이미지가 jpg/png 가 아니다`);
  });
  checkButtons(lc?.buttons, where, out);
}

/** 응답 output 하나를 검사해 위반 목록을 돌려준다 (빈 배열 = 규격 통과) */
export function checkSpec(o) {
  const out = [];
  if (!o || typeof o !== 'object') return ['응답이 비었다'];
  const kind = Object.keys(o)[0];

  if (o.carousel) {
    const items = Array.isArray(o.carousel.items) ? o.carousel.items : [];
    if (!o.carousel.type) out.push('carousel.type 이 없다');
    if (items.length > MAX_CAROUSEL) out.push(`캐러셀 ${items.length}장 (최대 ${MAX_CAROUSEL})`);
    if (!items.length) out.push('캐러셀이 비었다');
    items.forEach((c, i) => {
      if (o.carousel.type === 'listCard') checkListCard(c, `캐러셀 ${i + 1}장`, MAX_ITEM_IN_CAROUSEL, out);
      else if (o.carousel.type === 'basicCard') {
        if (!isOkImage(c?.thumbnail?.imageUrl)) out.push(`캐러셀 ${i + 1}장 thumbnail 이 없거나 jpg/png 가 아니다`);
        checkButtons(c?.buttons, `캐러셀 ${i + 1}장`, out);
      }
    });
  } else if (o.listCard) {
    checkListCard(o.listCard, 'listCard', MAX_ITEM_SINGLE, out);
  } else if (o.basicCard) {
    // 🔴 2026-09-02 실제로 여기서 경고를 받았다 — thumbnail 이 없으면 말풍선이 미발송된다
    if (!o.basicCard.thumbnail?.imageUrl) out.push('basicCard 에 thumbnail 이 없다 (카카오가 말풍선을 버린다)');
    else if (!isOkImage(o.basicCard.thumbnail.imageUrl)) out.push('basicCard thumbnail 이 https jpg/png 가 아니다');
    if (!o.basicCard.title && !o.basicCard.description) out.push('basicCard 에 title·description 이 둘 다 없다');
    checkButtons(o.basicCard.buttons, 'basicCard', out);
  } else if (o.simpleText) {
    if (!o.simpleText.text) out.push('simpleText 가 비었다');
  } else if (o.textCard) {
    const t = String(o.textCard.text ?? '');
    if (!t) out.push('textCard 가 비었다');
    if ([...t].length > MAX_TEXTCARD) out.push(`textCard ${[...t].length}자 (최대 ${MAX_TEXTCARD})`);
    checkButtons(o.textCard.buttons, 'textCard', out);
  } else {
    out.push(`알 수 없는 응답 형태: ${kind}`);
  }
  return out;
}

export default checkSpec;

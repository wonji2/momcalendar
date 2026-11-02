# 🔥 [핫딜 2열 그리드 전면 개편] 마미톡식 큰 사진 & 뱃지 하단 이동

## 1. 사장님 최종 확정 지침 (2026-11-02)
- **사장님 말씀**: "핫딜카드를 마미톡 처럼 2열로 사진크게해서 라이브목업 만들어보자 글고 역대최저나 맘캘픽 저런 로고가 상품 사진 너무 가리는듯"
- **핵심 개편 사항**:
  1. **상단 가로 스크롤 카드 폐지**: 좁고 답답하던 3구좌 가로 슬라이더를 없애고, 핫딜 화면 전체를 **마미톡 스타일의 '2열 큰 사진 그리드'**로 통일한다.
  2. **사진 가림 100% 제거**: 사진 위에 얹히던 '역대최저', '맘캘PICK' 뱃지를 사진에서 완전히 떼어내고, **가격 아래(하단)에 단정한 마이크로 태그**로 배치한다.
  3. **데이터 정합성**: '역대최저'는 클로드 코드의 지적대로 `is_lowest === true`일 때만 붙인다.
  4. **웹 전용 수정 즉시 라이브 배포**: test.html에 대기 중이던 웹 전용 수정을 라이브(index.html)에 즉각 반영한다.

---

## 2. 작업 상세 (`index.html`, `test.html`)

### ① 핫딜 렌더러 교체 (2열 그리드 + 뱃지 하단 배치)
```javascript
// 🔥 [마미톡형 2열 핫딜 그리드 렌더러]
function renderHotdealsGrid(list) {
  var box = document.getElementById('hotdealGrid') || document.querySelector('.hotdeals-wrap');
  if (!box) return;

  var html = '<div class="hotdeal-grid">' + list.map(function(h) {
    var imgUrl = h.img_url ? (typeof mcApiSrc === 'function' ? mcApiSrc(h.img_url) : h.img_url) : '';
    
    // 🏷️ 스마트 뱃지 (사진 안 가리고 가격 아래로!)
    var badges = [];
    if (h.is_lowest) badges.push('<span class="b-tag b-red">역대최저</span>');
    else if (h.discount_rate && h.discount_rate >= 20) badges.push('<span class="b-tag b-red">가격급락</span>');
    else badges.push('<span class="b-tag b-purple">맘캘PICK</span>');
    
    if (h.mall) badges.push('<span class="b-tag b-gray">' + esc(h.mall) + '</span>');

    return '<div class="hd-card" onclick="hdGo(' + (+h.id || 0) + ')">' +
      '<div class="hd-photo-wrap">' +
        '<img class="hd-photo" src="' + esc(imgUrl) + '" alt="' + esc(h.title) + '" loading="lazy" referrerpolicy="no-referrer">' +
        '<div class="hd-wish">♡</div>' +
      '</div>' +
      '<div class="hd-info">' +
        '<div class="hd-meta"><span class="hd-mall-tag">' + esc(h.mall || '특가') + '</span><span>' + esc(h.major || '') + '</span></div>' +
        '<div class="hd-title-txt">' + esc(h.title) + '</div>' +
        '<div class="hd-price-row">' +
          (h.discount_rate ? '<span class="hd-discount">' + h.discount_rate + '%</span>' : '') +
          '<span class="hd-price-val">' + won(h.price) + '</span>' +
        '</div>' +
        '<div class="hd-badges-bottom">' + badges.join('') + '</div>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';

  box.innerHTML = html;
}
```

### ② CSS 규격 (마미톡 2열 그리드)
```css
/* 🔥 마미톡식 2열 핫딜 그리드 규격 */
.hotdeal-grid {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 14px 11px !important;
  padding: 0 16px 24px !important;
}

.hd-card {
  background: #fff !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  cursor: pointer !important;
  display: flex !important;
  flex-direction: column !important;
}

/* 1:1 정사각 큰 사진 (사진 위 뱃지 없음) */
.hd-photo-wrap {
  width: 100% !important;
  aspect-ratio: 1 / 1 !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  position: relative !important;
  background: #F8F9FA !important;
  border: 1px solid #F0F0F3 !important;
}
.hd-photo {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
  display: block !important;
}

.hd-wish {
  position: absolute !important;
  right: 8px !important;
  bottom: 8px !important;
  width: 26px !important;
  height: 26px !important;
  background: rgba(0,0,0,0.22) !important;
  backdrop-filter: blur(2px) !important;
  border-radius: 50% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  color: #ffffff !important;
  font-size: 13px !important;
}

.hd-info {
  padding: 8px 2px 2px !important;
}

.hd-meta {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  font-size: 11px !important;
  color: #8B95A1 !important;
  font-weight: 500 !important;
  margin-bottom: 3px !important;
}
.hd-mall-tag {
  background: #F2F4F6 !important;
  color: #4E5968 !important;
  padding: 1px 5px !important;
  border-radius: 3px !important;
  font-weight: 600 !important;
  font-size: 10.5px !important;
}

.hd-title-txt {
  font-size: 13px !important;
  font-weight: 500 !important;
  color: #191F28 !important;
  line-height: 1.35 !important;
  display: -webkit-box !important;
  -webkit-line-clamp: 2 !important;
  -webkit-box-orient: vertical !important;
  overflow: hidden !important;
  min-height: 35px !important;
}

.hd-price-row {
  display: flex !important;
  align-items: baseline !important;
  gap: 5px !important;
  margin-top: 5px !important;
}
.hd-discount {
  font-size: 15px !important;
  font-weight: 800 !important;
  color: #FF4742 !important;
}
.hd-price-val {
  font-size: 15px !important;
  font-weight: 800 !important;
  color: #191F28 !important;
}

/* 🏷️ 하단 뱃지 */
.hd-badges-bottom {
  display: flex !important;
  gap: 4px !important;
  margin-top: 6px !important;
  flex-wrap: wrap !important;
}
.b-tag {
  font-size: 10px !important;
  font-weight: 700 !important;
  padding: 2px 5px !important;
  border-radius: 3px !important;
}
.b-red { background: #FFF0EE !important; color: #FF4742 !important; }
.b-purple { background: #F3EEFA !important; color: #7C54C4 !important; }
.b-gray { background: #F2F4F6 !important; color: #6B7684 !important; }
```

---

## 3. 검증 및 배포
1. 핫딜 목록이 마미톡처럼 2열 큰 사진 그리드로 노출되는지 확인.
2. 사진 위에 얹히던 거슬리는 로고가 사라지고 사진이 시원하게 보이는지 확인.
3. 웹 전용 수정 라이브 반영 확인.
4. 검증 완료 후 `index.html` 즉각 배포.

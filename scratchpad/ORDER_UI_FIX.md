# [긴급 디자인/UI 전수 교정 오더: 사장님 실기 캡처 4대 결함 척결]

## 사장님 실기 제보 4대 핵심 결함
1. **갤럭시 앱 아이콘 과도한 확대 (1번 사진)**:
   - 원인: 안드로이드 적응형 아이콘(Adaptive Icon) 규격 미준수. 안드로이드/One UI는 108dp 캔버스 중 중심 66~72%만 Safe Zone으로 남기고 외곽 18~20%를 잘라냄. 현재 `momcal-appicon-maskable.png`는 그래픽이 캔버스 전체에 꽉 차 있어 중심부만 돋보기로 비추듯 거대하게 확대되어 보임.
   - 작업: `momcal-appicon-maskable.png` 캔버스(512×512) 내 그래픽 비율을 약 62%로 축소하고 주변에 배경색(#F6F3FA 또는 흰색/연보라) 여백 패딩을 주어, 갤럭시 홈 화면에서 토스·당근처럼 알맞은 크기와 여백으로 노출되도록 에셋 교체.

2. **어색한 텍스트 2줄 쪼개짐 즉시 박멸 (2번, 3번 사진)**:
   - 토스트: `💜 {nickname}님, 반가워요!` 생성부(`index.html:4976, 5232` 등) 스타일 및 공통 토스트에 `white-space: nowrap !important; max-width: 90% !important; pointer-events: none;` 반드시 부여. "요!"가 2줄로 떨어지는 현상 원천 차단.
   - 4대 탭: `.content-seg .cseg`에 `white-space: nowrap !important; font-size: 12px !important; letter-spacing: -0.04em !important; padding: 8px 1px !important;` 강제 부여. 360px 좁은 모바일 화면에서도 `🛍 세일/라방`이 절대 2줄로 꺾이지 않고 1줄 고정되도록 수정.

3. **앱 글자 크기 팽창 척결 — 웹과 100% 일체화 (4번, 5번 사진)**:
   - 원인: 모바일 웹뷰에서 `-webkit-text-size-adjust: 100%`가 누락되어 갤럭시 시스템 디스플레이 폰트 배율(110~115%)이 웹뷰 텍스트에 강제 적용됨.
   - 작업: 최상단 및 맨 하단 오버라이드 CSS에 아래 속성 필수 적용:
     ```css
     html, body {
       -webkit-text-size-adjust: 100% !important;
       text-size-adjust: 100% !important;
     }
     ```
   - `.card-name`, `.hc-tit`, 서브 텍스트 등의 여백과 크기를 웹 브라우저 1:1 렌더링 규격과 정확히 일치시킬 것.

4. **기존 PWA 손님 카톡 로그인 시 찜 연동**:
   - 현재 `syncWishFromServer` 및 `rpc/wish_list`에 `p_device`(기기ID)와 `p_token`(회원토큰)이 모두 전달되어 기존 기기 찜(`mc_wish`)이 로그인 계정으로 100% 안전하게 병합 동기화됨을 코드 검증 완료. (사장님 캡처 3번에서도 `내 찜 30` 정상 유지 확인).
   - 로그인 직후 로컬 찜이 유실되지 않고 계정과 온전히 결합하는지 회귀 테스트 완료할 것.

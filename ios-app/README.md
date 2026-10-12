# 맘캘린더 아이폰 앱 (Capacitor)

momcalendar.com 을 감싸는 iOS 앱. **웹을 그대로 쓰되 푸시 알림만 네이티브**로 붙인다.

## 왜 이 구조인가
- 사이트를 고치면 **앱에도 바로 반영**된다(심사 불필요). 앱 껍데기를 건드릴 때만 심사.
- 애플 심사규정 4.2("웹사이트 감싸기만 한 앱")는 **네이티브 기능이 최소 하나** 있으면 통과 —
  우리는 **APNs 푸시**가 그 역할을 한다. (지금 웹푸시는 홈화면 추가한 사람에게만 가고 앱 지우면 끊긴다)

## 빌드는 맥에서만 된다 → 사람 손 없이 GitHub Actions macOS 러너로
사장님 PC 는 윈도우다. 이 폴더에는 **ios/ 네이티브 폴더를 만들지 않는다** —
`npx cap add ios` 는 CocoaPods 가 필요해 윈도우에서 실패한다.
대신 **CI(macOS 러너)가 매번 `cap add ios` 부터 새로 만든다**(.github/workflows/ios-build.yml).
→ 윈도우에서 절대 깨지지 않고, 결과가 항상 재현된다.

CI 가 매번 하는 일: `cap add ios` → `cap sync` → 아이콘·스플래시 생성(`resources/`) → Info.plist 보강(암호화 면제·한국어·세로 고정)
→ AppDelegate 푸시 토큰 전달 확인 → APNs entitlement 연결 → (unsigned) 컴파일만 / (release) 서명·아카이브·TestFlight 업로드.

## 폴더
```
capacitor.config.json   앱 설정 (번들ID·앱이름·원격 URL·오프라인 화면·푸시·스플래시·상태바)
package.json            capacitor 의존성 (⚠ 전역 .gitignore 가 package.json 을 막는다 — 이 파일만 예외 처리돼 있다)
resources/icon-only.png 앱 아이콘 원본 1024×1024 (iOS 가 모서리를 깎는다 — 꽉 찬 정사각형)
resources/splash.png    스플래시 원본 2732×2732 (보라 #7B3FB5 배경 + 아이콘)
www/index.html          네트워크가 끊겼을 때만 보이는 대기 화면 (심사 때 이게 보이면 안 된다)
출시_체크리스트.md       사장님이 하실 것(계정·인증서·시크릿) · 스토어 문구 · 올리는 순서 · 심사 대비
../.github/workflows/ios-build.yml   맥 러너 빌드
```

## 사이트 쪽 (test.html → 승인 후 index.html)
- `nativeBoot()`: 앱 안이면 `body.native-app` 을 붙이고(홈화면 추가 안내 숨김) 푸시 리스너를 건다.
- `enablePushNative()`: 알림 받기 → 권한 요청 → `registration` 으로 받은 APNs 토큰을 `save-ios-token` 에 저장.
- 알림을 눌러 앱이 열리면 `data.url`(항상 momcalendar.com 경유)로 이동.
- 앱 UA 에 `MomcalApp/1.0` 이 붙는다 → events 표에서 앱 방문을 구분할 수 있다. `_isInApp()`(인앱 웹뷰 판정)에는 걸리지 않는다.

## 사장님이 하셔야 하는 것 (이것만) → 자세한 건 `출시_체크리스트.md`
1. D-U-N-S 번호 조회/신청 — https://developer.apple.com/enroll/duns-lookup/
2. Apple Developer Program 등록 (사업자 · 연 $99)
3. 등록되면 팀 ID · 인증서 · APNs 키(.p8) · 프로파일 · API 키 → GitHub Secrets 7개 + Supabase 시크릿 (키 파일은 레포에 두지 않는다)

## 상태
- 2026-09-01 스캐폴드 생성. 앱 껍데기·CI·오프라인 화면까지. APNs 서버는 별도(supabase/functions/send-open-push-ios).
- 2026-10-12 출시 준비: 빠져 있던 package.json 복구, 아이콘·스플래시 자원, Capacitor 7 고정(macos-15 · Xcode 16), release 잡(서명 → 아카이브 → TestFlight 업로드) 완성, 심사용 Info.plist 키, 체크리스트·스토어 문구.

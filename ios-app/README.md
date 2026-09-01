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

## 폴더
```
capacitor.config.json   앱 설정 (번들ID·앱이름·원격 URL·푸시 옵션)
www/index.html          네트워크가 끊겼을 때만 보이는 대기 화면 (심사 때도 이게 보이면 안 된다)
package.json            capacitor 의존성
../.github/workflows/ios-build.yml   맥 러너 빌드
```

## 사장님이 하셔야 하는 것 (이것만)
1. D-U-N-S 번호 조회/신청 — https://developer.apple.com/enroll/duns-lookup/
2. Apple Developer Program 등록 (사업자 · 연 $99)
3. 등록되면 APNs 키(.p8) 발급 → 나에게 알려주기 (키 파일은 Supabase 시크릿에 넣는다, 레포에 두지 않는다)

## 상태
- 2026-09-01 스캐폴드 생성. 앱 껍데기·CI·오프라인 화면까지. APNs 서버는 별도(supabase/functions/send-open-push).

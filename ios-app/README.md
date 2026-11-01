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

## 사장님이 하셔야 하는 것 (이것만) — 2026-10-23 갱신 (D-U-N-S 는 나옴)
1. ✅ D-U-N-S 번호 — 나옴 (2026-10-23)
2. **Apple Developer Program 등록** — https://developer.apple.com/programs/enroll/ → 「조직(Organization)」으로, D-U-N-S·사업자 영문명·대표 전화. 결제 연 USD 99. 승인에 보통 1~3일(애플이 전화 확인할 수 있음).
3. 승인되면 **App Store Connect 에 앱 레코드** 하나 — https://appstoreconnect.apple.com → 나의 앱 → ＋ → 플랫폼 iOS · 이름 「맘캘린더」 · 번들 ID `com.wontsbe.momcalendar`(먼저 https://developer.apple.com/account/resources/identifiers 에서 App ID 등록, Push Notifications 체크) · SKU `momcalendar`.
4. **키 2개 발급** (둘 다 .p8 파일, 다운로드는 한 번만 되니 바로 저장):
   - App Store Connect API 키: App Store Connect → 사용자 및 액세스 → 통합(Integrations) → App Store Connect API → 팀 키 ＋ · 이름 `ci-build` · 역할 **Admin** → **Key ID · Issuer ID** 적어두고 .p8 다운로드. (CI 가 이 키로 서명·업로드)
   - APNs 키: https://developer.apple.com/account/resources/authkeys → ＋ · 이름 `momcal-apns` · **Apple Push Notifications service (APNs)** 체크 → **Key ID** 적어두고 .p8 다운로드. (서버가 이 키로 알림 발송)
   - **Team ID**: https://developer.apple.com/account → 멤버십 세부사항의 10자리.
5. 받은 것을 `C:/Users/FAMILY/work-backup/secrets/apple/` 폴더에 넣고 알려주기 (파일 2개 + Key ID 2개 + Issuer ID + Team ID). 채팅에 키 내용을 붙이지 않는다.
   → 내가 GitHub Secrets 4개(APPLE_TEAM_ID·APPLE_API_KEY_ID·APPLE_API_ISSUER_ID·APPLE_API_KEY_P8)와 Supabase 시크릿 3개(APNS_KEY_P8·APNS_KEY_ID·APNS_TEAM_ID)에 넣고, `Run workflow → release` 로 TestFlight 업로드, `send-open-push-ios` pg_cron 등록, 심사 제출(STORE_LISTING.md)까지 한다.

## 상태
- 2026-09-01 스캐폴드 생성. 앱 껍데기·CI·오프라인 화면까지. APNs 서버는 별도(supabase/functions/send-open-push).

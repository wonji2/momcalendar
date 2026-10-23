#!/usr/bin/env bash
# iOS 아카이브 → App Store Connect(TestFlight) 업로드 — macOS 러너 전용 (2026-10-23)
#
# 왜 이 길인가
#   · 자동 서명은 archive 때 「개발용」 프로파일을 쓰고, 그건 팀에 등록된 기기가 1대는 있어야 만들어진다(우리 0대 → run #50)
#   · 자동 서명에 Apple Distribution 을 억지로 넣으면 「conflicting provisioning settings」(run #51·#52)
#   → 수동 서명. 회차마다 App Store Connect API 로 **배포 인증서 + App Store 프로파일을 새로 만들고, 끝나면 지운다**.
#     저장해 두는 비밀은 GitHub Secrets 의 API 키 4개뿐(인증서 파일·p12 비밀번호 없음). 인증서 한도(3개)는 지워서 지킨다.
#
# 입력(환경변수): APPLE_TEAM_ID · APPLE_API_KEY_ID · APPLE_API_ISSUER_ID · APPLE_API_KEY_PATH(.p8) · BUILD(빌드 번호)
# 실행 위치: ios-app/ios/App (App.xcworkspace 가 있는 곳). 도우미: ios-app/ci/asc.py
set -euo pipefail
BUNDLE_ID=com.wontsbe.momcalendar
PROFILE_NAME="momcal ci appstore $BUILD"
ASC="$(cd "$(dirname "$0")" && pwd)/asc.py"
WORK="$PWD/build/sign"; mkdir -p "$WORK"
KC="$WORK/ci.keychain-db"; KCPW="$(uuidgen)"
CERT_ID=""; PROF_ID=""

cleanup() {
  set +e
  echo "── 정리: 이 회차 인증서·프로파일·키체인 삭제"
  [ -n "$PROF_ID" ] && python3 "$ASC" delete-profile "$PROF_ID"
  [ -n "$CERT_ID" ] && python3 "$ASC" delete-cert "$CERT_ID"
  security delete-keychain "$KC" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

python3 -m pip install -q pyjwt cryptography 2>/dev/null || python3 -m pip install -q --break-system-packages pyjwt cryptography

echo "── 1. 배포 인증서 발급(이 회차용)"
openssl genrsa -out "$WORK/dist.key" 2048 2>/dev/null
openssl req -new -key "$WORK/dist.key" -out "$WORK/dist.csr" -subj "/CN=momcal ci $BUILD"
CERT_ID=$(python3 "$ASC" create-cert "$WORK/dist.csr" "$WORK/dist.cer")
echo "   cert $CERT_ID"

echo "── 2. App Store 프로파일 발급"
BID=$(python3 "$ASC" bundle-id "$BUNDLE_ID")
PROF_ID=$(python3 "$ASC" create-profile "$BID" "$CERT_ID" "$PROFILE_NAME" "$WORK/appstore.mobileprovision")
UUID=$(security cms -D -i "$WORK/appstore.mobileprovision" | plutil -extract UUID raw -)
for d in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$d"; cp "$WORK/appstore.mobileprovision" "$d/$UUID.mobileprovision"
done
echo "   profile $PROF_ID ($UUID)"

echo "── 3. 임시 키체인에 키·인증서 넣기"
security create-keychain -p "$KCPW" "$KC"
security set-keychain-settings -lut 21600 "$KC"
security unlock-keychain -p "$KCPW" "$KC"
security list-keychains -d user -s "$KC" $(security list-keychains -d user | tr -d '"')
security import "$WORK/dist.key" -k "$KC" -T /usr/bin/codesign -T /usr/bin/security
security import "$WORK/dist.cer" -k "$KC" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KCPW" "$KC" >/dev/null
security find-identity -v -p codesigning "$KC" | grep -q "Apple Distribution" || { echo "🔴 키체인에 Apple Distribution 신원이 없다"; security find-identity -v -p codesigning "$KC"; exit 1; }

echo "── 4. 프로젝트 서명 설정 — App 타깃은 수동 서명, Pods 는 서명 안 함(앱에 심을 때 앱 신원으로 서명된다)"
python3 - "$APPLE_TEAM_ID" "$PROFILE_NAME" <<'PY'
import re, sys
team, prof = sys.argv[1], sys.argv[2]
p = 'App.xcodeproj/project.pbxproj'
s = open(p, encoding='utf-8').read()
anchor = 'PRODUCT_BUNDLE_IDENTIFIER = '
if anchor not in s:
    print('🔴 앵커(PRODUCT_BUNDLE_IDENTIFIER)를 못 찾음'); sys.exit(1)
s = re.sub(r'^\s*(CODE_SIGN_STYLE|CODE_SIGN_IDENTITY|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER|PROVISIONING_PROFILE)(\[sdk=[^\]]*\])? = [^;]*;\n', '', s, flags=re.M)
ins = ('CODE_SIGN_STYLE = Manual;\n\t\t\t\tCODE_SIGN_IDENTITY = "Apple Distribution";\n\t\t\t\t'
       'DEVELOPMENT_TEAM = %s;\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "%s";\n\t\t\t\t' % (team, prof))
s = s.replace(anchor, ins + anchor)
open(p, 'w', encoding='utf-8').write(s)
print('App 타깃: 수동 서명 %d 곳' % s.count('PROVISIONING_PROFILE_SPECIFIER'))
pp = 'Pods/Pods.xcodeproj/project.pbxproj'
t = open(pp, encoding='utf-8').read()
t = re.sub(r'^\s*(CODE_SIGNING_ALLOWED|CODE_SIGNING_REQUIRED|CODE_SIGN_IDENTITY|CODE_SIGN_STYLE|DEVELOPMENT_TEAM)(\[sdk=[^\]]*\])? = [^;]*;\n', '', t, flags=re.M)
n = t.count('buildSettings = {')
t = t.replace('buildSettings = {', 'buildSettings = {\n\t\t\t\tCODE_SIGNING_ALLOWED = NO;\n\t\t\t\tCODE_SIGNING_REQUIRED = NO;')
open(pp, 'w', encoding='utf-8').write(t)
print('Pods: 서명 끔 %d 곳' % n)
PY

echo "── 5. 아카이브"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD" App/Info.plist 2>/dev/null || true
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' -archivePath "$WORK/App.xcarchive" archive \
  CURRENT_PROJECT_VERSION="$BUILD" OTHER_CODE_SIGN_FLAGS="--keychain $KC" | tail -40
[ -d "$WORK/App.xcarchive" ] || { echo "🔴 아카이브 없음"; exit 1; }

echo "── 6. App Store Connect 업로드"
cat > "$WORK/ExportOptions.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>teamID</key><string>${APPLE_TEAM_ID}</string>
  <key>provisioningProfiles</key><dict><key>${BUNDLE_ID}</key><string>${PROFILE_NAME}</string></dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PL
xcodebuild -exportArchive -archivePath "$WORK/App.xcarchive" -exportOptionsPlist "$WORK/ExportOptions.plist" \
  -exportPath "$WORK/export" -authenticationKeyPath "$APPLE_API_KEY_PATH" \
  -authenticationKeyID "$APPLE_API_KEY_ID" -authenticationKeyIssuerID "$APPLE_API_ISSUER_ID" | tail -40
echo "✅ 업로드 요청 끝 — TestFlight 처리 5~15분 뒤 App Store Connect 빌드 목록에 뜬다 (빌드 번호 $BUILD)"

# cap add ios 로 새로 만든 AppDelegate.swift 에 푸시 토큰 전달 두 함수를 넣는다 (2026-10-26)
#   python3 ios-app/ci/add_push_appdelegate.py ios-app/ios/App/App/AppDelegate.swift
# 왜: @capacitor/push-notifications README 원문 —
#   "you must add the following to your AppDelegate.swift" (didRegisterForRemoteNotificationsWithDeviceToken →
#   NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken))
#   템플릿에는 이 두 함수가 없어서, 「알림 켜기」를 눌러도 토큰이 사이트로 안 왔다(2026-10-26 실측: push_on 1건 · push_ios 0행).
# 넣은 뒤 다시 읽어 확인하고, 없으면 exit 1 (빌드를 멈춘다).
import sys, re

p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "capacitorDidRegisterForRemoteNotifications" in s:
    print("이미 있음"); sys.exit(0)
add = '''
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
'''
i = s.rstrip().rfind("}")
if i < 0 or "class AppDelegate" not in s:
    print("🔴 AppDelegate 구조를 못 찾음"); sys.exit(1)
s = s[:i] + add + s[i:]
open(p, "w", encoding="utf-8").write(s)
t = open(p, encoding="utf-8").read()
ok = t.count("capacitorDidRegisterForRemoteNotifications") == 1 and t.count("capacitorDidFailToRegisterForRemoteNotifications") == 1
print("✅ AppDelegate 푸시 토큰 전달 넣음" if ok else "🔴 넣기 실패")
sys.exit(0 if ok else 1)

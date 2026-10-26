# cap add ios 로 만든 AppDelegate.swift 에 앱 강제 종료 기록을 넣는다 (2026-10-26 — 안드로이드 CrashReporter.java 와 같은 일)
#   python3 ios-app/ci/add_crash_reporter.py ios-app/ios/App/App/AppDelegate.swift
#   · 처리 안 된 예외(NSException)·치명 신호(SIGABRT·SIGSEGV·SIGBUS·SIGILL·SIGTRAP·SIGFPE)를 받으면 캐시 폴더 파일에 적는다
#   · 다음에 앱을 켤 때 그 파일이 있으면 우리 서버(events, event_type=app_crash)로 보내고 지운다 — 사이트와 같은 공개 손님 키
#   · 신호 처리기 안에서는 open/write 만 쓴다(그 안에서 문자열·메모리 할당은 위험) — 신호 번호만 적는다
# 넣은 뒤 다시 읽어 확인하고, 없으면 exit 1.
import sys

p = sys.argv[1]
s = open(p, encoding="utf-8").read()
if "mcInstallCrashCatcher" in s:
    print("이미 있음"); sys.exit(0)

top = '''
// ── 앱 강제 종료 기록(맘캘린더, 2026-10-26) ──
private let mcCrashPath: String = (NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true).first ?? NSTemporaryDirectory()) + "/mc_crash.txt"
private let mcCrashPathC: [CChar] = Array(mcCrashPath.utf8CString)

private func mcInstallCrashCatcher() {
    NSSetUncaughtExceptionHandler { e in
        let s = "\\(e.name.rawValue): \\(e.reason ?? "")\\n" + e.callStackSymbols.prefix(30).joined(separator: "\\n")
        try? s.write(toFile: mcCrashPath, atomically: false, encoding: .utf8)
    }
    for sig in [SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGTRAP, SIGFPE] {
        signal(sig) { n in
            mcCrashPathC.withUnsafeBufferPointer { p in
                let fd = open(p.baseAddress!, O_WRONLY | O_CREAT | O_TRUNC, 0o644)
                if fd >= 0 {
                    var b: [UInt8] = Array("signal ".utf8)
                    var v = Int(n); var d: [UInt8] = []
                    repeat { d.insert(UInt8(48 + v % 10), at: 0); v /= 10 } while v > 0
                    b += d
                    _ = b.withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) }
                    close(fd)
                }
            }
            signal(n, SIG_DFL); raise(n)
        }
    }
}

private func mcSendLastCrash() {
    guard let trace = try? String(contentsOfFile: mcCrashPath, encoding: .utf8), !trace.isEmpty else { return }
    let info = Bundle.main.infoDictionary
    let ver = "\\(info?["CFBundleShortVersionString"] ?? "?")(\\(info?["CFBundleVersion"] ?? "?"))"
    let dev = UIDevice.current
    let data: [String: Any] = ["plat": "ios", "ver": ver, "model": dev.model, "os": dev.systemVersion, "trace": String(trace.prefix(3000))]
    guard let dj = try? JSONSerialization.data(withJSONObject: data), let ds = String(data: dj, encoding: .utf8),
          let body = try? JSONSerialization.data(withJSONObject: ["event_type": "app_crash", "event_data": ds]),
          let url = URL(string: "https://hycaqsqeogjtbscmzrtm.supabase.co/rest/v1/events") else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    let key = "sb_publishable_u4hR4mdNTSss3kdjFH6R5Q_iuJ2MuGE"   // 사이트에 공개된 손님용 키
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(key, forHTTPHeaderField: "apikey")
    req.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
    req.httpBody = body
    URLSession.shared.dataTask(with: req) { _, resp, _ in
        if let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) { try? FileManager.default.removeItem(atPath: mcCrashPath) }
    }.resume()
}
'''
i = s.find("@UIApplicationMain")
if i < 0: i = s.find("@main")
if i < 0 or "class AppDelegate" not in s:
    print("🔴 AppDelegate 구조를 못 찾음"); sys.exit(1)
s = s[:i] + top.lstrip("\n") + "\n" + s[i:]

anchor = "didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {"
j = s.find(anchor)
if j < 0:
    print("🔴 didFinishLaunching 을 못 찾음"); sys.exit(1)
j += len(anchor)
s = s[:j] + "\n        mcInstallCrashCatcher()\n        mcSendLastCrash()" + s[j:]
open(p, "w", encoding="utf-8").write(s)
t = open(p, encoding="utf-8").read()
ok = t.count("mcInstallCrashCatcher()") == 2 and t.count("mcSendLastCrash()") == 2
print("✅ 강제 종료 기록 넣음" if ok else "🔴 넣기 실패")
sys.exit(0 if ok else 1)

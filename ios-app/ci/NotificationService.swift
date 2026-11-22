// 알림 확장(Notification Service Extension) — 서버가 보낸 알림에 사진을 붙인다 (사장님 2026-11-02, 핫딜 키워드 알림)
//   서버(send-open-push-ios?mode=kw)가 aps.mutable-content=1 과 최상위 image(https 주소)를 싣는다.
//   여기서 그 사진을 받아 알림에 붙인다. 못 받거나 형식이 안 맞으면(웹피·너무 늦음) 글만 그대로 보낸다 — 알림 자체는 절대 막지 않는다.
//   iOS 가 허용하는 형식: jpg·png·gif. 제한 시간 약 30초(넘으면 serviceExtensionTimeWillExpire).
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        best = request.content.mutableCopy() as? UNMutableNotificationContent
        guard let content = best,
              let s = request.content.userInfo["image"] as? String, !s.isEmpty,
              let url = URL(string: s), url.scheme == "https" else {
            contentHandler(request.content); return
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        URLSession(configuration: cfg).downloadTask(with: url) { loc, resp, _ in
            defer { contentHandler(content) }
            guard let loc = loc else { return }
            let mime = (resp?.mimeType ?? "").lowercased()
            let ext: String
            if mime.contains("jpeg") || mime.contains("jpg") { ext = "jpg" }
            else if mime.contains("png") { ext = "png" }
            else if mime.contains("gif") { ext = "gif" }
            else { return }   // webp 등은 iOS 알림이 못 그린다 → 글만
            let dst = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString + "." + ext)
            do { try FileManager.default.moveItem(at: loc, to: dst) } catch { return }
            if let att = try? UNNotificationAttachment(identifier: "img", url: dst, options: nil) { content.attachments = [att] }
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let h = contentHandler, let c = best { h(c) }
    }
}

import UserNotifications

/// Local notifications mirroring legacy's services/notifications.ts
/// (sendArrivalNotification / sendDisconnectNotification) — toggleable
/// independently of the Live Activity, which already covers the
/// "what's happening now" surface without needing a banner.
final class NotificationManager {
    static let shared = NotificationManager()

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func notifyArrival(locationName: String?) {
        send(title: "🏁 Destination atteinte", body: locationName.map { "Vous êtes arrivé à : \($0)" } ?? "Itinéraire terminé.")
    }

    func notifyDisconnect() {
        send(title: "⚠️ Connexion perdue", body: "La liaison avec le moteur GPS-Mock a été interrompue.")
    }

    private func send(title: String, body: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }
}

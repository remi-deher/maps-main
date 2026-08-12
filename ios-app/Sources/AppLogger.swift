import Foundation
import os
import Observation

struct AppLogEntry: Identifiable, Equatable {
    let id = UUID()
    let timestamp: Date
    let level: String // info | warn | error
    let message: String
}

// In-app, client-side log buffer — distinct from `LogEntryPayload` (the
// engine's own logs, fetched over the WebSocket via GET_LOGS/LOGS). Mirrors
// legacy's client-side console logging (routing/notifications/background
// services all logged locally), so diagnosing a connection/discovery/OSRM
// issue from the phone doesn't require a Mac + Console.app. Also forwards
// to os.Logger so entries still show up in Console.app/sysdiagnose when one
// is available.
@Observable
final class AppLogger {
    static let shared = AppLogger()

    private let osLog = Logger(subsystem: "com.remi2.gpsmock.companion", category: "app")
    private let maxEntries = 500

    private(set) var entries: [AppLogEntry] = []

    private init() {}

    func debug(_ message: String) { log("debug", message) }
    func console(_ message: String) { log("console", message) }
    func info(_ message: String) { log("info", message) }
    func warn(_ message: String) { log("warn", message) }
    func error(_ message: String) { log("error", message) }

    private func log(_ level: String, _ message: String) {
        switch level {
        case "error": osLog.error("\(message, privacy: .public)")
        case "warn": osLog.warning("\(message, privacy: .public)")
        case "debug", "console": osLog.debug("\(message, privacy: .public)")
        default: osLog.info("\(message, privacy: .public)")
        }
        let entry = AppLogEntry(timestamp: Date(), level: level, message: message)
        DispatchQueue.main.async {
            self.entries.append(entry)
            if self.entries.count > self.maxEntries {
                self.entries.removeFirst(self.entries.count - self.maxEntries)
            }
        }
    }
}

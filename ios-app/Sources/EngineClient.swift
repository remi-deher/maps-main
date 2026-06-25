import Foundation
import CoreLocation
import Observation

enum EngineConnectionState: String {
    case disconnected = "Déconnecté"
    case connecting = "Connexion..."
    case connected = "Connecté"
    case reconnecting = "Reconnexion..."
}

struct Favorite: Codable, Identifiable, Equatable {
    let lat: Double
    let lon: Double
    var name: String?
    var timestamp: Int64?
    var id: String { "\(lat),\(lon)" }
}

struct LocationStamp: Codable, Equatable {
    let lat: Double
    let lon: Double
    let name: String?
    let timestamp: Int64?
}

struct RealLocationStamp: Codable, Equatable {
    let lat: Double
    let lon: Double
    let drift: Double?
    let timestamp: Int64?
}

struct RoutePoint: Codable, Equatable {
    let lat: Double
    let lon: Double
}

/// One entry from the engine's in-memory log buffer (LOG/LOGS events) — lets
/// the app show what the engine is doing without terminal/SSH access, which
/// matters when piloting from the phone alone.
struct LogEntryPayload: Codable, Equatable {
    let timestamp: Int64
    let level: String // info | warn | error
    let source: String
    let category: String?
    let action: String?
    let message: String
    let fields: [String: String]?
}

struct PatrolBounds: Codable, Equatable {
    let northEast: RoutePoint
    let southWest: RoutePoint

    private enum CodingKeys: String, CodingKey {
        case northEast = "ne"
        case southWest = "sw"
    }
}

/// Mirrors engine/internal/domain.PatrolZone — a circle (center+radius) or
/// rectangle (bounds) the engine wanders the spoofed position around.
struct PatrolZone: Codable, Equatable {
    let type: String // "circle" | "rectangle"
    let center: RoutePoint?
    let radius: Double?
    let bounds: PatrolBounds?
    let active: Bool
}

struct DeviceInfo: Codable, Equatable {
    let udid: String
    let name: String
    let driver: String
}

struct EngineStatus: Codable, Equatable {
    let state: String?
    let favorites: [Favorite]?
    let lastInjectedLocation: LocationStamp?
    let lastRealLocation: RealLocationStamp?
    let currentSequencePreview: [RoutePoint]?
    let jitterEnabled: Bool?
    let patrolZone: PatrolZone?
    let usbDriver: String?
    let wifiDriver: String?
    let connectionType: String?
    let deviceInfo: DeviceInfo?
}

/// Talks the same {type, data} WebSocket envelope as the desktop app
/// (engine/internal/api/messages.go). Reports the device's real GPS position
/// as REAL_LOCATION so the engine's anti-drift shield can detect when the
/// spoofed position didn't "take" and re-inject it, and sends the same pilot
/// actions (SET_LOCATION, PLAY_ROUTE, ADD_FAVORITE...) the desktop app uses —
/// the engine is the single source of truth, so every connected client
/// (desktop, iOS, headless) sees the same STATUS broadcasts and stays in sync
/// for free.
@Observable
final class EngineClient: NSObject, URLSessionWebSocketDelegate {
    /// The live client, so App Intents (Siri / Shortcuts / Spotlight) can reach
    /// the active connection without a view. The app keeps one instance alive
    /// (ContentView @State), so this weak reference stays valid while running.
    static weak var shared: EngineClient?

    var state: EngineConnectionState = .disconnected
    var lastError: String?
    var status: EngineStatus?
    var logs: [LogEntryPayload] = []

    // Mirrors the engine's in-memory log ring buffer size
    // (engine/internal/engine/engine.go's log history cap) — keeping the same
    // bound means a GET_LOGS snapshot never gets truncated client-side before
    // the engine itself would have dropped the oldest entries.
    private let maxLogEntries = 200

    // Defaults to `.shared` so the property is never nil/force-unwrapped; init()
    // immediately replaces it with a delegate-bound session before any other
    // method can run.
    private var session: URLSession = .shared
    private var task: URLSessionWebSocketTask?
    var pingLatency: Double?
    private var lastPingSentAt: Date?
    private var pingTimer: Timer?
    private var urlString: String = ""

    /// Background keep-alive cadence, mirrored from the app's @AppStorage so
    /// the location-callback path (which runs while suspended, where SwiftUI
    /// state isn't readable) can throttle RELANCE without reaching back into
    /// the view. Kept in sync by ContentView's onChange/onAppear.
    var keepAliveEnabled = true
    var keepAliveInterval: Double = 5
    private var lastRelanceAt = Date.distantPast
    private var lastRealLocationAt = Date.distantPast
    /// Anti-drift report cadence — matches the foreground startReporting() loop
    /// (10s) so the continuous background location stream is collapsed back to
    /// the same rate instead of flooding the socket on every GPS tick.
    private let realLocationMinInterval: TimeInterval = 10

    // Generation counter: every connect() bumps it. Closures capture the
    // generation they belong to and bail out if it's stale, instead of
    // scheduling their own independent reconnect — the self-sustaining
    // reconnect loop the desktop app hit (see websocket.tsx) came from
    // exactly this kind of orphaned callback.
    private var generation = 0

    // Reconnect backoff: 2s, 4s, 8s, 16s, capped at 30s — reset to 0 on every
    // successful connection so a brief blip doesn't leave us backed off.
    // Without this the app hammered the engine every 2s indefinitely while
    // it was unreachable, wasting battery/network in the background.
    private var reconnectAttempt = 0
    private let reconnectBaseDelay: TimeInterval = 2
    private let reconnectMaxDelay: TimeInterval = 30

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        EngineClient.shared = self
    }

    func connect(to urlString: String) {
        self.urlString = urlString
        generation += 1
        reconnectAttempt = 0
        startSocket(generation: generation)
    }

    /// Reopens the socket if it has dropped while keeping the same target —
    /// called from the location callback on each background wake so a
    /// connection that died during suspension is rebuilt without waiting for a
    /// user action. A no-op while already connected/connecting or before any
    /// address has been set.
    func ensureConnected() {
        guard !urlString.isEmpty, state == .disconnected else { return }
        connect(to: urlString)
    }

    /// Re-asserts the last injected position, but no more than once per
    /// `keepAliveInterval` — the location callback can fire far more often
    /// than the keep-alive cadence (every `distanceFilter` metres of real
    /// movement), so this is where the cadence is actually enforced in the
    /// background, replacing the suspended `Task.sleep` loop.
    func relanceIfDue() {
        guard keepAliveEnabled, state == .connected else { return }
        let now = Date()
        guard now.timeIntervalSince(lastRelanceAt) >= keepAliveInterval else { return }
        lastRelanceAt = now
        relance()
    }

    func disconnect() {
        generation += 1 // invalidates any in-flight callbacks
        pingTimer?.invalidate()
        pingTimer = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        DispatchQueue.main.async {
            self.state = .disconnected
            self.pingLatency = nil
        }
    }

    private func startSocket(generation: Int) {
        guard let url = URL(string: urlString) else {
            DispatchQueue.main.async { self.lastError = "Adresse invalide: \(self.urlString)" }
            return
        }
        DispatchQueue.main.async { self.state = .connecting }

        let newTask = session.webSocketTask(with: url)
        task = newTask
        newTask.resume()
        receive(on: newTask, generation: generation)
    }

    private func receive(on task: URLSessionWebSocketTask, generation: Int) {
        task.receive { [weak self] result in
            guard let self, self.generation == generation else { return }
            switch result {
            case .failure(let error):
                self.handleDisconnect(error: error, generation: generation)
            case .success(let message):
                if case .string(let text) = message {
                    self.handleMessage(text)
                }
                self.receive(on: task, generation: generation)
            }
        }
    }

    private func handleDisconnect(error: Error, generation: Int) {
        AppLogger.shared.warn("Connexion moteur perdue: \(error.localizedDescription)")
        pingTimer?.invalidate()
        pingTimer = nil
        DispatchQueue.main.async {
            self.lastError = error.localizedDescription
            self.state = .reconnecting
            self.pingLatency = nil
        }
        let delay = min(reconnectBaseDelay * pow(2, Double(reconnectAttempt)), reconnectMaxDelay)
        reconnectAttempt += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, self.generation == generation else { return }
            self.startSocket(generation: generation)
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        AppLogger.shared.info("Connecté au moteur (\(self.urlString))")
        reconnectAttempt = 0
        DispatchQueue.main.async {
            self.state = .connected
            self.pingTimer?.invalidate()
            self.pingTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
                self?.sendPing()
            }
            self.sendPing()
        }
        sendEnvelope(type: "GET_STATUS", data: [:])
        sendEnvelope(type: "GET_LOGS", data: [:])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard self.task === task else { return }
        handleDisconnect(error: error ?? URLError(.networkConnectionLost), generation: generation)
    }

    private func handleMessage(_ text: String) {
        guard let raw = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let type = obj["type"] as? String else { return }

        // "data" can be a dict (most events) or an array (LOGS' snapshot) —
        // JSONSerialization.isValidJSONObject accepts both top-level shapes,
        // unlike forcing a [String: Any] cast which would silently drop arrays.
        let payloadData: Data
        if let raw = obj["data"], JSONSerialization.isValidJSONObject(raw),
           let encoded = try? JSONSerialization.data(withJSONObject: raw) {
            payloadData = encoded
        } else {
            payloadData = Data("{}".utf8)
        }

        switch type {
        case "STATUS", "STATUS_UPDATE":
            do {
                let decoded = try JSONDecoder().decode(EngineStatus.self, from: payloadData)
                DispatchQueue.main.async { self.status = decoded }
            } catch {
                AppLogger.shared.error("Échec du décodage de STATUS: \(error)")
            }
        case "PONG":
            // `lastPingSentAt` is written on the main queue (sendPing runs off
            // the Timer, scheduled on main); read it there too instead of from
            // this background receive-completion queue to avoid a data race.
            DispatchQueue.main.async {
                if let sentAt = self.lastPingSentAt {
                    self.pingLatency = Date().timeIntervalSince(sentAt) * 1000 // ms
                }
            }
        case "LOG":
            do {
                let entry = try JSONDecoder().decode(LogEntryPayload.self, from: payloadData)
                DispatchQueue.main.async {
                    self.logs.append(entry)
                    if self.logs.count > self.maxLogEntries {
                        self.logs.removeFirst(self.logs.count - self.maxLogEntries)
                    }
                }
            } catch {
                AppLogger.shared.error("Échec du décodage de LOG: \(error)")
            }
        case "LOGS":
            do {
                let entries = try JSONDecoder().decode([LogEntryPayload].self, from: payloadData)
                DispatchQueue.main.async { self.logs = entries }
            } catch {
                AppLogger.shared.error("Échec du décodage de LOGS: \(error)")
            }
        default:
            // Surface protocol drift (e.g. a new message type the desktop side
            // started sending) instead of silently dropping it — this is the
            // only place that would reveal a desktop/iOS protocol mismatch.
            AppLogger.shared.warn("Type de message inconnu ignoré: \(type)")
        }
    }

    // ─── Outbound actions (same vocabulary as tauri-app's websocket.tsx) ────

    func sendRealLocation(lat: Double, lon: Double) {
        sendEnvelope(type: "REAL_LOCATION", data: ["latitude": lat, "longitude": lon])
    }

    /// Throttled REAL_LOCATION for the high-frequency background location
    /// stream — coalesces the ~1 Hz callbacks down to `realLocationMinInterval`.
    func sendRealLocationIfDue(lat: Double, lon: Double) {
        guard state == .connected else { return }
        let now = Date()
        guard now.timeIntervalSince(lastRealLocationAt) >= realLocationMinInterval else { return }
        lastRealLocationAt = now
        sendRealLocation(lat: lat, lon: lon)
    }

    func setLocation(lat: Double, lon: Double, name: String = "Point iPhone") {
        sendEnvelope(type: "SET_LOCATION", data: ["lat": lat, "lon": lon, "name": name])
    }

    func playRoute(endLat: Double, endLon: Double, speed: Double, profile: String) {
        sendEnvelope(type: "PLAY_ROUTE", data: ["endLat": endLat, "endLon": endLon, "speed": speed, "profile": profile])
    }

    /// Plays back a GPX track's raw text content — the engine parses the
    /// `<trkpt>` tags itself (engine/internal/engine/simulation.go), so the
    /// app just forwards the file content it read, same as tauri-app.
    func playCustomGpx(gpxContent: String, speed: Double) {
        sendEnvelope(type: "PLAY_CUSTOM_GPX", data: ["gpxContent": gpxContent, "speed": speed])
    }

    func stopRoute() {
        sendEnvelope(type: "STOP_ROUTE", data: [:])
    }

    func pauseRoute() {
        sendEnvelope(type: "PAUSE_ROUTE", data: [:])
    }

    func resumeRoute() {
        sendEnvelope(type: "RESUME_ROUTE", data: [:])
    }

    func getLogs() {
        sendEnvelope(type: "GET_LOGS", data: [:])
    }

    func clearHistory() {
        sendEnvelope(type: "CLEAR_HISTORY", data: [:])
    }

    func relance() {
        sendEnvelope(type: "RELANCE", data: [:])
    }

    private func sendPing() {
        guard state == .connected else { return }
        lastPingSentAt = Date()
        sendEnvelope(type: "HEARTBEAT", data: [:])
    }

    func switchDriver(driverId: String, transport: String, wifiAddress: String = "") {
        var data: [String: Any] = ["driverId": driverId, "transport": transport]
        let trimmed = wifiAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        if transport == "wifi" && !trimmed.isEmpty {
            data["wifiAddress"] = trimmed
        }
        sendEnvelope(type: "SWITCH_DRIVER", data: data)
    }

    /// Starts, updates, or stops a patrol zone — same PATROL_UPDATE envelope
    /// as tauri-app's `updatePatrolZone` (engine/internal/api/messages.go's
    /// PatrolUpdatePayload). Sending `active: false` stops it; the engine
    /// requires `center`+`radius` for "circle" or `bounds` for "rectangle".
    func updatePatrolZone(
        type: String,
        center: CLLocationCoordinate2D?,
        radius: Double?,
        bounds: (southWest: CLLocationCoordinate2D, northEast: CLLocationCoordinate2D)?,
        active: Bool
    ) {
        var zone: [String: Any] = ["type": type, "active": active]
        if let center {
            zone["center"] = ["lat": center.latitude, "lon": center.longitude]
        }
        if let radius {
            zone["radius"] = radius
        }
        if let bounds {
            zone["bounds"] = [
                "sw": ["lat": bounds.southWest.latitude, "lon": bounds.southWest.longitude],
                "ne": ["lat": bounds.northEast.latitude, "lon": bounds.northEast.longitude]
            ]
        }
        sendEnvelope(type: "PATROL_UPDATE", data: ["zone": zone])
    }

    /// Pushes a partial settings update — same SAVE_SETTINGS envelope and
    /// merge-by-key semantics as tauri-app's `saveSettings` (only the
    /// provided keys are applied; see engine/internal/engine/engine.go's
    /// SaveSettings).
    func saveSettings(_ settings: [String: Any]) {
        sendEnvelope(type: "SAVE_SETTINGS", data: settings)
    }

    func addFavorite(lat: Double, lon: Double, name: String) {
        sendEnvelope(type: "ADD_FAVORITE", data: ["lat": lat, "lon": lon, "name": name])
    }

    func removeFavorite(lat: Double, lon: Double) {
        sendEnvelope(type: "REMOVE_FAVORITE", data: ["lat": lat, "lon": lon])
    }

    /// Plays a multi-stop itinerary. Mirrors tauri-app's sequence builder:
    /// each leg's `start` is the previous leg's `end` (or the first stop's own
    /// coordinate when there's nothing before it — the engine just needs a
    /// valid LatLon, the real starting point is wherever the device already
    /// is when the leg begins).
    func playSequence(legs: [[String: Any]], looping: Bool) {
        sendEnvelope(type: "PLAY_SEQUENCE", data: ["legs": legs, "looping": looping])
    }

    private func sendEnvelope(type: String, data: [String: Any]) {
        guard let task else {
            AppLogger.shared.warn("Action \(type) ignorée: non connecté au moteur")
            DispatchQueue.main.async { self.lastError = "Non connecté au moteur — action ignorée." }
            return
        }
        guard let payload = try? JSONSerialization.data(withJSONObject: ["type": type, "data": data]),
              let json = String(data: payload, encoding: .utf8) else { return }
        task.send(.string(json)) { [weak self] error in
            if let error {
                AppLogger.shared.error("Envoi \(type) échoué: \(error.localizedDescription)")
                DispatchQueue.main.async { self?.lastError = error.localizedDescription }
            }
        }
    }
}

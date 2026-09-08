import Foundation
import CoreLocation
import Observation

// Talks the same {type, data} WebSocket envelope as the desktop app
// (engine/internal/api/messages.go). Reports the device's real GPS position
// as REAL_LOCATION so the engine's anti-drift shield can detect when the
// spoofed position didn't "take" and re-inject it, and sends the same pilot
// actions (SET_LOCATION, PLAY_ROUTE, ADD_FAVORITE...) the desktop app uses —
// the engine is the single source of truth, so every connected client
// (desktop, iOS, headless) sees the same STATUS broadcasts and stays in sync
// for free.
//
// The whole class is @MainActor. Its state is read by SwiftUI views on every
// body evaluation and written from three different places — URLSession's
// delegate queue, the receive/send completion queues, and the CoreLocation
// callback — and the previous arrangement only protected *some* of it: the
// observable properties were hopped to main with DispatchQueue.main.async,
// while `generation`, `reconnectAttempt`, `endpoint`, `task` and the
// throttling timestamps were read and written straight from the completion
// queues. That is a data race the compiler could not see, on exactly the
// fields the reconnect logic depends on. Pinning everything to the main actor
// makes the invariant the code already assumed ("this state belongs to the
// UI thread") one the compiler enforces, and lets every DispatchQueue.main
// hop disappear.
@Observable
@MainActor
final class EngineClient: NSObject, URLSessionWebSocketDelegate, EngineClientProtocol {
    // The live client, so App Intents (Siri / Shortcuts / Spotlight) can reach
    // the active connection without a view. The app keeps one instance alive
    // (ContentView @State), so this weak reference stays valid while running.
    static weak var shared: EngineClient?

    var state: EngineConnectionState = .disconnected
    var lastError: String?
    var status: EngineStatus?
    var logs: [LogEntryPayload] = []
    var restartServicesResult: RestartServicesResultPayload?
    var restartTunnelResult: RestartTunnelResultPayload?
    var restartMdnsResult: RestartMdnsResultPayload?

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
    // Heartbeat loop. A Task rather than a Timer: a Timer needs a live run loop
    // and calls back outside any actor, so under main-actor isolation it would
    // have to hop on every tick; a Task created here inherits this actor and is
    // cancelled deterministically in disconnect().
    private var pingTask: Task<Void, Never>?
    private let pingInterval: TimeInterval = 5
    // The engine we are (re)connecting to, credential included. Empty URL means
    // "no target set yet", which ensureConnected/reconnect treat as a no-op.
    private var endpoint = EngineEndpoint(urlString: "", token: nil)

    // Background keep-alive cadence, mirrored from the app's @AppStorage so
    // the location-callback path (which runs while suspended, where SwiftUI
    // state isn't readable) can throttle RELANCE without reaching back into
    // the view. Kept in sync by ContentView's onChange/onAppear.
    var keepAliveEnabled = true
    var keepAliveInterval: Double = 5
    private var lastRelanceAt = Date.distantPast
    private var lastRealLocationAt = Date.distantPast
    // Anti-drift report cadence — matches the foreground startReporting() loop
    // (10s) so the continuous background location stream is collapsed back to
    // the same rate instead of flooding the socket on every GPS tick.
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
    private var reconnectTask: Task<Void, Never>?

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        EngineClient.shared = self
    }

    func connect(to endpoint: EngineEndpoint) {
        self.endpoint = endpoint
        generation += 1
        reconnectAttempt = 0
        startSocket(generation: generation)
    }

    // Reopens the socket if it has dropped while keeping the same target —
    // called from the location callback on each background wake so a
    // connection that died during suspension is rebuilt without waiting for a
    // user action. A no-op while already connected/connecting or before any
    // address has been set.
    func ensureConnected() {
        guard !endpoint.urlString.isEmpty, state == .disconnected else { return }
        connect(to: endpoint)
    }

    // Re-asserts the last injected position, but no more than once per
    // `keepAliveInterval` — the location callback can fire far more often
    // than the keep-alive cadence (every `distanceFilter` metres of real
    // movement), so this is where the cadence is actually enforced in the
    // background, replacing the suspended `Task.sleep` loop.
    func relanceIfDue() {
        guard keepAliveEnabled, state == .connected else { return }
        let now = Date()
        guard now.timeIntervalSince(lastRelanceAt) >= keepAliveInterval else { return }
        lastRelanceAt = now
        relance()
    }

    func disconnect() {
        generation += 1 // invalidates any in-flight callbacks
        stopPinging()
        reconnectTask?.cancel()
        reconnectTask = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        state = .disconnected
        pingLatency = nil
    }

    private func startSocket(generation: Int) {
        // The credential rides in an Authorization header on the handshake
        // request rather than in the URL — see EngineEndpoint.
        guard let request = endpoint.makeRequest() else {
            lastError = "Adresse invalide: \(endpoint.urlString)"
            return
        }
        state = .connecting

        let newTask = session.webSocketTask(with: request)
        task = newTask
        newTask.resume()
        receive(on: newTask, generation: generation)
    }

    // nonisolated because the completion handler URLSession invokes is not on
    // any actor. Only Sendable values (a String, a String description) cross
    // back into the actor — never the Message or the Error themselves, neither
    // of which is Sendable.
    private nonisolated func receive(on task: URLSessionWebSocketTask, generation: Int) {
        task.receive { [weak self] result in
            switch result {
            case .failure(let error):
                let description = error.localizedDescription
                Task { @MainActor in
                    self?.handleDisconnect(description: description, generation: generation)
                }
            case .success(let message):
                var text: String?
                if case .string(let received) = message { text = received }
                let payload = text
                Task { @MainActor in
                    guard let self, self.generation == generation else { return }
                    if let payload { self.handleMessage(payload) }
                    self.receive(on: task, generation: generation)
                }
            }
        }
    }

    private func handleDisconnect(description: String, generation: Int) {
        // A stale callback from a previous connection must not restart anything
        // — that is the orphaned-callback reconnect loop this counter exists to
        // prevent.
        guard generation == self.generation else { return }

        AppLogger.shared.warn("Connexion moteur perdue: \(description)")
        stopPinging()
        lastError = description
        state = .reconnecting
        pingLatency = nil

        let delay = min(reconnectBaseDelay * pow(2, Double(reconnectAttempt)), reconnectMaxDelay)
        reconnectAttempt += 1

        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self, self.generation == generation else { return }
            self.rebindToDiscoveredEngineIfStuck()
            self.startSocket(generation: generation)
        }
    }

    // Dynamic IP re-binding: after three failed attempts, prefer whatever
    // Bonjour has discovered — the engine's machine may simply have a new DHCP
    // lease. The endpoint is rebuilt through the same helper as the initial
    // connect so the new address gets its own stored token (and the /ws path —
    // hand-assembling "ws://host:port" here used to drop it, which made every
    // re-binding attempt fail).
    private func rebindToDiscoveredEngineIfStuck() {
        guard reconnectAttempt >= 3 else { return }
        guard case .found(let host, let port) = EngineDiscovery.shared?.state else { return }
        let address = "\(host):\(port)"
        let candidate = EnginePairing.webSocketEndpoint(
            address: address,
            token: EngineTokenStore.token(forAddress: address)
        )
        guard candidate != endpoint else { return }
        AppLogger.shared.info("Re-liaison dynamique de la cible WebSocket vers Bonjour: \(candidate.urlString)")
        endpoint = candidate
    }

    // URLSession delegate callbacks arrive on the session's own queue, so they
    // are nonisolated and hop onto the actor before touching any state.
    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        Task { @MainActor [weak self] in self?.handleSocketOpened() }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let description = (error ?? URLError(.networkConnectionLost)).localizedDescription
        Task { @MainActor [weak self] in
            guard let self, self.task === task else { return }
            self.handleDisconnect(description: description, generation: self.generation)
        }
    }

    private func handleSocketOpened() {
        AppLogger.shared.info("Connecté au moteur (\(endpoint.urlString))")
        reconnectAttempt = 0
        state = .connected
        startPinging()
        sendAction(.getStatus)
        sendAction(.getLogs)
    }

    private func startPinging() {
        stopPinging()
        sendPing()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let interval = self?.pingInterval else { return }
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { return }
                self?.sendPing()
            }
        }
    }

    private func stopPinging() {
        pingTask?.cancel()
        pingTask = nil
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

        guard let event = EngineEvent(rawValue: type) else {
            AppLogger.shared.warn("Type de message inconnu ignoré: \(type)")
            return
        }

        switch event {
        case .status, .statusUpdate:
            decode(EngineStatus.self, from: payloadData, label: "STATUS") { self.status = $0 }
        case .pong:
            if let sentAt = lastPingSentAt {
                pingLatency = Date().timeIntervalSince(sentAt) * 1000 // ms
            }
        case .log:
            decode(LogEntryPayload.self, from: payloadData, label: "LOG") { entry in
                self.logs.append(entry)
                if self.logs.count > self.maxLogEntries {
                    self.logs.removeFirst(self.logs.count - self.maxLogEntries)
                }
            }
        case .logs:
            decode([LogEntryPayload].self, from: payloadData, label: "LOGS") { self.logs = $0 }
        case .restartServicesResult:
            decode(RestartServicesResultPayload.self, from: payloadData, label: "RESTART_SERVICES_RESULT") {
                self.restartServicesResult = $0
            }
        case .restartTunnelResult:
            decode(RestartTunnelResultPayload.self, from: payloadData, label: "RESTART_TUNNEL_RESULT") {
                self.restartTunnelResult = $0
            }
        case .restartMdnsResult:
            decode(RestartMdnsResultPayload.self, from: payloadData, label: "RESTART_MDNS_RESULT") {
                self.restartMdnsResult = $0
            }
        }
    }

    // Decodes one payload and applies it, logging a decode failure under the
    // event's own name. Collapses seven identical do/catch blocks into one
    // place, so a new event type is one line rather than six.
    private func decode<T: Decodable>(
        _ type: T.Type,
        from data: Data,
        label: String,
        apply: (T) -> Void
    ) {
        do {
            apply(try JSONDecoder().decode(type, from: data))
        } catch {
            AppLogger.shared.error("Échec du décodage de \(label): \(error)")
        }
    }

    // ─── Outbound actions (same vocabulary as tauri-app's websocket.tsx) ────

    func sendRealLocation(lat: Double, lon: Double) {
        sendAction(.realLocation, data: ["latitude": lat, "longitude": lon])
    }

    // Throttled REAL_LOCATION for the high-frequency background location
    // stream — coalesces the ~1 Hz callbacks down to `realLocationMinInterval`.
    func sendRealLocationIfDue(lat: Double, lon: Double) {
        guard state == .connected else { return }
        let now = Date()
        guard now.timeIntervalSince(lastRealLocationAt) >= realLocationMinInterval else { return }
        lastRealLocationAt = now
        sendRealLocation(lat: lat, lon: lon)
    }

    func setLocation(lat: Double, lon: Double, name: String = "Point iPhone") {
        sendAction(.setLocation, data: ["lat": lat, "lon": lon, "name": name])
    }

    func playRoute(endLat: Double, endLon: Double, speed: Double, profile: String) {
        sendAction(.playRoute, data: ["endLat": endLat, "endLon": endLon, "speed": speed, "profile": profile])
    }

    // Plays back a GPX track's raw text content — the engine parses the
    // `<trkpt>` tags itself (engine/internal/engine/simulation.go), so the
    // app just forwards the file content it read, same as tauri-app.
    func playCustomGpx(gpxContent: String, speed: Double) {
        sendAction(.playCustomGpx, data: ["gpxContent": gpxContent, "speed": speed])
    }

    func stopRoute() {
        sendAction(.stopRoute)
    }

    func pauseRoute() {
        sendAction(.pauseRoute)
    }

    func resumeRoute() {
        sendAction(.resumeRoute)
    }

    func getLogs() {
        sendAction(.getLogs)
    }

    func clearHistory() {
        sendAction(.clearHistory)
    }

    func relance() {
        sendAction(.relance)
    }

    // Kills orphaned pymobiledevice3 processes, restarts the OS Bonjour/mDNS
    // service, and re-establishes the tunnel — the manual "unstick
    // everything" action for the connectivity failures that otherwise
    // require console access to the machine running the engine (see
    // engine/internal/engine/engine_maintenance.go). Result arrives
    // asynchronously as RESTART_SERVICES_RESULT.
    func restartServices() {
        sendAction(.restartServices)
    }

    func restartTunnel() {
        sendAction(.restartTunnel)
    }

    func restartMdns() {
        sendAction(.restartMdns)
    }

    private func sendPing() {
        guard state == .connected else { return }
        lastPingSentAt = Date()
        sendAction(.heartbeat)
    }

    func switchDriver(driverId: String, transport: String, wifiAddress: String = "") {
        var data: [String: Any] = ["driverId": driverId, "transport": transport]
        let trimmed = wifiAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        if transport == "wifi" && !trimmed.isEmpty {
            data["wifiAddress"] = trimmed
        }
        sendAction(.switchDriver, data: data)
    }

    // Starts, updates, or stops a patrol zone — same PATROL_UPDATE envelope
    // as tauri-app's `updatePatrolZone` (engine/internal/api/messages.go's
    // PatrolUpdatePayload). Sending `active: false` stops it; the engine
    // requires `center`+`radius` for "circle" or `bounds` for "rectangle".
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
        sendAction(.patrolUpdate, data: ["zone": zone])
    }

    // Pushes a partial settings update — same SAVE_SETTINGS envelope and
    // merge-by-key semantics as tauri-app's `saveSettings` (only the
    // provided keys are applied; see engine/internal/engine/engine.go's
    // SaveSettings).
    func saveSettings(_ settings: [String: Any]) {
        sendAction(.saveSettings, data: settings)
    }

    func addFavorite(lat: Double, lon: Double, name: String) {
        sendAction(.addFavorite, data: ["lat": lat, "lon": lon, "name": name])
    }

    func removeFavorite(lat: Double, lon: Double) {
        sendAction(.removeFavorite, data: ["lat": lat, "lon": lon])
    }

    // Plays a multi-stop itinerary. Mirrors tauri-app's sequence builder:
    // each leg's `start` is the previous leg's `end` (or the first stop's own
    // coordinate when there's nothing before it — the engine just needs a
    // valid LatLon, the real starting point is wherever the device already
    // is when the leg begins).
    func playSequence(legs: [[String: Any]], looping: Bool) {
        sendAction(.playSequence, data: ["legs": legs, "looping": looping])
    }

    private func sendAction(_ action: EngineAction, data: [String: Any] = [:]) {
        sendEnvelope(EngineEnvelope(action: action, data: data))
    }

    private func sendEnvelope(_ envelope: EngineEnvelope) {
        guard let task else {
            AppLogger.shared.warn("Action \(envelope.type) ignoree: non connecte au moteur")
            lastError = "Non connecte au moteur - action ignoree."
            return
        }
        guard let payload = try? JSONSerialization.data(withJSONObject: envelope.jsonObject),
              let json = String(data: payload, encoding: .utf8) else { return }
        let label = envelope.type
        task.send(.string(json)) { [weak self] error in
            guard let error else { return }
            // Same rule as receive(): only the Sendable description crosses
            // back onto the actor, not the Error.
            let description = error.localizedDescription
            AppLogger.shared.error("Envoi \(label) echoue: \(description)")
            Task { @MainActor in self?.lastError = description }
        }
    }
}

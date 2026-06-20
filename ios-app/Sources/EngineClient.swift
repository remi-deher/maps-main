import Foundation

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

struct EngineStatus: Codable, Equatable {
    let state: String?
    let favorites: [Favorite]?
    let lastInjectedLocation: LocationStamp?
    let lastRealLocation: RealLocationStamp?
    let currentSequencePreview: [RoutePoint]?
}

/// Talks the same {type, data} WebSocket envelope as the desktop app
/// (engine/internal/api/messages.go). Reports the device's real GPS position
/// as REAL_LOCATION so the engine's anti-drift shield can detect when the
/// spoofed position didn't "take" and re-inject it, and sends the same pilot
/// actions (SET_LOCATION, PLAY_ROUTE, ADD_FAVORITE...) the desktop app uses —
/// the engine is the single source of truth, so every connected client
/// (desktop, iOS, headless) sees the same STATUS broadcasts and stays in sync
/// for free.
final class EngineClient: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published var state: EngineConnectionState = .disconnected
    @Published var lastError: String?
    @Published var status: EngineStatus?

    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var urlString: String = ""

    // Generation counter: every connect() bumps it. Closures capture the
    // generation they belong to and bail out if it's stale, instead of
    // scheduling their own independent reconnect — the self-sustaining
    // reconnect loop the desktop app hit (see websocket.tsx) came from
    // exactly this kind of orphaned callback.
    private var generation = 0

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func connect(to urlString: String) {
        self.urlString = urlString
        generation += 1
        startSocket(generation: generation)
    }

    func disconnect() {
        generation += 1 // invalidates any in-flight callbacks
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        DispatchQueue.main.async { self.state = .disconnected }
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
        DispatchQueue.main.async {
            self.lastError = error.localizedDescription
            self.state = .reconnecting
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.generation == generation else { return }
            self.startSocket(generation: generation)
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async { self.state = .connected }
        sendEnvelope(type: "GET_STATUS", data: [:])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard self.task === task else { return }
        handleDisconnect(error: error ?? URLError(.networkConnectionLost), generation: generation)
    }

    private func handleMessage(_ text: String) {
        guard let raw = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              let type = obj["type"] as? String else { return }

        let payloadData: Data
        if let dict = obj["data"] as? [String: Any], let encoded = try? JSONSerialization.data(withJSONObject: dict) {
            payloadData = encoded
        } else {
            payloadData = Data("{}".utf8)
        }

        switch type {
        case "STATUS", "STATUS_UPDATE":
            if let decoded = try? JSONDecoder().decode(EngineStatus.self, from: payloadData) {
                DispatchQueue.main.async { self.status = decoded }
            }
        default:
            break
        }
    }

    // ─── Outbound actions (same vocabulary as tauri-app's websocket.tsx) ────

    func sendRealLocation(lat: Double, lon: Double) {
        sendEnvelope(type: "REAL_LOCATION", data: ["latitude": lat, "longitude": lon])
    }

    func setLocation(lat: Double, lon: Double, name: String = "Point iPhone") {
        sendEnvelope(type: "SET_LOCATION", data: ["lat": lat, "lon": lon, "name": name])
    }

    func playRoute(endLat: Double, endLon: Double, speed: Double, profile: String) {
        sendEnvelope(type: "PLAY_ROUTE", data: ["endLat": endLat, "endLon": endLon, "speed": speed, "profile": profile])
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
        guard let task else { return }
        guard let payload = try? JSONSerialization.data(withJSONObject: ["type": type, "data": data]),
              let json = String(data: payload, encoding: .utf8) else { return }
        task.send(.string(json)) { [weak self] error in
            if let error {
                DispatchQueue.main.async { self?.lastError = error.localizedDescription }
            }
        }
    }
}

import Foundation

enum EngineConnectionState: String {
    case disconnected = "Déconnecté"
    case connecting = "Connexion..."
    case connected = "Connecté"
    case reconnecting = "Reconnexion..."
}

/// Talks the same {type, data} WebSocket envelope as the desktop app
/// (engine/internal/api/messages.go). Reports the device's real GPS position
/// as REAL_LOCATION so the engine's anti-drift shield can detect when the
/// spoofed position didn't "take" and re-inject it.
final class EngineClient: NSObject, ObservableObject, URLSessionWebSocketDelegate {
    @Published var state: EngineConnectionState = .disconnected
    @Published var lastError: String?
    @Published var lastDrift: Double?
    @Published var engineState: String?

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
        state = .disconnected
    }

    private func startSocket(generation: Int) {
        guard let url = URL(string: urlString) else {
            lastError = "Adresse invalide: \(urlString)"
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
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard self.task === task else { return }
        handleDisconnect(error: error ?? URLError(.networkConnectionLost), generation: generation)
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { return }

        switch envelope.type {
        case "STATUS", "STATUS_UPDATE":
            if let status = try? JSONDecoder().decode(StatusPayload.self, from: envelope.data) {
                DispatchQueue.main.async {
                    self.engineState = status.state
                    self.lastDrift = status.lastRealLocation?.drift
                }
            }
        default:
            break
        }
    }

    /// Sends the device's real position to the engine (REAL_LOCATION).
    func sendRealLocation(lat: Double, lon: Double) {
        let payload = RealLocationPayload(latitude: lat, longitude: lon)
        guard let data = try? JSONEncoder().encode(payload),
              let dataJSON = String(data: data, encoding: .utf8) else { return }
        let envelopeJSON = "{\"type\":\"REAL_LOCATION\",\"data\":\(dataJSON)}"
        task?.send(.string(envelopeJSON)) { [weak self] error in
            if let error {
                DispatchQueue.main.async { self?.lastError = error.localizedDescription }
            }
        }
    }
}

// ─── Wire types (mirrors engine/internal/api) ───────────────────────────────

private struct Envelope: Decodable {
    let type: String
    let data: Data

    private enum CodingKeys: String, CodingKey { case type, data }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        if let raw = try container.decodeIfPresent(JSONValue.self, forKey: .data) {
            data = try JSONEncoder().encode(raw)
        } else {
            data = Data()
        }
    }
}

private struct RealLocationPayload: Encodable {
    let latitude: Double
    let longitude: Double
}

private struct StatusPayload: Decodable {
    let state: String?
    let lastRealLocation: RealLocationStamp?
}

private struct RealLocationStamp: Decodable {
    let drift: Double?
}

/// Minimal dynamic JSON box, just enough to re-encode an arbitrary `data`
/// field without modeling the full Status shape here.
private enum JSONValue: Codable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode([String: JSONValue].self) { self = .object(v); return }
        if let v = try? container.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? container.decode(String.self) { self = .string(v); return }
        if let v = try? container.decode(Double.self) { self = .number(v); return }
        if let v = try? container.decode(Bool.self) { self = .bool(v); return }
        self = .null
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .string(let v): try container.encode(v)
        case .number(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        }
    }
}

import Foundation

enum EngineAction: String {
    case getStatus = "GET_STATUS"
    case getLogs = "GET_LOGS"
    case setLocation = "SET_LOCATION"
    case playRoute = "PLAY_ROUTE"
    case playCustomGpx = "PLAY_CUSTOM_GPX"
    case stopRoute = "STOP_ROUTE"
    case pauseRoute = "PAUSE_ROUTE"
    case resumeRoute = "RESUME_ROUTE"
    case clearHistory = "CLEAR_HISTORY"
    case relance = "RELANCE"
    case heartbeat = "HEARTBEAT"
    case realLocation = "REAL_LOCATION"
    case switchDriver = "SWITCH_DRIVER"
    case patrolUpdate = "PATROL_UPDATE"
    case saveSettings = "SAVE_SETTINGS"
    case addFavorite = "ADD_FAVORITE"
    case removeFavorite = "REMOVE_FAVORITE"
    case playSequence = "PLAY_SEQUENCE"
    case restartServices = "RESTART_SERVICES"
}

enum EngineEvent: String {
    case status = "STATUS"
    case statusUpdate = "STATUS_UPDATE"
    case pong = "PONG"
    case log = "LOG"
    case logs = "LOGS"
    case restartServicesResult = "RESTART_SERVICES_RESULT"
}

// RestartServiceStep is one step's outcome within RestartServicesResultPayload
// (e.g. "kill python processes", "restart Bonjour/mDNS", "restart tunnel").
struct RestartServiceStep: Decodable {
    let name: String
    let succeeded: Bool
    let error: String?

    enum CodingKeys: String, CodingKey {
        case name
        case succeeded = "ok"
        case error
    }
}

// RestartServicesResultPayload is the data for RESTART_SERVICES_RESULT (the
// response to RESTART_SERVICES — see engine/internal/api/messages.go). OK
// reflects only the final tunnel-restart step; Steps gives the outcome of
// every step (kill python processes, restart Bonjour/mDNS, restart tunnel)
// so the UI can show exactly what happened.
struct RestartServicesResultPayload: Decodable {
    let succeeded: Bool
    let steps: [RestartServiceStep]?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case succeeded = "ok"
        case steps
        case error
    }
}

struct EngineEnvelope {
    let type: String
    let data: [String: Any]

    init(action: EngineAction, data: [String: Any] = [:]) {
        self.type = action.rawValue
        self.data = data
    }

    var jsonObject: [String: Any] {
        ["type": type, "data": data]
    }
}

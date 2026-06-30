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
}

enum EngineEvent: String {
    case status = "STATUS"
    case statusUpdate = "STATUS_UPDATE"
    case pong = "PONG"
    case log = "LOG"
    case logs = "LOGS"
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

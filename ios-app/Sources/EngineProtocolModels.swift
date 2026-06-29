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

struct LogEntryPayload: Codable, Equatable {
    let timestamp: Int64
    let level: String
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

struct PatrolZone: Codable, Equatable {
    let type: String
    let center: RoutePoint?
    let radius: Double?
    let bounds: PatrolBounds?
    let active: Bool
}

struct NavigationProgressPayload: Codable, Equatable {
    let index: Int?
    let total: Int?
    let lat: Double?
    let lon: Double?
    let speed: Double?
}

struct NavigationStatusPayload: Codable, Equatable {
    let state: String?
    let index: Int?
    let total: Int?
    let destination: RoutePoint?
}

struct NavigationPayload: Codable, Equatable {
    let progress: NavigationProgressPayload?
    let status: NavigationStatusPayload?
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
    let navigation: NavigationPayload?
    let usbDriver: String?
    let wifiDriver: String?
    let connectionType: String?
    let deviceInfo: DeviceInfo?
}

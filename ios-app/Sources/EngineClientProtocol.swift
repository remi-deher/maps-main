import Foundation
import CoreLocation

protocol EngineClientProtocol: AnyObject {
    var state: EngineConnectionState { get set }
    var lastError: String? { get set }
    var status: EngineStatus? { get set }
    var logs: [LogEntryPayload] { get set }
    var pingLatency: Double? { get set }
    var keepAliveEnabled: Bool { get set }
    var keepAliveInterval: Double { get set }
    var restartServicesResult: RestartServicesResultPayload? { get set }

    func connect(to urlString: String)
    func ensureConnected()
    func relanceIfDue()
    func disconnect()

    func sendRealLocation(lat: Double, lon: Double)
    func sendRealLocationIfDue(lat: Double, lon: Double)
    func setLocation(lat: Double, lon: Double, name: String)

    func playRoute(endLat: Double, endLon: Double, speed: Double, profile: String)
    func playCustomGpx(gpxContent: String, speed: Double)
    func stopRoute()
    func pauseRoute()
    func resumeRoute()
    func playSequence(legs: [[String: Any]], looping: Bool)

    func getLogs()
    func clearHistory()
    func relance()
    func restartServices()
    func switchDriver(driverId: String, transport: String, wifiAddress: String)
    func updatePatrolZone(
        type: String,
        center: CLLocationCoordinate2D?,
        radius: Double?,
        bounds: (southWest: CLLocationCoordinate2D, northEast: CLLocationCoordinate2D)?,
        active: Bool
    )
    func saveSettings(_ settings: [String: Any])

    func addFavorite(lat: Double, lon: Double, name: String)
    func removeFavorite(lat: Double, lon: Double)
}

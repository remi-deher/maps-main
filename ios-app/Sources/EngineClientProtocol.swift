import Foundation
import CoreLocation

// @MainActor for the same reason EngineClient is: every implementation owns
// state that SwiftUI reads during a body evaluation. Annotating the protocol
// (rather than only the conforming class) keeps `any EngineClientProtocol`
// call sites — MapSessionModel, the App Intents, the settings and logs sheets —
// isolated too, instead of silently losing the guarantee behind the existential.
@MainActor
protocol EngineClientProtocol: AnyObject {
    var state: EngineConnectionState { get set }
    var lastError: String? { get set }
    var status: EngineStatus? { get set }
    var logs: [LogEntryPayload] { get set }
    var pingLatency: Double? { get set }
    var keepAliveEnabled: Bool { get set }
    var keepAliveInterval: Double { get set }
    var restartServicesResult: RestartServicesResultPayload? { get set }
    var restartTunnelResult: RestartTunnelResultPayload? { get set }
    var restartMdnsResult: RestartMdnsResultPayload? { get set }

    func connect(to endpoint: EngineEndpoint)
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
    func restartTunnel()
    func restartMdns()
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

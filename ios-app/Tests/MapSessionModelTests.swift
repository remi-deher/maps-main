import CoreLocation
import XCTest
@testable import GpsMockCompanion

// A stand-in engine that records what MapSessionModel asks of it. Everything is
// a counter or a captured argument: these tests are about the *wiring* — which
// call happens, in which order, under which condition — not about the socket.
@MainActor
final class SpyEngineClient: EngineClientProtocol {
    var state: EngineConnectionState = .disconnected
    var lastError: String?
    var status: EngineStatus?
    var logs: [LogEntryPayload] = []
    var pingLatency: Double?
    var keepAliveEnabled = true
    var keepAliveInterval: Double = 5
    var restartServicesResult: RestartServicesResultPayload?
    var restartTunnelResult: RestartTunnelResultPayload?
    var restartMdnsResult: RestartMdnsResultPayload?

    private(set) var connectedEndpoints: [EngineEndpoint] = []
    private(set) var disconnectCount = 0
    private(set) var ensureConnectedCount = 0
    private(set) var relanceIfDueCount = 0
    private(set) var realLocationIfDue: [(lat: Double, lon: Double)] = []

    func connect(to endpoint: EngineEndpoint) {
        connectedEndpoints.append(endpoint)
        state = .connected
    }

    func disconnect() {
        disconnectCount += 1
        state = .disconnected
    }

    func ensureConnected() { ensureConnectedCount += 1 }
    func relanceIfDue() { relanceIfDueCount += 1 }

    func sendRealLocationIfDue(lat: Double, lon: Double) {
        realLocationIfDue.append((lat, lon))
    }

    // Everything below is unused by these tests; the protocol requires it.
    func sendRealLocation(lat: Double, lon: Double) {}
    func setLocation(lat: Double, lon: Double, name: String) {}
    func playRoute(endLat: Double, endLon: Double, speed: Double, profile: String) {}
    func playCustomGpx(gpxContent: String, speed: Double) {}
    func stopRoute() {}
    func pauseRoute() {}
    func resumeRoute() {}
    func playSequence(legs: [[String: Any]], looping: Bool) {}
    func getLogs() {}
    func clearHistory() {}
    func relance() {}
    func restartServices() {}
    func restartTunnel() {}
    func restartMdns() {}
    func switchDriver(driverId: String, transport: String, wifiAddress: String) {}
    func updatePatrolZone(
        type: String,
        center: CLLocationCoordinate2D?,
        radius: Double?,
        bounds: (southWest: CLLocationCoordinate2D, northEast: CLLocationCoordinate2D)?,
        active: Bool
    ) {}
    func saveSettings(_ settings: [String: Any]) {}
    func addFavorite(lat: Double, lon: Double, name: String) {}
    func removeFavorite(lat: Double, lon: Double) {}
}

@MainActor
final class MapSessionModelTests: XCTestCase {

    private func makeSession() -> (MapSessionModel, SpyEngineClient) {
        let engine = SpyEngineClient()
        return (MapSessionModel(engine: engine), engine)
    }

    // MARK: - Connexion

    func testToggleConnectionConnectsThenDisconnects() {
        let (session, engine) = makeSession()

        session.toggleConnection(engineAddress: "192.168.1.10:8080", keepAliveEnabled: false)
        XCTAssertEqual(engine.connectedEndpoints.count, 1)
        XCTAssertEqual(engine.connectedEndpoints.first?.urlString, "ws://192.168.1.10:8080/ws")

        // Toggling again while connected tears the session down rather than
        // opening a second socket.
        session.toggleConnection(engineAddress: "192.168.1.10:8080", keepAliveEnabled: false)
        XCTAssertEqual(engine.disconnectCount, 1)
        XCTAssertEqual(engine.connectedEndpoints.count, 1, "toggling off must not reconnect")
    }

    // Changing the port in settings has to drop the old socket first; reconnecting
    // without disconnecting used to leave the previous connection dangling.
    func testReconnectDropsTheCurrentSocketFirst() {
        let (session, engine) = makeSession()
        session.toggleConnection(engineAddress: "192.168.1.10:8080", keepAliveEnabled: false)

        session.reconnect(engineAddress: "192.168.1.10:9090")

        XCTAssertEqual(engine.disconnectCount, 1)
        XCTAssertEqual(engine.connectedEndpoints.count, 2)
        XCTAssertEqual(engine.connectedEndpoints.last?.urlString, "ws://192.168.1.10:9090/ws")
    }

    // Reconnecting from a disconnected state must not emit a spurious disconnect.
    func testReconnectFromDisconnectedJustConnects() {
        let (session, engine) = makeSession()

        session.reconnect(engineAddress: "192.168.1.10:8080")

        XCTAssertEqual(engine.disconnectCount, 0)
        XCTAssertEqual(engine.connectedEndpoints.count, 1)
    }

    // MARK: - Keep-alive en arrière-plan

    // This is the only code path that runs while the app is suspended, so its
    // wiring matters more than most: each CoreLocation delivery must rebuild a
    // dropped socket, report the real position for the anti-drift shield, and
    // re-assert the spoof — in that order.
    func testBackgroundLocationCallbackDrivesTheThreeKeepAliveSteps() throws {
        let (session, engine) = makeSession()
        session.bindBackgroundKeepAlive()

        let callback = try XCTUnwrap(session.location.onLocationUpdate)
        callback(CLLocation(latitude: 48.8566, longitude: 2.3522))

        XCTAssertEqual(engine.ensureConnectedCount, 1)
        XCTAssertEqual(engine.realLocationIfDue.count, 1)
        XCTAssertEqual(engine.realLocationIfDue.first?.lat ?? 0, 48.8566, accuracy: 1e-6)
        XCTAssertEqual(engine.realLocationIfDue.first?.lon ?? 0, 2.3522, accuracy: 1e-6)
        XCTAssertEqual(engine.relanceIfDueCount, 1)
    }

    // Disconnecting clears the callback, so a location delivery arriving after
    // the user disconnected doesn't quietly reopen the socket.
    func testDisconnectingClearsTheLocationCallback() {
        let (session, _) = makeSession()
        session.toggleConnection(engineAddress: "192.168.1.10:8080", keepAliveEnabled: false)
        XCTAssertNotNil(session.location.onLocationUpdate)

        session.toggleConnection(engineAddress: "192.168.1.10:8080", keepAliveEnabled: false)

        XCTAssertNil(session.location.onLocationUpdate)
    }

    // The toggle is mirrored onto the engine because the background callback
    // reads it from there — SwiftUI state isn't readable while suspended.
    func testApplyKeepAliveEnabledMirrorsOntoTheEngine() {
        let (session, engine) = makeSession()

        session.applyKeepAliveEnabled(false, interval: 5)
        XCTAssertFalse(engine.keepAliveEnabled)

        session.applyKeepAliveEnabled(true, interval: 5)
        XCTAssertTrue(engine.keepAliveEnabled)
    }

    // MARK: - Endpoint

    // An address with no stored token still yields a usable endpoint: the engine
    // accepts a tokenless client over loopback.
    func testWebSocketEndpointForAnUnpairedAddress() {
        let endpoint = MapSessionModel.webSocketEndpoint(for: "127.0.0.1:8080")
        XCTAssertEqual(endpoint.urlString, "ws://127.0.0.1:8080/ws")
    }
}

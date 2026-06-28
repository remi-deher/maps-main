import CoreLocation
import MapKit
import Observation

/// Owns the engine connection, the device's location feed, and every
/// `Task<Void, Never>` whose lifecycle has to survive across ContentView body
/// re-evaluations: the anti-drift reporter, the keep-alive loop, and the
/// per-leg ETA computation. These used to live directly on ContentView as
/// `@State` — fine for value-type state, but a `View` struct can be recreated
/// at any time, so tasks and connection objects belong on a stable
/// reference-type owner instead. ContentView holds exactly one of these via
/// `@State`, which is enough: `@State` persists a reference type for the
/// view's lifetime same as it would persist a value.
@MainActor
@Observable
final class MapSessionModel {
    let engine = EngineClient()
    let location = LocationManager()

    private(set) var legEstimates: [UUID: LegEstimate] = [:]

    private var reportTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var estimatesTask: Task<Void, Never>?

    // Connection/simulation transition tracking, moved out of ContentView's
    // body (where it lived as @State + inline onChange logic) so the view stays
    // declarative and this state survives view re-creation. @ObservationIgnored:
    // it's internal bookkeeping, no view observes it. See §3 of
    // docs/UI_UX_BASELINE.md.
    @ObservationIgnored private var wasConnected = false
    @ObservationIgnored private var lastSimulationState: String?

    func toggleConnection(engineAddress: String, keepAliveEnabled: Bool) {
        if engine.state == .connected || engine.state == .connecting {
            stopReporting()
            stopKeepAlive()
            location.onLocationUpdate = nil
            engine.disconnect()
            return
        }
        engine.connect(to: Self.webSocketURL(for: engineAddress))
        startReporting()
        bindBackgroundKeepAlive()
        if keepAliveEnabled {
            location.requestAlwaysPermission()
            location.enableBackgroundUpdates(true)
            startKeepAlive(interval: engine.keepAliveInterval)
        }
    }

    /// Drops the current connection and reopens it against the (possibly
    /// just-edited) `engineAddress` — used when the user changes the port in
    /// settings, mirroring tauri-app's "Appliquer" button for its engine
    /// port field (Sidebar.tsx's handleApplyEnginePort).
    func reconnect(engineAddress: String) {
        if engine.state == .connected || engine.state == .connecting {
            engine.disconnect()
        }
        engine.connect(to: Self.webSocketURL(for: engineAddress))
        startReporting()
        bindBackgroundKeepAlive()
    }

    /// Builds the engine WebSocket URL, attaching the durable device token
    /// stored for this address (if the engine was paired) so a LAN connection
    /// is authorized — the engine rejects tokenless remote clients.
    static func webSocketURL(for address: String) -> String {
        EnginePairing.webSocketURL(address: address, token: EngineTokenStore.token(forAddress: address))
    }

    /// Routes every CoreLocation delivery through the engine. This is the path
    /// that survives suspension (the `Task.sleep` loops in startReporting/
    /// startKeepAlive don't): on each callback it rebuilds a dropped socket,
    /// reports the real position for the anti-drift shield, and re-asserts the
    /// spoof at the keep-alive cadence. Engine is captured weakly — it owns no
    /// reference back, so there's no cycle, and a torn-down engine just stops
    /// the callback.
    func bindBackgroundKeepAlive() {
        location.onLocationUpdate = { [weak engine] loc in
            guard let engine else { return }
            engine.ensureConnected()
            engine.sendRealLocationIfDue(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            engine.relanceIfDue()
        }
    }

    /// Periodically re-sends RELANCE so the engine re-asserts the last
    /// injected position — the "maintien" the legacy background task
    /// (services/background.ts) achieved by posting to /api/relance on every
    /// background location tick. Runs independently of REAL_LOCATION
    /// reporting so it keeps the spoof alive even if the device's own GPS
    /// briefly drifts or the anti-drift shield hasn't re-injected yet.
    ///
    /// `interval` is only the loop's polling cadence — the actual throttle is
    /// enforced engine-side by `relanceIfDue()` reading `engine.keepAliveInterval`
    /// (kept in sync separately), so a stale snapshot here doesn't desync the
    /// real RELANCE cadence.
    func startKeepAlive(interval: Double) {
        keepAliveTask?.cancel()
        keepAliveTask = Task { [engine] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(max(interval, 1)))
                guard !Task.isCancelled, engine.state == .connected else { continue }
                // Same throttled path as the background location callback, so
                // foreground + background never double-fire RELANCE.
                engine.relanceIfDue()
            }
        }
    }

    func stopKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    /// Task-based instead of `Timer.scheduledTimer`: a Timer keeps firing
    /// (and keeps a strong RunLoop reference alive) regardless of the view's
    /// lifecycle, whereas this Task is owned by `reportTask` and is
    /// cancelled explicitly in `stopReporting()` — see §3.22 of
    /// docs/UI_UX_BASELINE.md.
    func startReporting() {
        reportTask?.cancel()
        reportTask = Task { [engine, location] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, let loc = location.lastLocation else { continue }
                engine.sendRealLocationIfDue(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            }
        }
    }

    func stopReporting() {
        reportTask?.cancel()
        reportTask = nil
    }

    // MARK: - State-transition side effects (driven by ContentView onChange)

    /// Tracks connection transitions and fires a single disconnect
    /// notification when a previously-connected session drops. Idempotent —
    /// safe to call on every `engine.state` change.
    func handleEngineStateChange(notificationsEnabled: Bool) {
        if engine.state == .connected {
            wasConnected = true
        } else if wasConnected && (engine.state == .reconnecting || engine.state == .disconnected) {
            wasConnected = false
            if notificationsEnabled { NotificationManager.shared.notifyDisconnect() }
        }
    }

    /// Fires an arrival notification when the simulation transitions from a
    /// moving/running state to "ready" (destination reached). Tracks the
    /// previous state internally so the view doesn't have to.
    func handleSimulationStateChange(notificationsEnabled: Bool) {
        let previous = lastSimulationState
        let newState = engine.status?.state
        lastSimulationState = newState
        guard notificationsEnabled, let newState else { return }
        if newState == "ready" && (previous == "running" || previous == "moving") {
            NotificationManager.shared.notifyArrival(locationName: engine.status?.lastInjectedLocation?.name)
        }
    }

    /// Mirrors the keep-alive toggle into the engine and starts/stops the
    /// background loop, requesting the Always authorization the background
    /// location callback needs when enabling.
    func applyKeepAliveEnabled(_ enabled: Bool, interval: Double) {
        engine.keepAliveEnabled = enabled
        location.enableBackgroundUpdates(enabled)
        if enabled {
            location.requestAlwaysPermission()
            if engine.state == .connected { startKeepAlive(interval: interval) }
        } else {
            stopKeepAlive()
        }
    }

    /// Recomputes per-leg distance/ETA via OSRM, keyed by destination stop id
    /// — mirrors the duration Plans shows under each leg of a trip, but uses
    /// the same router the engine itself uses to actually drive the
    /// simulation (engine/internal/engine/simulation.go), instead of
    /// MapKit/Apple Maps routing which can disagree on which road it picks.
    /// Falls back to MKDirections per-leg if OSRM is unreachable (offline
    /// demo server, no network) so estimates degrade rather than vanish.
    func recomputeLegEstimates(_ stops: [RouteStop], profile: String) {
        estimatesTask?.cancel()
        guard !stops.isEmpty else {
            legEstimates = [:]
            return
        }
        estimatesTask = Task {
            var results: [UUID: LegEstimate] = [:]

            // First leg: from current location to stops[0]
            if let currentCoordinate = await MainActor.run(body: { location.lastLocation?.coordinate }) {
                guard !Task.isCancelled else { return }
                let destination = stops[0]
                if let route = await OSRMClient.fetchRoute(from: currentCoordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds)
                } else if let fallback = await fetchMapKitEstimate(from: currentCoordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = fallback
                }
            }

            // Remaining legs: stops[i-1] to stops[i]
            for index in 1..<stops.count {
                guard !Task.isCancelled else { return }
                let origin = stops[index - 1]
                let destination = stops[index]
                if let route = await OSRMClient.fetchRoute(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds)
                } else if let fallback = await fetchMapKitEstimate(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = fallback
                }
            }
            guard !Task.isCancelled else { return }
            legEstimates = results
        }
    }

    private func fetchMapKitEstimate(from origin: CLLocationCoordinate2D, to destination: CLLocationCoordinate2D, profile: String) async -> LegEstimate? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: origin))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: destination))
        request.transportType = profile == "walking" ? .walking : .automobile
        guard let route = try? await MKDirections(request: request).calculate().routes.first else { return nil }
        AppLogger.shared.warn("OSRM indisponible, repli MKDirections pour l'estimation d'étape")
        return LegEstimate(distanceMeters: route.distance, travelTime: route.expectedTravelTime)
    }
}

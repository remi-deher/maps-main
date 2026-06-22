import CoreLocation
import Observation

/// Wraps CLLocationManager and republishes the device's real position so
/// EngineClient can forward it to the moteur as REAL_LOCATION — the data the
/// anti-drift shield needs to confirm the spoof actually "took" on-device.
@Observable
final class LocationManager: NSObject, CLLocationManagerDelegate {
    var authorizationStatus: CLAuthorizationStatus = .notDetermined
    var lastLocation: CLLocation?

    /// Called on every CoreLocation delivery — including the brief execution
    /// windows iOS grants a backgrounded app holding Always auth + the
    /// `location` background mode. This is the ONLY code path that runs while
    /// suspended, so the keep-alive (REAL_LOCATION + RELANCE) must be driven
    /// from here, not from a `Task.sleep` loop (which iOS freezes in the
    /// background). Set by ContentView on connect, cleared on disconnect.
    var onLocationUpdate: ((CLLocation) -> Void)?

    private let manager = CLLocationManager()

    /// Remembers the caller's intent so background updates can be (re)applied
    /// the moment Always authorization is actually granted — the grant is
    /// async, so `enableBackgroundUpdates(true)` is almost always called while
    /// still only WhenInUse and would otherwise be silently dropped.
    private var wantsBackgroundUpdates = false

    override init() {
        super.init()
        manager.delegate = self
        // Accuracy/battery trade-off is user-selectable (Réglages). Applied
        // from the persisted choice at launch; see `setAccuracyMode`.
        setAccuracyMode(UserDefaults.standard.string(forKey: "locationAccuracyMode") ?? "balanced")
        authorizationStatus = manager.authorizationStatus
    }

    /// Maps the user's accuracy/battery preference onto CoreLocation.
    /// "high" uses `kCLDistanceFilterNone` so callbacks keep arriving even when
    /// the device is perfectly still — the only way the standby keep-alive
    /// stays alive while stationary (a distance filter would let iOS suspend
    /// the app). "balanced"/"low" save battery but then rely on movement (or
    /// the BGAppRefreshTask safety net) to wake the app. REAL_LOCATION /
    /// RELANCE are throttled downstream, so even "high" doesn't flood the
    /// socket.
    func setAccuracyMode(_ mode: String) {
        switch mode {
        case "high":
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = kCLDistanceFilterNone
        case "low":
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = 50
        default: // "balanced"
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            manager.distanceFilter = 25
        }
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    /// Upgrades to "Always" so the keep-alive loop (relance périodique,
    /// §EveilMode) can keep re-asserting the spoofed position while the app
    /// is backgrounded — iOS only wakes a backgrounded process for location
    /// work when it holds Always authorization + the `location` background
    /// mode (project.yml) AND `allowsBackgroundLocationUpdates` is set.
    func requestAlwaysPermission() {
        manager.requestAlwaysAuthorization()
    }

    /// Records the desired background-update state and applies it as soon as
    /// the authorization allows. Safe to call before Always is granted: the
    /// intent is stored and re-applied from `didChangeAuthorization` once the
    /// grant lands (see `applyBackgroundUpdates`).
    func enableBackgroundUpdates(_ enabled: Bool) {
        wantsBackgroundUpdates = enabled
        applyBackgroundUpdates()
    }

    /// Pushes `wantsBackgroundUpdates` onto the manager — but only once Always
    /// authorization is in hand, since `allowsBackgroundLocationUpdates = true`
    /// traps without it + the `location` background mode (project.yml).
    private func applyBackgroundUpdates() {
        guard authorizationStatus == .authorizedAlways else { return }
        manager.allowsBackgroundLocationUpdates = wantsBackgroundUpdates
        manager.pausesLocationUpdatesAutomatically = !wantsBackgroundUpdates
    }

    func startUpdating() {
        manager.startUpdatingLocation()
    }

    func stopUpdating() {
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
        if authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways {
            // Re-apply the stored background intent now that the (async) grant
            // has landed — this is what actually turns on background updates,
            // since the enableBackgroundUpdates() call at connect time almost
            // always ran while still only WhenInUse.
            applyBackgroundUpdates()
            startUpdating()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        lastLocation = latest
        // Drives the background keep-alive — see `onLocationUpdate`.
        onLocationUpdate?(latest)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient GPS errors are common indoors; nothing actionable here.
    }
}

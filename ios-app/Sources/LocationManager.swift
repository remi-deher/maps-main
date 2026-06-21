import CoreLocation
import Combine

/// Wraps CLLocationManager and republishes the device's real position so
/// EngineClient can forward it to the moteur as REAL_LOCATION — the data the
/// anti-drift shield needs to confirm the spoof actually "took" on-device.
final class LocationManager: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var authorizationStatus: CLAuthorizationStatus = .notDetermined
    @Published var lastLocation: CLLocation?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10 // meters
        authorizationStatus = manager.authorizationStatus
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

    /// Must only be called once Always authorization is granted and
    /// UIBackgroundModes contains "location" — CoreLocation traps otherwise.
    func enableBackgroundUpdates(_ enabled: Bool) {
        guard authorizationStatus == .authorizedAlways else { return }
        manager.allowsBackgroundLocationUpdates = enabled
        manager.pausesLocationUpdatesAutomatically = !enabled
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
            startUpdating()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        lastLocation = locations.last
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient GPS errors are common indoors; nothing actionable here.
    }
}

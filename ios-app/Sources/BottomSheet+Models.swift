import SwiftUI
import CoreLocation

struct RecentPlace: Codable, Identifiable, Equatable {
    let lat: Double
    let lon: Double
    let title: String
    let subtitle: String?
    let timestamp: Int64

    var id: String { "\(lat),\(lon)" }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

/// The five actions the place card (PlaceCard) can trigger, grouped into one
/// value instead of five separate closure parameters on BottomSheet's
/// initializer — ContentView builds this once from `selectedPlace`'s
/// handlers, keeping the call site readable.
struct PlaceActions {
    var onTeleport: () -> Void
    var onRoute: () -> Void
    var onAddStop: () -> Void
    var onFavorite: () -> Void
    var onCopyCoordinates: () -> Void
    var onDismiss: () -> Void
}

/// Patrol-zone state and actions, grouped into one value so they don't balloon
/// BottomSheet's initializer. ContentView owns the underlying state and drives
/// the live map preview; the sheet just renders the setup panel, the active
/// banner, and the entry button. Promoting this out of Réglages lets the zone
/// be framed against the map instead of configured blind in a settings form.
struct PatrolControls {
    /// True while the user is defining a zone (the setup panel is showing).
    var isSettingUp: Bool
    /// True while a patrol is running (the persistent active banner shows).
    var isActive: Bool
    var type: Binding<String>
    var radius: Binding<Double>
    /// Enter setup mode from the sheet's empty state.
    var onBegin: () -> Void
    /// Commit the defined zone and start patrolling.
    var onStart: () -> Void
    /// Leave setup mode without starting.
    var onCancel: () -> Void
    /// Stop a running patrol.
    var onStop: () -> Void
}

/// GPX-import state and actions, grouped like PatrolControls. ContentView owns
/// the file handling and presents the picker; the sheet renders the entry
/// button and, once a track is loaded, the GpxPanel.
struct GpxImport {
    /// True once a file has been picked and parsed (the panel shows).
    var isLoaded: Bool
    var fileName: String
    var errorMessage: String?
    var speed: Binding<Double>
    /// Open the system file picker.
    var onPick: () -> Void
    /// Play the loaded track.
    var onLaunch: () -> Void
    /// Discard the loaded track without playing.
    var onCancel: () -> Void
}

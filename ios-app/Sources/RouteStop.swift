import CoreLocation

// One stop in a multi-leg itinerary being built — mirrors the desktop
// sequence builder's legs (tauri-app Sidebar.tsx), just without the manual
// start-point field since the panel chains stops automatically.
struct RouteStop: Identifiable, Equatable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
    let name: String

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.id == rhs.id
    }
}

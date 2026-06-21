import Foundation
import CoreLocation

struct OSRMRoute {
    let path: [CLLocationCoordinate2D]
    let distanceMeters: Double
    let durationSeconds: Double
}

/// Thin client for the public OSRM demo server, porting legacy's
/// utils/routing.ts (fetchRoute / snapToRoad). Used for itinerary ETAs and
/// previews so they agree with the routing the engine itself performs
/// server-side (engine/internal/engine/simulation.go) instead of MapKit's
/// own Apple Maps routing, which can pick a different road and disagree with
/// what the simulation will actually drive.
enum OSRMClient {
    private static let baseURL = "https://router.project-osrm.org"

    private static func profile(for transportProfile: String) -> String {
        transportProfile == "walking" ? "walking" : "driving"
    }

    static func fetchRoute(
        from start: CLLocationCoordinate2D,
        to end: CLLocationCoordinate2D,
        profile transportProfile: String
    ) async -> OSRMRoute? {
        let profile = profile(for: transportProfile)
        guard let url = URL(string: "\(baseURL)/route/v1/\(profile)/\(start.longitude),\(start.latitude);\(end.longitude),\(end.latitude)?overview=full&geometries=geojson") else {
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode(OSRMRouteResponse.self, from: data)
            guard let route = decoded.routes.first else { return nil }
            let path = route.geometry.coordinates.map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
            return OSRMRoute(path: path, distanceMeters: route.distance, durationSeconds: route.duration)
        } catch {
            AppLogger.shared.warn("OSRM fetchRoute a échoué: \(error.localizedDescription)")
            return nil
        }
    }

    /// Snaps a long-press/search coordinate onto the nearest road segment —
    /// mirrors legacy's snapToRoad, used so a teleport/route target lands
    /// where the engine's OSRM-based simulation can actually drive to.
    static func snapToRoad(_ coordinate: CLLocationCoordinate2D, profile transportProfile: String) async -> CLLocationCoordinate2D? {
        let profile = profile(for: transportProfile)
        guard let url = URL(string: "\(baseURL)/nearest/v1/\(profile)/\(coordinate.longitude),\(coordinate.latitude)?number=1") else {
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode(OSRMNearestResponse.self, from: data)
            guard let wp = decoded.waypoints.first, wp.location.count == 2 else { return nil }
            return CLLocationCoordinate2D(latitude: wp.location[1], longitude: wp.location[0])
        } catch {
            AppLogger.shared.warn("OSRM snapToRoad a échoué: \(error.localizedDescription)")
            return nil
        }
    }
}

private struct OSRMRouteResponse: Decodable {
    struct Route: Decodable {
        struct Geometry: Decodable { let coordinates: [[Double]] }
        let geometry: Geometry
        let distance: Double
        let duration: Double
    }
    let routes: [Route]
}

private struct OSRMNearestResponse: Decodable {
    struct Waypoint: Decodable { let location: [Double] }
    let waypoints: [Waypoint]
}

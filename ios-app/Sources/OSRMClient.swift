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
    private static let baseURL = URL(string: "https://router.project-osrm.org")!

    internal static func profile(for transportProfile: String) -> String {
        transportProfile == "walking" ? "walking" : "driving"
    }

    private static func makeURL(path: String, queryItems: [URLQueryItem]) -> URL? {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.scheme = "https"
        components?.percentEncodedPath = path
        components?.queryItems = queryItems
        return components?.url
    }

    static func fetchRoute(
        from start: CLLocationCoordinate2D,
        to end: CLLocationCoordinate2D,
        profile transportProfile: String
    ) async -> OSRMRoute? {
        let profile = profile(for: transportProfile)
        guard let url = makeURL(
            path: "/route/v1/\(profile)/\(start.longitude),\(start.latitude);\(end.longitude),\(end.latitude)",
            queryItems: [
                URLQueryItem(name: "overview", value: "full"),
                URLQueryItem(name: "geometries", value: "geojson")
            ]
        ) else {
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
        guard let url = makeURL(
            path: "/nearest/v1/\(profile)/\(coordinate.longitude),\(coordinate.latitude)",
            queryItems: [URLQueryItem(name: "number", value: "1")]
        ) else {
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let decoded = try JSONDecoder().decode(OSRMNearestResponse.self, from: data)
            guard let waypoint = decoded.waypoints.first, waypoint.location.count == 2 else { return nil }
            return CLLocationCoordinate2D(latitude: waypoint.location[1], longitude: waypoint.location[0])
        } catch {
            AppLogger.shared.warn("OSRM snapToRoad a échoué: \(error.localizedDescription)")
            return nil
        }
    }
}

private struct OSRMRouteResponse: Decodable {
    let routes: [OSRMRouteResponseRoute]
}

private struct OSRMRouteResponseRoute: Decodable {
    let geometry: OSRMRouteResponseRouteGeometry
    let distance: Double
    let duration: Double
}

private struct OSRMRouteResponseRouteGeometry: Decodable {
    let coordinates: [[Double]]
}

private struct OSRMNearestResponse: Decodable {
    struct Waypoint: Decodable { let location: [Double] }
    let waypoints: [Waypoint]
}

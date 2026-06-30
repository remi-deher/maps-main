import Foundation
import CoreLocation

struct MapPersistenceStore {
    private let defaults: UserDefaults
    private let lastItineraryKey = "lastItinerary"
    private let recentPlacesKey = "recentPlaces"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var hasSavedItinerary: Bool {
        defaults.data(forKey: lastItineraryKey) != nil
    }

    func saveLastItinerary(stops: [RouteStop], speed: Double, profile: String) -> Bool {
        let saved = SavedItinerary(
            stops: stops.map { SavedStop(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude, name: $0.name) },
            speed: speed,
            profile: profile
        )
        guard let data = try? JSONEncoder().encode(saved) else { return false }
        defaults.set(data, forKey: lastItineraryKey)
        return true
    }
}

struct LastItinerary {
    let stops: [RouteStop]
    let speed: Double
    let profile: String
}

extension MapPersistenceStore {
    func loadLastItinerary() -> LastItinerary? {
        guard let data = defaults.data(forKey: lastItineraryKey),
              let saved = try? JSONDecoder().decode(SavedItinerary.self, from: data) else { return nil }
        let stops = saved.stops.map {
            RouteStop(coordinate: CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon), name: $0.name)
        }
        return LastItinerary(stops: stops, speed: saved.speed, profile: saved.profile)
    }

    func loadRecentPlaces() -> [RecentPlace] {
        guard let data = defaults.data(forKey: recentPlacesKey),
              let decoded = try? JSONDecoder().decode([RecentPlace].self, from: data) else { return [] }
        return decoded
    }

    func saveRecentPlaces(_ places: [RecentPlace]) {
        guard let data = try? JSONEncoder().encode(places) else { return }
        defaults.set(data, forKey: recentPlacesKey)
    }
}

private struct SavedStop: Codable {
    let lat: Double
    let lon: Double
    let name: String
}

private struct SavedItinerary: Codable {
    let stops: [SavedStop]
    let speed: Double
    let profile: String
}

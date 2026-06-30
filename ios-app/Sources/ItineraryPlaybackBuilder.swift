import CoreLocation

struct ItineraryPlaybackBuilder {
    func sequenceLegs(
        for stops: [RouteStop],
        speed: Double,
        profile: String,
        startingCoordinate: CLLocationCoordinate2D?
    ) -> [[String: Any]] {
        guard !stops.isEmpty else { return [] }
        let legType = profile == "walking" ? "walk" : "drive"
        var previousCoordinate = startingCoordinate ?? stops[0].coordinate

        return stops.map { stop in
            defer { previousCoordinate = stop.coordinate }
            return [
                "type": legType,
                "start": ["lat": previousCoordinate.latitude, "lon": previousCoordinate.longitude],
                "end": ["lat": stop.coordinate.latitude, "lon": stop.coordinate.longitude],
                "speed": speed
            ]
        }
    }
}

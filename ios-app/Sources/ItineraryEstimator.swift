import Foundation
import CoreLocation
import MapKit

/// Pure async actor to handle fetching estimates from OSRMClient
/// and falling back to MKDirections.
@MainActor
final class ItineraryEstimator {

    private var estimatesTask: Task<Void, Never>?
    private(set) var legEstimates: [UUID: LegEstimate] = [:]

    func recomputeLegEstimates(stops: [RouteStop], profile: String, currentLocation: CLLocation?, onComplete: @escaping ([UUID: LegEstimate]) -> Void) {
        estimatesTask?.cancel()
        guard !stops.isEmpty else {
            onComplete([:])
            return
        }

        estimatesTask = Task {
            var results: [UUID: LegEstimate] = [:]

            // First leg: from current location to stops[0]
            if let currentCoordinate = currentLocation?.coordinate {
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
            onComplete(results)
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

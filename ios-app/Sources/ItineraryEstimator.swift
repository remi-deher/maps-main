import Foundation
import CoreLocation
import MapKit

// Result of an itinerary recompute: per-leg ETAs (keyed by destination stop
// id) plus the concatenated road geometry for a Plans-style route preview
// drawn while the trip is still being planned.
struct ItineraryPlan {
    let estimates: [UUID: LegEstimate]
    let path: [CLLocationCoordinate2D]
}

// Pure async actor to handle fetching estimates from OSRMClient
// and falling back to MKDirections.
@MainActor
final class ItineraryEstimator {

    private var estimatesTask: Task<Void, Never>?

    func recomputeLegEstimates(stops: [RouteStop], profile: String, currentLocation: CLLocation?, onComplete: @escaping (ItineraryPlan) -> Void) {
        estimatesTask?.cancel()
        guard !stops.isEmpty else {
            onComplete(ItineraryPlan(estimates: [:], path: []))
            return
        }

        estimatesTask = Task {
            var results: [UUID: LegEstimate] = [:]
            var path: [CLLocationCoordinate2D] = []

            // First leg: from current location to stops[0]
            if let currentCoordinate = currentLocation?.coordinate {
                guard !Task.isCancelled else { return }
                let destination = stops[0]
                if let route = await OSRMClient.fetchRoute(from: currentCoordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds)
                    appendLeg(route.path, to: &path)
                } else {
                    if let fallback = await fetchMapKitEstimate(from: currentCoordinate, to: destination.coordinate, profile: profile) {
                        results[destination.id] = fallback
                    }
                    appendLeg([currentCoordinate, destination.coordinate], to: &path)
                }
            }

            // Remaining legs: stops[i-1] to stops[i]
            for index in 1..<stops.count {
                guard !Task.isCancelled else { return }
                let origin = stops[index - 1]
                let destination = stops[index]
                if let route = await OSRMClient.fetchRoute(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                    results[destination.id] = LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds)
                    appendLeg(route.path, to: &path)
                } else {
                    if let fallback = await fetchMapKitEstimate(from: origin.coordinate, to: destination.coordinate, profile: profile) {
                        results[destination.id] = fallback
                    }
                    appendLeg([origin.coordinate, destination.coordinate], to: &path)
                }
            }
            guard !Task.isCancelled else { return }
            onComplete(ItineraryPlan(estimates: results, path: path))
        }
    }

    // Appends a leg's coordinates, dropping the first point when it duplicates
    // the previous leg's endpoint so the polyline stays continuous.
    private func appendLeg(_ leg: [CLLocationCoordinate2D], to path: inout [CLLocationCoordinate2D]) {
        guard !leg.isEmpty else { return }
        if let last = path.last, let first = leg.first,
           abs(last.latitude - first.latitude) < 1e-9, abs(last.longitude - first.longitude) < 1e-9 {
            path.append(contentsOf: leg.dropFirst())
        } else {
            path.append(contentsOf: leg)
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

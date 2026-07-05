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
            // Walk each leg, chaining from the current location (if known) into
            // the first stop, then stop to stop. A nil origin (no current
            // location before the first stop) simply skips that leg.
            var origin = currentLocation?.coordinate
            for stop in stops {
                guard !Task.isCancelled else { return }
                if let origin {
                    let leg = await legResult(from: origin, to: stop.coordinate, profile: profile)
                    if let estimate = leg.estimate {
                        results[stop.id] = estimate
                    }
                    appendLeg(leg.path, into: &path)
                }
                origin = stop.coordinate
            }
            guard !Task.isCancelled else { return }
            onComplete(ItineraryPlan(estimates: results, path: path))
        }
    }

    // ETA + geometry for a single leg: OSRM when available (real road path),
    // otherwise a MapKit estimate with a straight-line segment for the preview.
    private func legResult(
        from origin: CLLocationCoordinate2D,
        to destination: CLLocationCoordinate2D,
        profile: String
    ) async -> (estimate: LegEstimate?, path: [CLLocationCoordinate2D]) {
        if let route = await OSRMClient.fetchRoute(from: origin, to: destination, profile: profile) {
            return (LegEstimate(distanceMeters: route.distanceMeters, travelTime: route.durationSeconds), route.path)
        }
        let fallback = await fetchMapKitEstimate(from: origin, to: destination, profile: profile)
        return (fallback, [origin, destination])
    }

    // Appends a leg's coordinates, dropping the first point when it duplicates
    // the previous leg's endpoint so the polyline stays continuous.
    private func appendLeg(_ leg: [CLLocationCoordinate2D], into path: inout [CLLocationCoordinate2D]) {
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

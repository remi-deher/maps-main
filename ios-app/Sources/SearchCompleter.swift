import MapKit
import Observation

/// Wraps `MKLocalSearchCompleter` for instant address suggestions as the
/// user types — Plans shows completions within a keystroke or two, whereas
/// firing a full `MKLocalSearch` after a fixed debounce (the previous
/// approach) only resolves once typing pauses. A completion is resolved into
/// an `MKMapItem` (one `MKLocalSearch`) only once the user picks one. See
/// §3.8 of docs/UI_UX_BASELINE.md.
@MainActor
@Observable
final class SearchCompleter: NSObject, MKLocalSearchCompleterDelegate {
    var results: [MKLocalSearchCompletion] = []

    private let completer: MKLocalSearchCompleter

    override init() {
        completer = MKLocalSearchCompleter()
        super.init()
        completer.delegate = self
        completer.resultTypes = [.address, .pointOfInterest]
    }

    var queryFragment: String {
        get { completer.queryFragment }
        set { completer.queryFragment = newValue }
    }

    func updateRegion(center: CLLocationCoordinate2D) {
        completer.region = MKCoordinateRegion(center: center, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
    }

    func resolve(_ completion: MKLocalSearchCompletion) async -> MKMapItem? {
        let request = MKLocalSearch.Request(completion: completion)
        let search = MKLocalSearch(request: request)
        return (try? await search.start().mapItems.first)
    }

    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        Task { @MainActor in
            self.results = completer.results
        }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in
            self.results = []
        }
    }
}

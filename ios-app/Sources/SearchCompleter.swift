import MapKit
import Observation

// Wraps `MKLocalSearchCompleter` for instant address suggestions as the
// user types — Plans shows completions within a keystroke or two, whereas
// firing a full `MKLocalSearch` after a fixed debounce (the previous
// approach) only resolves once typing pauses. A completion is resolved into
// an `MKMapItem` (one `MKLocalSearch`) only once the user picks one. See
// §3.8 of docs/UI_UX_BASELINE.md.
@MainActor
@Observable
final class SearchCompleter: NSObject, MKLocalSearchCompleterDelegate {
    var results: [MKLocalSearchCompletion] = []
    // True between a keystroke and the completer returning results, so the UI
    // can show a spinner instead of prematurely rendering an empty "no
    // results" state (§ audit #9).
    var isSearching = false

    private let completer: MKLocalSearchCompleter

    override init() {
        completer = MKLocalSearchCompleter()
        super.init()
        completer.delegate = self
        // `.query` adds category completions ("Restaurants", "Stations-service")
        // à la Plans, on top of concrete addresses and points of interest.
        completer.resultTypes = [.address, .pointOfInterest, .query]
    }

    var queryFragment: String {
        get { completer.queryFragment }
        set {
            completer.queryFragment = newValue
            isSearching = !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
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
            self.isSearching = false
        }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        Task { @MainActor in
            self.results = []
            self.isSearching = false
        }
    }
}

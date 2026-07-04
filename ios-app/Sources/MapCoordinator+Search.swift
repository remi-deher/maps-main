import SwiftUI
import CoreLocation
import MapKit

// Search and place-selection flow, split out of MapCoordinator so the core
// coordinator stays under SwiftLint's type_body_length. Covers picking a live
// suggestion, submitting a full-text query (single or multi-result à la Plans),
// tapping a secondary result pin, and clearing the current selection.
extension MapCoordinator {
    func selectSearchSuggestion(_ completion: MKLocalSearchCompletion) {
        // A category/query completion ("Restaurants") has no located subtitle —
        // treat it as a multi-result search that drops several pins, exactly
        // like tapping a category in Plans. A concrete address/POI resolves to
        // a single place.
        if completion.subtitle.isEmpty {
            searchQuery = ""
            runTextSearch(query: completion.title)
            return
        }
        searchQuery = ""
        Task {
            guard let item = await searchCompleter.resolve(completion),
                  let coordinate = item.placemark.location?.coordinate else { return }
            await MainActor.run {
                let place = SelectedPlace(coordinate: coordinate, title: item.name ?? "Lieu", subtitle: item.placemark.title)
                searchResults = []
                rememberRecentPlace(place)
                selectedPlace = place
                // Move the camera to the result so it's actually visible on the
                // map (à la Plans), not just described in the sheet.
                focus(on: coordinate)
            }
        }
    }

    // Full-text search when the user hits the keyboard's "Rechercher" key —
    // runs the typed query and drops a pin per result, selecting the closest.
    // The live completer only offers suggestions; submitting commits to one.
    func submitSearch(session: MapSessionModel) {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        searchQuery = ""
        runTextSearch(query: query, fallbackRegionCenter: session.location.lastLocation?.coordinate)
    }

    // Shared natural-language search used by both submit and category-query
    // selection. Stores every result as a pin, selects the first, and frames
    // them all — Plans' "search a category, see them on the map" flow.
    func runTextSearch(query: String, fallbackRegionCenter: CLLocationCoordinate2D? = nil) {
        Task {
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = query
            if let region = visibleRegion {
                request.region = region
            } else if let center = fallbackRegionCenter {
                request.region = MKCoordinateRegion(center: center, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
            }
            let items = (try? await MKLocalSearch(request: request).start().mapItems) ?? []
            let places = items.prefix(12).compactMap { item -> SelectedPlace? in
                guard let coordinate = item.placemark.location?.coordinate else { return nil }
                return SelectedPlace(coordinate: coordinate, title: item.name ?? query, subtitle: item.placemark.title)
            }
            guard let first = places.first else { return }
            searchResults = Array(places)
            rememberRecentPlace(first)
            selectedPlace = first
            if places.count > 1 {
                followMode = .off
                withAnimation {
                    cameraPosition = .region(boundingRegion(for: places.map(\.coordinate)))
                }
            } else {
                focus(on: first.coordinate)
            }
        }
    }

    // Pick one pin among multi-result search markers (tapping a secondary pin).
    func selectSearchResult(_ place: SelectedPlace) {
        selectedPlace = place
        focus(on: place.coordinate)
    }

    // Clears both the selected place and any multi-result pins — used when the
    // place card is dismissed so the map returns to a clean state.
    func clearSelection() {
        selectedPlace = nil
        searchResults = []
    }
}

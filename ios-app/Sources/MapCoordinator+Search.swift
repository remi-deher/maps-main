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
        // La requête est conservée (et remplacée par l'entrée choisie) au lieu
        // d'être effacée : Plans garde le texte, ce qui permet d'affiner sa
        // saisie et de revenir à la liste de résultats en fermant la fiche.
        // Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P2-3.
        if completion.subtitle.isEmpty {
            searchQuery = completion.title
            runTextSearch(query: completion.title)
            return
        }
        searchQuery = completion.title
        Task {
            guard let item = await searchCompleter.resolve(completion),
                  let coordinate = item.placemark.location?.coordinate else { return }
            await MainActor.run {
                let place = SelectedPlace(
                    coordinate: coordinate,
                    title: item.name ?? "Lieu",
                    subtitle: item.placemark.title,
                    category: item.pointOfInterestCategory
                )
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
        runTextSearch(query: query, fallbackRegionCenter: session.location.lastLocation?.coordinate)
    }

    // Shared natural-language search used by both submit and category-query
    // selection. Stores every result as a pin, selects the first, and frames
    // them all — Plans' "search a category, see them on the map" flow.
    func runTextSearch(
        query: String,
        fallbackRegionCenter: CLLocationCoordinate2D? = nil,
        preserveCamera: Bool = false
    ) {
        Task {
            let request = MKLocalSearch.Request()
            request.naturalLanguageQuery = query
            if let region = visibleRegion {
                request.region = region
            } else if let center = fallbackRegionCenter {
                request.region = MKCoordinateRegion(center: center, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
            }
            lastSearchQuery = query
            let items = (try? await MKLocalSearch(request: request).start().mapItems) ?? []
            let places = items.prefix(12).compactMap { item -> SelectedPlace? in
                guard let coordinate = item.placemark.location?.coordinate else { return nil }
                return SelectedPlace(
                    coordinate: coordinate,
                    title: item.name ?? query,
                    subtitle: item.placemark.title,
                    category: item.pointOfInterestCategory
                )
            }
            guard let first = places.first else { return }
            searchResults = Array(places)
            // Plusieurs résultats : on montre la liste, comme Plans, au lieu
            // d'ouvrir d'office la fiche du premier — on ne les voyait sinon
            // jamais ensemble. Un résultat unique va directement à sa fiche.
            if places.count > 1 {
                selectedPlace = nil
                withAnimation { sheetDetent = .medium }
            } else {
                rememberRecentPlace(first)
                selectedPlace = first
            }
            // « Rechercher dans cette zone » ne doit pas bouger la caméra :
            // l'utilisateur vient justement de choisir ce cadrage.
            guard !preserveCamera else {
                lastSearchCenter = visibleRegion?.center ?? fallbackRegionCenter
                return
            }
            // Le centre de référence est celui où la caméra *atterrit*, pas
            // celui d'avant la recherche : sinon le cadrage automatique des
            // résultats suffirait à faire apparaître « Rechercher dans cette
            // zone » dans la seconde qui suit.
            if places.count > 1 {
                let region = boundingRegion(for: places.map(\.coordinate))
                lastSearchCenter = region.center
                followMode = .off
                withAnimation {
                    cameraPosition = .region(region)
                }
            } else {
                lastSearchCenter = regionCenteringAboveSheet(
                    on: first.coordinate,
                    latitudinalMeters: 800
                ).center
                focus(on: first.coordinate)
            }
        }
    }

    // Pick one pin among multi-result search markers (tapping a secondary pin).
    func selectSearchResult(_ place: SelectedPlace) {
        selectedPlace = place
        rememberRecentPlace(place)
        focus(on: place.coordinate)
    }

    // Fermeture de la fiche : on revient à la liste de résultats quand il y en
    // a une, au lieu de tout effacer — c'est le retour arrière de Plans.
    func dismissSelectedPlace() {
        if searchResults.count > 1 {
            selectedPlace = nil
        } else {
            clearSelection()
        }
    }

    // Vrai quand une recherche a déjà tourné et que la carte s'est assez
    // éloignée du cadrage d'alors pour qu'une relance ait du sens — le seuil
    // est une fraction de la hauteur visible, donc il s'adapte au zoom.
    var canSearchVisibleArea: Bool {
        guard lastSearchQuery != nil,
              let lastSearchCenter,
              let region = visibleRegion else { return false }
        let latitudeDrift = abs(region.center.latitude - lastSearchCenter.latitude)
        let longitudeDrift = abs(region.center.longitude - lastSearchCenter.longitude)
        return latitudeDrift > region.span.latitudeDelta * 0.35
            || longitudeDrift > region.span.longitudeDelta * 0.35
    }

    // Relance la dernière requête sur la zone actuellement visible.
    func searchVisibleArea() {
        guard let lastSearchQuery else { return }
        runTextSearch(query: lastSearchQuery, preserveCamera: true)
    }

    // Rang (1-based) du lieu affiché dans le jeu de résultats courant, nil
    // quand le lieu ne vient pas d'une recherche multi-résultats.
    var selectedResultPosition: Int? {
        guard let selectedPlace, searchResults.count > 1,
              let index = searchResults.firstIndex(where: { $0.mapID == selectedPlace.mapID }) else { return nil }
        return index + 1
    }

    // Passe au résultat précédent/suivant sans repasser par la liste — Plans
    // laisse balayer les résultats d'une recherche de la même façon.
    func stepSearchResult(by offset: Int) {
        guard let selectedPlace,
              let index = searchResults.firstIndex(where: { $0.mapID == selectedPlace.mapID }) else { return }
        let target = index + offset
        guard searchResults.indices.contains(target) else { return }
        selectSearchResult(searchResults[target])
    }

    // Clears both the selected place and any multi-result pins — used when the
    // place card is dismissed so the map returns to a clean state.
    func clearSelection() {
        selectedPlace = nil
        searchResults = []
        // Plus de résultats à l'écran : « Rechercher dans cette zone » n'a plus
        // de requête à relancer.
        lastSearchQuery = nil
        lastSearchCenter = nil
    }
}

import SwiftUI
import MapKit

// The three map looks offered by the style picker, mirroring Plans' layers
// button (plan / satellite / hybride). Raw values are persisted via
// @AppStorage in ContentView.
enum MapStyleChoice: String, CaseIterable, Identifiable {
    case standard
    case hybrid
    case imagery

    var id: String { rawValue }

    var label: String {
        switch self {
        case .standard: return "Plan"
        case .hybrid: return "Hybride"
        case .imagery: return "Satellite"
        }
    }

    var symbol: String {
        switch self {
        case .standard: return "map"
        case .hybrid: return "map.fill"
        case .imagery: return "globe.americas.fill"
        }
    }

    // Le trafic est un réglage du menu calques dans Plans, pas un style à
    // part — d'où le paramètre plutôt qu'un quatrième cas.
    func mapStyle(showsTraffic: Bool) -> MapStyle {
        switch self {
        case .standard: return .standard(elevation: .realistic, showsTraffic: showsTraffic)
        case .hybrid: return .hybrid(elevation: .realistic, showsTraffic: showsTraffic)
        case .imagery: return .imagery(elevation: .realistic)
        }
    }
}

// Full-screen map (à la Plans) using SwiftUI's native Map API: the device's
// real position (blue dot, via UserAnnotation), the engine's currently
// spoofed position as a marker, and the active route preview as a polyline.
// Long-pressing anywhere reports the coordinate so the caller can offer the
// same action menu as a search result (teleport, itinerary, favorite...) —
// like Plans' map-drop-pin gesture, not a plain tap (which is reserved for
// dismissing the keyboard/panning without side effects).
struct EngineMapView: View {
    var spoofedLocation: CLLocationCoordinate2D?
    // The place currently selected from search / a tapped POI / a long-press.
    // Rendered as a red pin (à la Plans) so the result is visible on the map,
    // not only described in the sheet.
    var selectedPlace: SelectedPlace?
    // Additional pins from a multi-result category search; tapping one selects
    // it. The currently selected place is drawn separately (red), so it's
    // filtered out here to avoid a double pin.
    var searchResults: [SelectedPlace] = []
    var onSelectSearchResult: (SelectedPlace) -> Void = { _ in }
    var routePreview: [CLLocationCoordinate2D]
    // Variantes de trajet non retenues, dessinées en gris derrière le tracé
    // choisi — c'est ainsi que Plans montre les alternatives.
    var alternativeRoutes: [[CLLocationCoordinate2D]] = []
    var itineraryStops: [RouteStop]
    var patrolZone: PatrolZone?
    // Dashed live preview drawn while the user is defining a circle patrol in
    // the sheet — lets them see the zone grow on the map as they drag the
    // radius, instead of committing blind. Only circles preview: a rectangle
    // zone is the visible region, which is already what's on screen.
    var patrolPreview: (center: CLLocationCoordinate2D, radius: Double)?
    var mapStyleChoice: MapStyleChoice = .standard
    var showsTraffic: Bool = true
    // System POI selection (restaurants, shops…). Binding so tapping a
    // built-in map feature surfaces it to ContentView, which turns it into
    // the same SelectedPlace a long-press produces — Plans' tap-a-POI flow.
    @Binding var selectedFeature: MapFeature?
    @Binding var cameraPosition: MapCameraPosition
    var onLongPress: (CLLocationCoordinate2D) -> Void
    // Tap « à vide » sur la carte : ferme la fiche lieu et replie la sheet,
    // comme Plans. Le tap sur un POI passe par `selectedFeature` et est filtré
    // côté appelant, qui compare la sélection avant/après.
    var onTap: () -> Void = {}
    var onRegionChange: (MKCoordinateRegion) -> Void = { _ in }
    // Fraction de la hauteur de carte couverte par la bottom sheet au repos.
    // Elle est reportée en safe area basse de la `Map` : MapKit y place le logo
    // Apple et le lien « Légal » (obligation des conditions MapKit), ainsi que
    // la boussole et l'échelle. Sans cet inset la sheet les recouvre en
    // permanence. Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P0-5.
    var sheetCoverage: CGFloat = 0

    @State private var longPressFeedback = 0

    // Multi-result pins minus the one currently selected (drawn as the red
    // Marker), so the selected place isn't rendered twice.
    private var secondarySearchResults: [SelectedPlace] {
        guard let selectedPlace else { return searchResults }
        return searchResults.filter { $0.mapID != selectedPlace.mapID }
    }

    var body: some View {
        GeometryReader { geometry in
            mapContent(availableHeight: geometry.size.height)
        }
    }

    private func mapContent(availableHeight: CGFloat) -> some View {
        MapReader { proxy in
            Map(position: $cameraPosition, selection: $selectedFeature) {
                UserAnnotation()
                ForEach(secondarySearchResults, id: \.mapID) { result in
                    Annotation(result.title, coordinate: result.coordinate) {
                        Button {
                            onSelectSearchResult(result)
                        } label: {
                            PointOfInterestPin(category: result.category, isSelected: false)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(result.title)
                    }
                }
                if let selectedPlace {
                    // Pastille colorée par catégorie plutôt qu'un `Marker`
                    // rouge uniforme : c'est la lecture de carte de Plans, où
                    // la couleur dit le type de lieu avant même le libellé.
                    Annotation(selectedPlace.title, coordinate: selectedPlace.coordinate) {
                        PointOfInterestPin(category: selectedPlace.category, isSelected: true)
                    }
                }
                if let spoofed = spoofedLocation {
                    // Custom annotation instead of Marker: Marker's
                    // permanently visible text label gets noisy once drift
                    // is small and it overlaps the blue dot — a pulsing ring
                    // distinguishes the spoofed position actively instead.
                    // The title is kept for VoiceOver, not shown on screen.
                    // See §3.13 of docs/UI_UX_BASELINE.md.
                    Annotation("Position simulée", coordinate: spoofed) {
                        SpoofedLocationMarker()
                    }
                }
                ForEach(Array(alternativeRoutes.enumerated()), id: \.offset) { _, path in
                    MapPolyline(coordinates: path)
                        .stroke(Color.secondary.opacity(0.55), lineWidth: 5)
                }
                if routePreview.count > 1 {
                    MapPolyline(coordinates: routePreview)
                        .stroke(Color.accentColor, lineWidth: 4)
                }
                ForEach(Array(itineraryStops.enumerated()), id: \.element.id) { index, stop in
                    Annotation(stop.name, coordinate: stop.coordinate) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(Color.accentColor, in: Circle())
                    }
                }
                if let zone = patrolZone, zone.active {
                    patrolOverlay(for: zone)
                }
                if let preview = patrolPreview {
                    MapCircle(center: preview.center, radius: preview.radius)
                        .foregroundStyle(Color.accentColor.opacity(0.12))
                        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                }
            }
            .mapStyle(mapStyleChoice.mapStyle(showsTraffic: showsTraffic))
            .onMapCameraChange { context in
                onRegionChange(context.region)
            }
            // .onTapGesture on Map is broken in iOS 26 (confirmed regression in
            // Apple's release notes), and we want a long-press anyway, not a
            // tap — sequencing LongPressGesture before a zero-distance
            // DragGesture is the standard way to recover a tap-equivalent
            // location once the press succeeds (see swiftui-gestures skill).
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.5)
                    .sequenced(before: DragGesture(minimumDistance: 0))
                    .onEnded { value in
                        guard case .second(true, let drag?) = value,
                              let coordinate = proxy.convert(drag.location, from: .local) else { return }
                        longPressFeedback += 1
                        onLongPress(coordinate)
                    }
            )
            .simultaneousGesture(TapGesture().onEnded { onTap() })
            .sensoryFeedback(.success, trigger: longPressFeedback)
            // Plafonné : au détent `large` la sheet couvre presque tout, et
            // réserver autant écraserait la carte au lieu de dégager
            // l'attribution.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear
                    .frame(height: min(max(sheetCoverage, 0), 0.45) * availableHeight)
            }
        }
    }

    @MapContentBuilder
    private func patrolOverlay(for zone: PatrolZone) -> some MapContent {
        if zone.type == "rectangle", let bounds = zone.bounds {
            let southWest = CLLocationCoordinate2D(latitude: bounds.southWest.lat, longitude: bounds.southWest.lon)
            let northEast = CLLocationCoordinate2D(latitude: bounds.northEast.lat, longitude: bounds.northEast.lon)
            let northWest = CLLocationCoordinate2D(latitude: northEast.latitude, longitude: southWest.longitude)
            let southEast = CLLocationCoordinate2D(latitude: southWest.latitude, longitude: northEast.longitude)
            MapPolygon(coordinates: [southWest, southEast, northEast, northWest])
                .foregroundStyle(Color.accentColor.opacity(0.15))
                .stroke(Color.accentColor, lineWidth: 2)
        } else if let center = zone.center, let radius = zone.radius {
            MapCircle(center: CLLocationCoordinate2D(latitude: center.lat, longitude: center.lon), radius: radius)
                .foregroundStyle(Color.accentColor.opacity(0.15))
                .stroke(Color.accentColor, lineWidth: 2)
        }
    }
}

// Pastille de point d'intérêt façon Plans : rond coloré selon la catégorie,
// symbole blanc au centre, anneau blanc. La version sélectionnée est plus
// grande et porte une ombre, pour se détacher des autres résultats.
private struct PointOfInterestPin: View {
    let category: MKPointOfInterestCategory?
    let isSelected: Bool

    private var appearance: PointOfInterestStyle.Appearance {
        PointOfInterestStyle.appearance(for: category)
    }

    private var diameter: CGFloat { isSelected ? 34 : 26 }

    // Tailles fixes assumées : une épingle n'est pas du texte, et la faire
    // grossir avec le Dynamic Type couvrirait la carte au lieu de l'annoter.
    // Même parti pris que `SpoofedLocationMarker`.
    var body: some View {
        Image(systemName: appearance.symbol)
            .font(.system(size: isSelected ? 16 : 12, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: diameter, height: diameter)
            .background(appearance.color, in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: isSelected ? 3 : 2))
            .shadow(color: .black.opacity(isSelected ? 0.3 : 0), radius: 4, y: 2)
    }
}

// Pulsing indigo dot with a white ring, used in place of `Marker` for the
// spoofed position so it stays visually distinct from the system blue dot
// even when drift is near zero and the two would otherwise sit on top of
// each other.
private struct SpoofedLocationMarker: View {
    @State private var isPulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.accentColor.opacity(0.25))
                .frame(width: 36, height: 36)
                .scaleEffect(isPulsing ? 1 : 0.5)
                .opacity(isPulsing ? 0 : 1)
            Circle()
                .strokeBorder(.white, lineWidth: 2)
                .background(Circle().fill(Color.accentColor))
                .frame(width: 16, height: 16)
        }
        .accessibilityHidden(true)
        .onAppear {
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                isPulsing = true
            }
        }
    }
}

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

    var mapStyle: MapStyle {
        switch self {
        case .standard: return .standard(elevation: .realistic)
        case .hybrid: return .hybrid(elevation: .realistic)
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
    var routePreview: [CLLocationCoordinate2D]
    var itineraryStops: [RouteStop]
    var patrolZone: PatrolZone?
    // Dashed live preview drawn while the user is defining a circle patrol in
    // the sheet — lets them see the zone grow on the map as they drag the
    // radius, instead of committing blind. Only circles preview: a rectangle
    // zone is the visible region, which is already what's on screen.
    var patrolPreview: (center: CLLocationCoordinate2D, radius: Double)?
    var mapStyleChoice: MapStyleChoice = .standard
    // System POI selection (restaurants, shops…). Binding so tapping a
    // built-in map feature surfaces it to ContentView, which turns it into
    // the same SelectedPlace a long-press produces — Plans' tap-a-POI flow.
    @Binding var selectedFeature: MapFeature?
    @Binding var cameraPosition: MapCameraPosition
    var onLongPress: (CLLocationCoordinate2D) -> Void
    var onRegionChange: (MKCoordinateRegion) -> Void = { _ in }

    @State private var longPressFeedback = 0

    var body: some View {
        MapReader { proxy in
            Map(position: $cameraPosition, selection: $selectedFeature) {
                UserAnnotation()
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
            .mapStyle(mapStyleChoice.mapStyle)
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
            .sensoryFeedback(.success, trigger: longPressFeedback)
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

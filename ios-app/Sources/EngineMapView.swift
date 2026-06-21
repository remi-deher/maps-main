import SwiftUI
import MapKit

/// Full-screen map (à la Plans) using SwiftUI's native Map API: the device's
/// real position (blue dot, via UserAnnotation), the engine's currently
/// spoofed position as a marker, and the active route preview as a polyline.
/// Long-pressing anywhere reports the coordinate so the caller can offer the
/// same action menu as a search result (teleport, itinerary, favorite...) —
/// like Plans' map-drop-pin gesture, not a plain tap (which is reserved for
/// dismissing the keyboard/panning without side effects).
struct EngineMapView: View {
    var spoofedLocation: CLLocationCoordinate2D?
    var routePreview: [CLLocationCoordinate2D]
    var itineraryStops: [RouteStop]
    @Binding var cameraPosition: MapCameraPosition
    var onLongPress: (CLLocationCoordinate2D) -> Void

    @State private var longPressFeedback = 0

    var body: some View {
        MapReader { proxy in
            Map(position: $cameraPosition) {
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
                        .stroke(.accentColor, lineWidth: 4)
                }
                ForEach(Array(itineraryStops.enumerated()), id: \.element.id) { index, stop in
                    Annotation(stop.name, coordinate: stop.coordinate) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(.accentColor, in: Circle())
                    }
                }
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
}

/// Pulsing indigo dot with a white ring, used in place of `Marker` for the
/// spoofed position so it stays visually distinct from the system blue dot
/// even when drift is near zero and the two would otherwise sit on top of
/// each other.
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

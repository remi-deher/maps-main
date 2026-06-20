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
                    Marker("Position simulée", systemImage: "location.fill", coordinate: spoofed)
                        .tint(.indigo)
                }
                if routePreview.count > 1 {
                    MapPolyline(coordinates: routePreview)
                        .stroke(.indigo, lineWidth: 4)
                }
                ForEach(Array(itineraryStops.enumerated()), id: \.element.id) { index, stop in
                    Annotation(stop.name, coordinate: stop.coordinate) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(width: 24, height: 24)
                            .background(.indigo, in: Circle())
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

import SwiftUI
import MapKit

/// Full-screen map (à la Plans) using SwiftUI's native Map API: the device's
/// real position (blue dot, via UserAnnotation), the engine's currently
/// spoofed position as a marker, and the active route preview as a polyline.
/// Tapping anywhere reports the coordinate so the caller can offer to
/// teleport, start a route, or save a favorite there.
struct EngineMapView: View {
    var spoofedLocation: CLLocationCoordinate2D?
    var routePreview: [CLLocationCoordinate2D]
    @Binding var cameraPosition: MapCameraPosition
    var onTap: (CLLocationCoordinate2D) -> Void

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
            }
            // .onTapGesture on Map is broken in iOS 26 (confirmed regression in
            // Apple's release notes) — SpatialTapGesture is the documented
            // workaround to still get a tap location to convert.
            .simultaneousGesture(
                SpatialTapGesture().onEnded { value in
                    guard let coordinate = proxy.convert(value.location, from: .local) else { return }
                    onTap(coordinate)
                }
            )
        }
    }
}

import SwiftUI
import MapKit

/// Full-screen map (à la Plans) using SwiftUI's native Map API: the device's
/// real position (blue dot, via UserAnnotation) and the engine's currently
/// spoofed position as a marker. Tapping anywhere reports the coordinate so
/// the caller can offer to teleport, start a route, or save a favorite there.
struct EngineMapView: View {
    var spoofedLocation: CLLocationCoordinate2D?
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

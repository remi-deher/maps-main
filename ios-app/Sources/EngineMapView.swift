import SwiftUI
import MapKit

/// A one-shot "move the camera here" request. Wrapped with an id so
/// updateUIView can tell a brand new request apart from the same coordinate
/// being passed again on an unrelated re-render (CLLocationCoordinate2D
/// itself isn't Equatable).
struct MapFocusRequest {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
}

/// Full-screen map (à la Plans) showing the device's real position (the blue
/// dot, via showsUserLocation) and the engine's currently spoofed position as
/// a pin. Tapping anywhere reports the coordinate so the caller can offer to
/// teleport, start a route, or save a favorite there.
struct EngineMapView: UIViewRepresentable {
    var spoofedLocation: CLLocationCoordinate2D?
    var focusRequest: MapFocusRequest?
    var onTap: (CLLocationCoordinate2D) -> Void

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.showsUserLocation = true
        map.delegate = context.coordinator

        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        map.addGestureRecognizer(tap)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self

        map.annotations
            .filter { !($0 is MKUserLocation) }
            .forEach { map.removeAnnotation($0) }

        if let spoofed = spoofedLocation {
            let pin = MKPointAnnotation()
            pin.coordinate = spoofed
            pin.title = "Position simulée"
            map.addAnnotation(pin)
        }

        if let focus = focusRequest, focus.id != context.coordinator.lastFocusID {
            context.coordinator.lastFocusID = focus.id
            let region = MKCoordinateRegion(center: focus.coordinate, latitudinalMeters: 800, longitudinalMeters: 800)
            map.setRegion(region, animated: true)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: EngineMapView
        var lastFocusID: UUID?

        init(_ parent: EngineMapView) {
            self.parent = parent
        }

        @objc func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let map = gesture.view as? MKMapView else { return }
            let point = gesture.location(in: map)
            let coordinate = map.convert(point, toCoordinateFrom: map)
            parent.onTap(coordinate)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard !(annotation is MKUserLocation) else { return nil }
            let view = MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "spoofed-location")
            view.markerTintColor = .systemIndigo
            view.glyphImage = UIImage(systemName: "location.fill")
            return view
        }
    }
}

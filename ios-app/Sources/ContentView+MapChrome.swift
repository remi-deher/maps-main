import SwiftUI
import CoreLocation
import MapKit
import TipKit

extension ContentView {
    var mapStyleChoice: MapStyleChoice {
        MapStyleChoice(rawValue: mapStyleChoiceRaw) ?? .standard
    }

    /// Plans-style layers control: a glass capsule menu to switch the map look
    /// (plan/satellite/hybride). Lives in the same GlassEffectContainer as the
    /// recenter button so the two share one lensing pass.
    var mapStyleMenu: some View {
        Menu {
            Picker("Style de carte", selection: $mapStyleChoiceRaw) {
                ForEach(MapStyleChoice.allCases) { choice in
                    Label(choice.label, systemImage: choice.symbol).tag(choice.rawValue)
                }
            }
        } label: {
            Label("Style de carte", systemImage: mapStyleChoice.symbol)
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Style de carte")
    }

    var mapPitchButton: some View {
        Button(action: toggleMapPitch) {
            Text(isMapTilted ? "2D" : "3D")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(isMapTilted ? "Revenir en vue 2D" : "Passer en vue 3D")
    }

    @ViewBuilder
    func mapChrome(safeArea: EdgeInsets, availableHeight: CGFloat) -> some View {
        let bottomPadding = mapControlsBottomPadding(
            safeArea: safeArea,
            availableHeight: availableHeight
        )

        GlassEffectContainer(spacing: 12) {
            VStack(alignment: .trailing, spacing: 10) {
                TipView(MapLongPressTip(), arrowEdge: .top)
                    .frame(maxWidth: 280)
                Spacer()
            }
            .padding(.top, max(safeArea.top + 8, 8))
            .padding(.trailing, max(safeArea.trailing + 16, 16))

            HStack {
                Spacer()
                VStack(spacing: 10) {
                    mapPitchButton
                    mapStyleMenu
                    RecenterButton(onTap: recenterOnUser)
                }
            }
            .padding(.trailing, max(safeArea.trailing + 16, 16))
            .padding(.bottom, bottomPadding)
            .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.88), value: bottomPadding)
        }
    }

    func mapControlsBottomPadding(safeArea: EdgeInsets, availableHeight: CGFloat) -> CGFloat {
        let desiredPadding = sheetVisibleHeight + 18
        let deadzoneFloor = safeArea.bottom + 24
        let topLimit = max(120, availableHeight - safeArea.top - 150)
        return min(max(desiredPadding, deadzoneFloor), topLimit)
    }

    func recenterOnUser() {
        withAnimation {
            cameraPosition = .userLocation(fallback: .automatic)
            isMapTilted = false
        }
    }

    func toggleMapPitch() {
        guard let visibleRegion = visibleRegion else {
            recenterOnUser()
            return
        }

        withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.88)) {
            if isMapTilted {
                cameraPosition = .region(visibleRegion)
                isMapTilted = false
            } else {
                cameraPosition = .camera(
                    MapCamera(
                        centerCoordinate: visibleRegion.center,
                        distance: cameraDistance(for: visibleRegion),
                        heading: 0,
                        pitch: 55
                    )
                )
                isMapTilted = true
            }
        }
    }

    func cameraDistance(for region: MKCoordinateRegion) -> CLLocationDistance {
        let latitudeMeters = region.span.latitudeDelta * 111_000
        let longitudeMeters = region.span.longitudeDelta * 111_000
        return max(700, min(max(latitudeMeters, longitudeMeters) * 1.25, 25_000))
    }
}

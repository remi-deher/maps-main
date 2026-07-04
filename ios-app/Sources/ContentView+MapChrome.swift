import SwiftUI
import CoreLocation
import MapKit
import TipKit

extension ContentView {
    var mapStyleChoice: MapStyleChoice {
        MapStyleChoice(rawValue: mapStyleChoiceRaw) ?? .standard
    }

    // Plans-style layers control: a glass capsule menu to switch the map look
    // (plan/satellite/hybride). Lives in the same GlassEffectContainer as the
    // recenter button so the two share one lensing pass.
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
        Button(
            action: { toggleMapPitch() },
            label: {
                Text(coordinator.isMapTilted ? "2D" : "3D")
                    .font(.subheadline.weight(.bold))
                    .monospacedDigit()
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
        )
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(coordinator.isMapTilted ? "Revenir en vue 2D" : "Passer en vue 3D")
    }

    @ViewBuilder
    func mapChrome(safeArea: EdgeInsets, availableHeight: CGFloat) -> some View {
        let bottomPadding = mapControlsBottomPadding(
            safeArea: safeArea,
            availableHeight: availableHeight
        )
        let isHiddenForKeyboard = searchFocused

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
                    RecenterButton(
                        systemImage: recenterIconName,
                        isActive: coordinator.followMode != .off,
                        onTap: recenterOnUser
                    )
                }
            }
            .padding(.trailing, max(safeArea.trailing + 16, 16))
            .padding(.bottom, bottomPadding)
            .opacity(isHiddenForKeyboard ? 0 : 1)
            .scaleEffect(isHiddenForKeyboard ? 0.96 : 1, anchor: .bottomTrailing)
            .allowsHitTesting(!isHiddenForKeyboard)
            .accessibilityHidden(isHiddenForKeyboard)
            .animation(.interactiveSpring(response: 0.28, dampingFraction: 0.88), value: bottomPadding)
            .animation(.easeOut(duration: 0.12), value: isHiddenForKeyboard)
        }
    }

    func mapControlsBottomPadding(safeArea: EdgeInsets, availableHeight: CGFloat) -> CGFloat {
        let desiredPadding = restingSheetVisibleHeight(availableHeight: availableHeight) + 18
        let deadzoneFloor = safeArea.bottom + 24
        let topLimit = max(120, availableHeight - safeArea.top - 150)
        return min(max(desiredPadding, deadzoneFloor), topLimit)
    }

    func restingSheetVisibleHeight(availableHeight: CGFloat) -> CGFloat {
        switch coordinator.sheetDetent {
        case .collapsed:
            return collapsedPresentationDetentHeight
        case .medium:
            return availableHeight * 0.43
        case .large:
            return availableHeight * 0.92
        }
    }

    var recenterIconName: String {
        switch coordinator.followMode {
        case .off: return "location"
        case .following: return "location.fill"
        case .heading: return "location.north.line.fill"
        }
    }

    // Cycles the follow mode à la Plans: a first tap recenters and tracks the
    // user; a second tap adds heading (map rotates to face travel); a third
    // drops back to plain tracking. Panning the map elsewhere resets to `.off`
    // via the programmatic-move sites in MapCoordinator.
    func recenterOnUser() {
        withAnimation {
            switch coordinator.followMode {
            case .off:
                coordinator.followMode = .following
                coordinator.cameraPosition = .userLocation(fallback: .automatic)
            case .following:
                coordinator.followMode = .heading
                coordinator.cameraPosition = .userLocation(followsHeading: true, fallback: .automatic)
            case .heading:
                coordinator.followMode = .following
                coordinator.cameraPosition = .userLocation(fallback: .automatic)
            }
            coordinator.isMapTilted = false
        }
    }

    func toggleMapPitch() {
        guard let visibleRegion = coordinator.visibleRegion else {
            recenterOnUser()
            return
        }

        coordinator.followMode = .off
        withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.88)) {
            if coordinator.isMapTilted {
                coordinator.cameraPosition = .region(visibleRegion)
                coordinator.isMapTilted = false
            } else {
                coordinator.cameraPosition = .camera(
                    MapCamera(
                        centerCoordinate: visibleRegion.center,
                        distance: cameraDistance(for: visibleRegion),
                        heading: 0,
                        pitch: 55
                    )
                )
                coordinator.isMapTilted = true
            }
        }
    }

    func cameraDistance(for region: MKCoordinateRegion) -> CLLocationDistance {
        let latitudeMeters = region.span.latitudeDelta * 111_000
        let longitudeMeters = region.span.longitudeDelta * 111_000
        return max(700, min(max(latitudeMeters, longitudeMeters) * 1.25, 25_000))
    }
}

import SwiftUI

// Floating glass button (bottom-trailing, à la Plans) that cycles the map's
// follow mode. The icon reflects the current mode (off / following / heading)
// and tints when active, like Plans' tracking button.
struct RecenterButton: View {
    var systemImage: String = "location.fill"
    var isActive: Bool = false
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Label("Recentrer sur ma position", systemImage: systemImage)
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .foregroundStyle(isActive ? Color.accentColor : Color.primary)
                .frame(width: 46, height: 46)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel("Recentrer sur ma position")
        .accessibilityValue(isActive ? "Suivi actif" : "Suivi inactif")
    }
}

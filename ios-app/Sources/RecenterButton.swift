import SwiftUI

/// Floating glass button (bottom-trailing, à la Plans) that recenters the
/// camera on the device's real position.
struct RecenterButton: View {
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Label("Recentrer sur ma position", systemImage: "location.fill")
                .labelStyle(.iconOnly)
                .font(.title3.weight(.semibold))
                .frame(width: 46, height: 46)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
    }
}

import SwiftUI

/// Floating glass button (bottom-trailing, à la Plans) that recenters the
/// camera on the device's real position.
struct RecenterButton: View {
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Image(systemName: "location.fill")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 46, height: 46)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .clipShape(Circle())
    }
}

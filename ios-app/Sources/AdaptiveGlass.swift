import SwiftUI

/// Wraps `.glassEffect` with a `.accessibilityReduceTransparency` fallback —
/// when the user has that setting on, the system expects an opaque
/// background instead of a translucent material (§3.20 of
/// docs/UI_UX_BASELINE.md). Shape is `RoundedRectangle(cornerRadius:)` to
/// cover every floating-card use site in this app; the capsule omnibar uses
/// `Capsule()` via `cornerRadius: .infinity`-equivalent at the call site
/// instead, see `BottomSheet.header`.
struct AdaptiveGlassBackground<S: Shape>: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let shape: S

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(.systemBackground), in: shape)
        } else {
            content.glassEffect(.regular, in: shape)
        }
    }
}

extension View {
    func adaptiveGlassEffect<S: Shape>(in shape: S) -> some View {
        modifier(AdaptiveGlassBackground(shape: shape))
    }
}

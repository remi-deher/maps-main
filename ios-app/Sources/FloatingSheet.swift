import SwiftUI

/// The three resting heights of the bottom panel, replacing the system sheet's
/// `presentationDetents`.
enum SheetDetent: CaseIterable, Equatable {
    case collapsed  // just the search capsule
    case medium     // ~half screen — results / itinerary / place card
    case large      // ~full screen
}

/// Inline, bottom-anchored glass panel that replaces the persistent
/// `.sheet(isPresented: .constant(true))` (§3.11 Option B of
/// docs/UI_UX_BASELINE.md). Its height snaps between three detents via a
/// full-panel drag while the map stays fully interactive behind it — the technique
/// Plans actually uses, instead of a system sheet presented through the
/// `.constant(true)` hack (which also forced Settings to stack as a nested
/// sheet). Settings can now be a normal single `.sheet` on the root.
///
/// ON-DEVICE TUNING (could not be verified without a simulator):
///   - keyboard avoidance when the search field is focused,
///   - the exact medium/large fractions and the spring feel,
///   - how the full-panel drag arbitrates with long scrollable content.
struct FloatingSheet<Content: View>: View {
    @Binding var detent: SheetDetent
    /// Measured height of the panel's collapsed content (the search capsule),
    /// reported by the content via its header preference.
    let collapsedContentHeight: CGFloat
    /// Height available to the panel (the map's full height, from a
    /// GeometryReader in the parent).
    let availableHeight: CGFloat
    @ViewBuilder var content: () -> Content

    /// Live finger offset during a drag (positive = taller). Reset to 0 on
    /// release, when `detent` takes over.
    @State private var dragOffset: CGFloat = 0

    /// Vertical space the drag handle occupies above the content.
    private let handleAreaHeight: CGFloat = 18
    private let horizontalInset: CGFloat = 10
    private let bottomInset: CGFloat = 8
    private let cornerRadius: CGFloat = 28

    private func height(for detent: SheetDetent) -> CGFloat {
        switch detent {
        case .collapsed: return collapsedContentHeight + handleAreaHeight
        case .medium: return availableHeight * 0.5
        case .large: return availableHeight * 0.92
        }
    }

    private var minHeight: CGFloat { height(for: .collapsed) }
    private var maxHeight: CGFloat { height(for: .large) }

    private var resolvedHeight: CGFloat {
        min(max(height(for: detent) + dragOffset, minHeight), maxHeight)
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(.secondary.opacity(0.72))
                .frame(width: 38, height: 5)
                .padding(.top, 9)
                .padding(.bottom, 4)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .accessibilityLabel("Poignée du panneau")
                .accessibilityHint("Faites glisser pour agrandir ou réduire")
                .accessibilityAddTraits(.isButton)

            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(height: resolvedHeight, alignment: .top)
        .frame(maxWidth: .infinity)
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .simultaneousGesture(dragGesture)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(0.16), radius: 24, x: 0, y: 12)
        .padding(.horizontal, horizontalInset)
        .padding(.bottom, bottomInset)
        .sensoryFeedback(.selection, trigger: detent)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                guard abs(value.translation.height) >= abs(value.translation.width) else { return }
                dragOffset = -value.translation.height
            }
            .onEnded { value in
                guard abs(value.predictedEndTranslation.height) >= abs(value.predictedEndTranslation.width) else {
                    withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.85)) {
                        dragOffset = 0
                    }
                    return
                }
                let projected = height(for: detent) - value.predictedEndTranslation.height
                let target = nearestDetent(to: projected)
                withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.85)) {
                    dragOffset = 0
                    detent = target
                }
            }
    }

    private func nearestDetent(to target: CGFloat) -> SheetDetent {
        SheetDetent.allCases
            .map { ($0, height(for: $0)) }
            .min(by: { abs($0.1 - target) < abs($1.1 - target) })?
            .0 ?? .collapsed
    }
}

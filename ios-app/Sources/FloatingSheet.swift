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
    @State private var scrollOffset: CGFloat = 0
    /// Measured height of the panel's collapsed content (the search capsule),
    /// reported by the content via its header preference.
    let collapsedContentHeight: CGFloat
    /// Height available to the panel (the map's full height, from a
    /// GeometryReader in the parent).
    let availableHeight: CGFloat
    var onHeightChange: (CGFloat) -> Void = { _ in }
    @ViewBuilder var content: (Binding<CGFloat>) -> Content

    init(
        detent: Binding<SheetDetent>,
        collapsedContentHeight: CGFloat,
        availableHeight: CGFloat,
        onHeightChange: @escaping (CGFloat) -> Void = { _ in },
        @ViewBuilder content: @escaping (Binding<CGFloat>) -> Content
    ) {
        self._detent = detent
        self.collapsedContentHeight = collapsedContentHeight
        self.availableHeight = availableHeight
        self.onHeightChange = onHeightChange
        self.content = content
    }

    /// Live finger offset during a drag (positive = taller). Reset to 0 on
    /// release, when `detent` takes over.
    @State private var dragOffset: CGFloat = 0

    @State private var dragDirectionDetermined = false
    @State private var isDraggingVertically = false
    @State private var dragStartedInHeader = false

    /// Vertical space the drag handle occupies above the content.
    private let handleAreaHeight: CGFloat = 14
    private let horizontalInset: CGFloat = 8
    private let bottomInset: CGFloat = 8
    private let cornerRadius: CGFloat = 26

    private func height(for detent: SheetDetent) -> CGFloat {
        switch detent {
        case .collapsed: return collapsedContentHeight + handleAreaHeight
        case .medium: return availableHeight * 0.43
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
                .frame(width: 36, height: 5)
                .padding(.top, 6)
                .padding(.bottom, 3)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .accessibilityLabel("Poignée du panneau")
                .accessibilityHint("Faites glisser pour agrandir ou réduire")
                .accessibilityAddTraits(.isButton)

            content($scrollOffset)
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
        .onAppear { onHeightChange(height(for: detent) + bottomInset) }
        .onChange(of: detent) { newDetent in
            onHeightChange(height(for: newDetent) + bottomInset)
        }
        .onChange(of: collapsedContentHeight) { newHeight in
            onHeightChange(height(for: detent) + bottomInset)
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                if !dragDirectionDetermined {
                    let headerHeight = collapsedContentHeight + handleAreaHeight
                    let isDraggingDown = value.translation.height > 0
                    let isAtTop = scrollOffset >= -1
                    let canDragInContent = isDraggingDown && isAtTop
                    dragStartedInHeader = (detent != .large) || (value.startLocation.y <= headerHeight) || canDragInContent

                    let horizontalAmount = abs(value.translation.width)
                    let verticalAmount = abs(value.translation.height)
                    if horizontalAmount > 2 || verticalAmount > 2 {
                        isDraggingVertically = verticalAmount > horizontalAmount
                        dragDirectionDetermined = true
                    }
                }

                guard dragStartedInHeader && isDraggingVertically else { return }

                if detent == .large {
                    let isDraggingDown = value.translation.height > 0
                    let isAtTop = scrollOffset >= -1
                    if isDraggingDown && !isAtTop {
                        return
                    }
                }

                dragOffset = -value.translation.height
            }
            .onEnded { value in
                let wasDragging = dragStartedInHeader && isDraggingVertically

                // Reset state immediately
                dragDirectionDetermined = false
                isDraggingVertically = false
                dragStartedInHeader = false

                guard wasDragging else { return }

                guard abs(value.predictedEndTranslation.height) >= abs(value.predictedEndTranslation.width) else {
                    withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.85)) {
                        dragOffset = 0
                    }
                    return
                }
                let projected = height(for: detent) - value.predictedEndTranslation.height
                let target = targetDetent(
                    projectedHeight: projected,
                    translation: value.translation.height,
                    predictedTranslation: value.predictedEndTranslation.height
                )
                withAnimation(.interactiveSpring(response: 0.28, dampingFraction: 0.88)) {
                    dragOffset = 0
                    detent = target
                }
            }
    }

    private func targetDetent(projectedHeight: CGFloat, translation: CGFloat, predictedTranslation: CGFloat) -> SheetDetent {
        let flickThreshold: CGFloat = 72
        let shortPullThreshold: CGFloat = 34

        if predictedTranslation < -flickThreshold {
            return nextLargerDetent()
        }
        if predictedTranslation > flickThreshold {
            return nextSmallerDetent()
        }
        if translation < -shortPullThreshold, detent == .collapsed {
            return .medium
        }
        if translation > shortPullThreshold, detent == .medium {
            return .collapsed
        }

        return nearestDetent(to: projectedHeight)
    }

    private func nextLargerDetent() -> SheetDetent {
        switch detent {
        case .collapsed: return .medium
        case .medium: return .large
        case .large: return .large
        }
    }

    private func nextSmallerDetent() -> SheetDetent {
        switch detent {
        case .collapsed: return .collapsed
        case .medium: return .collapsed
        case .large: return .medium
        }
    }

    private func nearestDetent(to target: CGFloat) -> SheetDetent {
        SheetDetent.allCases
            .map { ($0, height(for: $0)) }
            .min(by: { abs($0.1 - target) < abs($1.1 - target) })?
            .0 ?? .collapsed
    }
}

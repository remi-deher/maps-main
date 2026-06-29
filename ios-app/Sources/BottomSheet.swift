import SwiftUI

private struct HeaderHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = BottomSheet.collapsedHeight
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct BottomSheet: View {
    static let collapsedHeight: CGFloat = 52

    let search: BottomSheetSearchContext
    let itinerary: BottomSheetItineraryContext
    let library: BottomSheetLibraryContext
    let place: BottomSheetPlaceContext
    let patrol: PatrolControls
    let gpx: GpxImport
    let simulation: BottomSheetSimulationContext
    let chrome: BottomSheetChromeContext

    @Binding private var scrollOffset: CGFloat
    @Binding private var sheetDetent: SheetDetent
    private let collapsedHeight: CGFloat
    private let onCollapsedHeightChange: (CGFloat) -> Void

    private var isCollapsed: Bool {
        sheetDetent == .collapsed
    }

    private var hasActiveRouteControls: Bool {
        itinerary.activeRoute != nil
    }

    init(
        search: BottomSheetSearchContext,
        itinerary: BottomSheetItineraryContext,
        library: BottomSheetLibraryContext,
        place: BottomSheetPlaceContext,
        patrol: PatrolControls,
        gpx: GpxImport,
        simulation: BottomSheetSimulationContext,
        chrome: BottomSheetChromeContext,
        presentation: BottomSheetPresentationContext
    ) {
        self.search = search
        self.itinerary = itinerary
        self.library = library
        self.place = place
        self.patrol = patrol
        self.gpx = gpx
        self.simulation = simulation
        self.chrome = chrome
        self._scrollOffset = presentation.scrollOffset
        self._sheetDetent = presentation.sheetDetent
        self.collapsedHeight = presentation.collapsedHeight
        self.onCollapsedHeightChange = presentation.onCollapsedHeightChange
    }

    var body: some View {
        VStack(spacing: 0) {
            BottomSheetHeaderView(
                search: search,
                itinerary: itinerary,
                place: place,
                simulation: simulation,
                chrome: chrome,
                isCollapsed: isCollapsed
            )
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: HeaderHeightKey.self, value: proxy.size.height)
                }
            )

            if !isCollapsed {
                scrollableContent
                    .padding(.top, 10)
                    .transition(.opacity)
            }

            if !isCollapsed, hasActiveRouteControls {
                BottomSheetActiveRouteControlDockView(
                    simulationState: simulation.state,
                    onResumeRoute: simulation.onResumeRoute,
                    onPauseRoute: simulation.onPauseRoute,
                    onStopRoute: simulation.onStopRoute,
                    onRecenterActiveRoute: itinerary.onRecenterActiveRoute,
                    onShowActiveRouteDetails: itinerary.onShowActiveRouteDetails,
                    onOpenSettings: chrome.onOpenSettings
                )
                .padding(.top, 10)
                .padding(.bottom, 8)
            }
        }
        .onPreferenceChange(HeaderHeightKey.self, perform: handleCollapsedHeight)
    }

    private var scrollableContent: some View {
        ScrollView {
            BottomSheetContentView(
                search: search,
                itinerary: itinerary,
                library: library,
                place: place,
                patrol: patrol,
                gpx: gpx,
                simulation: simulation,
                chrome: chrome
            )
            .padding(.bottom, hasActiveRouteControls ? 8 : 24)
            .background(
                GeometryReader { proxy in
                    let offsetY = proxy.frame(in: .named("scroll")).minY
                    Color.clear.preference(key: ScrollOffsetKey.self, value: offsetY)
                }
            )
        }
        .coordinateSpace(name: "scroll")
        .scrollDisabled(sheetDetent != .large)
        .scrollDismissesKeyboard(.interactively)
        .onPreferenceChange(ScrollOffsetKey.self) { value in
            scrollOffset = value
        }
    }

    private func handleCollapsedHeight(_ measured: CGFloat) {
        let rounded = measured.rounded(.toNearestOrAwayFromZero)
        if abs(rounded - collapsedHeight) > 1 {
            onCollapsedHeightChange(rounded)
        }
    }
}

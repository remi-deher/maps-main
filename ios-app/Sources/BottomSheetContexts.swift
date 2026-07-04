import SwiftUI
import MapKit

struct BottomSheetSearchContext {
    var query: Binding<String>
    var isFocused: FocusState<Bool>.Binding
    let suggestions: [MKLocalSearchCompletion]
    // True while the completer is still fetching, so the results view shows a
    // spinner instead of a premature empty state.
    let isSearching: Bool
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void
    // Fired when the user hits the keyboard's "Rechercher" key: commit the
    // typed query to a full search rather than waiting for a suggestion tap.
    var onSubmit: () -> Void
}

struct BottomSheetItineraryContext {
    var stops: Binding<[RouteStop]>
    var speed: Binding<Double>
    var profile: Binding<String>
    let legEstimates: [UUID: LegEstimate]
    let activeRoute: ActiveRoute?
    var onAddStop: () -> Void
    var onLaunch: () -> Void
    var onShowActiveRouteDetails: () -> Void
    var onRecenterActiveRoute: () -> Void
}

struct BottomSheetLibraryContext {
    let favorites: [Favorite]
    var onSelectFavorite: (Favorite) -> Void
    var onDeleteFavorite: (Favorite) -> Void
    let recentPlaces: [RecentPlace]
    var onSelectRecentPlace: (RecentPlace) -> Void
    var onClearRecentPlaces: () -> Void
    let hasSavedItinerary: Bool
    var onLoadLastItinerary: () -> Void
}

struct BottomSheetPlaceContext {
    let selectedPlace: SelectedPlace?
    // Where "distance from here" is measured from — the simulated position if
    // one is active, otherwise the device's real location. nil hides the line.
    let referenceCoordinate: CLLocationCoordinate2D?
    var actions: PlaceActions
}

struct BottomSheetSimulationContext {
    let state: String?
    var onPauseRoute: () -> Void
    var onResumeRoute: () -> Void
    var onStopRoute: () -> Void
}

struct BottomSheetChromeContext {
    var onOpenSettings: () -> Void
    // Opens settings straight to the diagnostics screen (distinct from the
    // generic settings entry) for "Signaler un problème".
    var onReportProblem: () -> Void
    var onCollapseSheet: () -> Void
}

struct BottomSheetPresentationContext {
    var scrollOffset: Binding<CGFloat>
    var sheetDetent: Binding<SheetDetent>
    var collapsedHeight: CGFloat
    var onCollapsedHeightChange: (CGFloat) -> Void
}

import SwiftUI
import MapKit

struct BottomSheetSearchContext {
    var query: Binding<String>
    var isFocused: FocusState<Bool>.Binding
    let suggestions: [MKLocalSearchCompletion]
    var onSelectSuggestion: (MKLocalSearchCompletion) -> Void
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
    var onCollapseSheet: () -> Void
}

struct BottomSheetPresentationContext {
    var scrollOffset: Binding<CGFloat>
    var sheetDetent: Binding<SheetDetent>
    var collapsedHeight: CGFloat
    var onCollapsedHeightChange: (CGFloat) -> Void
}

import SwiftUI

struct BottomSheetHeaderView: View {
    let search: BottomSheetSearchContext
    let itinerary: BottomSheetItineraryContext
    let place: BottomSheetPlaceContext
    let simulation: BottomSheetSimulationContext
    let chrome: BottomSheetChromeContext
    let isCollapsed: Bool

    private enum TrailingAction: Equatable {
        case settings
        case cancelPlace
        case cancelSearch
        case collapseSheet
    }

    private var isPlanningItinerary: Bool {
        !itinerary.stops.wrappedValue.isEmpty && !search.isFocused.wrappedValue
    }

    private var trailingAction: TrailingAction {
        if isCollapsed {
            return .settings
        }
        if place.selectedPlace != nil {
            return .cancelPlace
        }
        if search.isFocused.wrappedValue || !search.query.wrappedValue.isEmpty {
            return .cancelSearch
        }
        return .collapseSheet
    }

    var body: some View {
        Group {
            if let activeRoute = itinerary.activeRoute {
                BottomSheetActiveRouteHeaderView(
                    route: activeRoute,
                    simulationState: simulation.state,
                    onShowActiveRouteDetails: itinerary.onShowActiveRouteDetails
                )
            } else if isPlanningItinerary {
                BottomSheetItineraryPlanningHeaderView(itinerary: itinerary)
            } else {
                HStack(spacing: 10) {
                    BottomSheetSearchField(
                        searchQuery: search.query,
                        isFocused: search.isFocused,
                        hasItineraryStops: !itinerary.stops.wrappedValue.isEmpty,
                        onSubmit: search.onSubmit
                    )
                    trailingButton
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    private var trailingButton: some View {
        let action = trailingAction
        return Button {
            perform(action)
        } label: {
            Group {
                if action == .settings {
                    Image(systemName: "gearshape.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)
                } else {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .frame(width: 58, height: 58)
            .contentShape(Circle())
            .background {
                if action == .settings {
                    Circle().fill(Color.accentColor.opacity(0.82))
                }
            }
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .accessibilityLabel(action == .settings ? "Réglages" : "Annuler")
        .animation(.snappy(duration: 0.2), value: action)
    }

    private func perform(_ action: TrailingAction) {
        switch action {
        case .settings:
            chrome.onOpenSettings()
        case .cancelPlace:
            place.actions.onDismiss()
        case .cancelSearch:
            search.query.wrappedValue = ""
            search.isFocused.wrappedValue = false
        case .collapseSheet:
            chrome.onCollapseSheet()
        }
    }
}

private struct BottomSheetItineraryPlanningHeaderView: View {
    let itinerary: BottomSheetItineraryContext

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Itinéraire")
                    .font(.title3.weight(.bold))
                Spacer()
                Button(action: clearItinerary) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 4)

            ItineraryHeader(
                stops: itinerary.stops,
                profile: itinerary.profile,
                legEstimates: itinerary.legEstimates,
                onAddStop: itinerary.onAddStop
            )
        }
        .padding(.top, 4)
    }

    private func clearItinerary() {
        withAnimation {
            itinerary.stops.wrappedValue = []
        }
    }
}

import SwiftUI

struct BottomSheetHeaderView: View {
    let search: BottomSheetSearchContext
    let itinerary: BottomSheetItineraryContext
    let place: BottomSheetPlaceContext
    let simulation: BottomSheetSimulationContext
    let chrome: BottomSheetChromeContext
    let status: BottomSheetStatusContext
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

    private var isShowingPlace: Bool {
        place.selectedPlace != nil && !search.isFocused.wrappedValue
    }

    private var trailingAction: TrailingAction {
        // Un lieu sélectionné passe avant l'état replié : au détent collapsed
        // la barre de lieu remplace le champ de recherche, et son bouton rond
        // doit fermer le lieu, pas ouvrir les réglages.
        if place.selectedPlace != nil {
            return .cancelPlace
        }
        if isCollapsed {
            return .settings
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
            } else if isShowingPlace, let selectedPlace = place.selectedPlace {
                placeHeader(selectedPlace)
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

    // Quand un lieu est sélectionné, le champ de recherche cède la place au
    // nom du lieu — exactement ce que fait Plans. Le titre vit donc ici et pas
    // dans `PlaceCard`, ce qui évite de l'afficher deux fois et le rend visible
    // même au détent replié, où la carte n'est pas rendue.
    private func placeHeader(_ selectedPlace: SelectedPlace) -> some View {
        let appearance = PointOfInterestStyle.appearance(for: selectedPlace.category)
        return HStack(spacing: 12) {
            Image(systemName: appearance.symbol)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(appearance.color, in: Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(selectedPlace.title)
                    .font(.headline)
                    .lineLimit(1)
                if let subtitle = selectedPlace.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            trailingButton
        }
        .padding(.leading, 4)
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
                    Circle().fill(Color.accentColor)
                }
            }
            // Pastille d'alerte quand le moteur n'est pas joignable : au détent
            // collapsed, ce bouton est la seule chose visible de la sheet — sans
            // elle, l'état « non connecté » serait invisible tant que
            // l'utilisateur n'ouvre pas le panneau (audit P0-4).
            .overlay(alignment: .topTrailing) {
                if action == .settings, status.needsAttention {
                    Circle()
                        .fill(.orange)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().strokeBorder(Color(.systemBackground), lineWidth: 2))
                        .offset(x: -6, y: 6)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .background(Color(.tertiarySystemFill), in: Circle())
        .accessibilityLabel(action == .settings ? "Réglages" : "Annuler")
        .accessibilityValue(action == .settings && status.needsAttention ? "Moteur non connecté" : "")
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

import SwiftUI
import MapKit

private let routeDistanceFormatter: MeasurementFormatter = {
    let formatter = MeasurementFormatter()
    formatter.unitOptions = .naturalScale
    formatter.unitStyle = .medium
    return formatter
}()

private let routeDurationFormatter: DateComponentsFormatter = {
    let formatter = DateComponentsFormatter()
    formatter.allowedUnits = [.hour, .minute]
    formatter.unitsStyle = .abbreviated
    return formatter
}()

/// Row/card builders for BottomSheet, split out of BottomSheet.swift to stay
/// under SwiftLint's file_length/type_body_length limits. Members here are
/// `internal` (not `private`) so the main file's view builders can still call
/// them — Swift's per-file `private` scoping doesn't extend across files even
/// for extensions of the same type.
extension BottomSheet {
    func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
        }
    }

    func sectionHeader<Trailing: View>(_ title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack {
            Text(title)
                .font(.title3.weight(.semibold))
            Spacer()
            trailing()
        }
    }

    var emptyFavoritesCard: some View {
        Button(action: focusSearchForAddition) {
            HStack(spacing: 12) {
                Image(systemName: "star")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 38, height: 38)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text("Aucun favori")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                    Text("Recherchez un lieu pour l’ajouter ici.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Image(systemName: "plus")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 66, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    var favoriteListCard: some View {
        VStack(spacing: 0) {
            ForEach(visibleFavorites) { favorite in
                favoriteRow(favorite)
                if favorite.id != visibleFavorites.last?.id {
                    Divider()
                        .padding(.leading, 58)
                }
            }
        }
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    func favoriteRow(_ favorite: Favorite) -> some View {
        Button {
            onSelectFavorite(favorite)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: favoriteIcon(for: favorite))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(favorite.name ?? "Favori")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(favoriteCoordinates(for: favorite))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Supprimer", role: .destructive) {
                onDeleteFavorite(favorite)
            }
        }
    }

    func recentPlaceRow(_ recent: RecentPlace) -> some View {
        Button {
            onSelectRecentPlace(recent)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "clock.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(recent.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(recent.subtitle ?? recentCoordinates(for: recent))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    func guideCard(title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.headline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(width: 42, height: 42)
                .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body.weight(.medium))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    func groupedActionList<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    func utilityRow(_ title: String, subtitle: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    func favoriteIcon(for favorite: Favorite) -> String {
        let name = (favorite.name ?? "").lowercased()
        if ["maison", "domicile", "home"].contains(where: name.contains) {
            return "house.fill"
        }
        if ["travail", "bureau", "work"].contains(where: name.contains) {
            return "briefcase.fill"
        }
        return "star.fill"
    }

    func favoriteCoordinates(for favorite: Favorite) -> String {
        String(format: "%.5f, %.5f", favorite.lat, favorite.lon)
    }

    func recentCoordinates(for recent: RecentPlace) -> String {
        String(format: "%.5f, %.5f", recent.lat, recent.lon)
    }

    func isFavorite(_ place: SelectedPlace) -> Bool {
        favorites.contains { favorite in
            abs(favorite.lat - place.coordinate.latitude) < 0.000001
                && abs(favorite.lon - place.coordinate.longitude) < 0.000001
        }
    }

    var hasActiveRouteControls: Bool {
        activeRoute != nil
    }

    var hasGenericSimulationControls: Bool {
        activeRoute == nil && (simulationState == "moving" || simulationState == "paused")
    }

    var itineraryTotalEstimate: LegEstimate? {
        totalEstimate(for: itineraryStops)
    }

    func totalEstimate(for stops: [RouteStop]) -> LegEstimate? {
        totalEstimate(for: stops, estimates: legEstimates)
    }

    func totalEstimate(for route: ActiveRoute) -> LegEstimate? {
        totalEstimate(for: route.stops, estimates: route.legEstimates)
    }

    func totalEstimate(for stops: [RouteStop], estimates source: [UUID: LegEstimate]) -> LegEstimate? {
        let estimates = stops.compactMap { source[$0.id] }
        guard !estimates.isEmpty else { return nil }
        return LegEstimate(
            distanceMeters: estimates.reduce(0) { $0 + $1.distanceMeters },
            travelTime: estimates.reduce(0) { $0 + $1.travelTime }
        )
    }

    func activeRouteCompactHeader(_ route: ActiveRoute) -> some View {
        Button(action: onShowActiveRouteDetails) {
            HStack(spacing: 12) {
                Image(systemName: simulationState == "paused" ? "pause.circle.fill" : "location.north.circle.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Vers \(route.destinationName)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(activeRouteSubtitle(route))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.up")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel("DÃ©tails de l'itinÃ©raire")
    }

    func activeRouteOverview(_ route: ActiveRoute) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: route.profile == "walking" ? "figure.walk.circle.fill" : "car.circle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text(simulationState == "paused" ? "ItinÃ©raire en pause" : "ItinÃ©raire en cours")
                        .font(.headline)
                    Text("Destination : \(route.destinationName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()
            }

            HStack(spacing: 10) {
                if let estimate = totalEstimate(for: route) {
                    routeMetricTile(title: "Distance", value: routeDistanceText(estimate))
                    routeMetricTile(title: "DurÃ©e", value: routeDurationText(estimate))
                    routeMetricTile(title: "Vitesse", value: "\(Int(route.speed)) km/h")
                } else {
                    routeMetricTile(title: "Trajet", value: route.stepCount > 1 ? "\(route.stepCount) arrÃªts" : "Direct")
                    routeMetricTile(title: "Profil", value: route.profile == "walking" ? "Marche" : "Voiture")
                    routeMetricTile(title: "Vitesse", value: "\(Int(route.speed)) km/h")
                }
            }

            if let place = selectedPlace {
                activeRoutePlaceCard(place)
            }

            routeStopsList(route)
        }
        .padding(18)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
    }

    func routeMetricTile(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    func activeRoutePlaceCard(_ place: SelectedPlace) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "mappin.circle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 38, height: 38)

                VStack(alignment: .leading, spacing: 2) {
                    Text(place.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(place.subtitle ?? placeCoordinates(place))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)
            }

            HStack(spacing: 10) {
                Button(action: placeActions.onFavorite) {
                    Label(isFavorite(place) ? "Favori" : "Favoris", systemImage: isFavorite(place) ? "star.fill" : "star")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)

                Button(action: placeActions.onAddStop) {
                    Label("Ajouter un arrêt", systemImage: "plus")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glassProminent)
                .tint(Color.accentColor)
                .buttonBorderShape(.capsule)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    func placeCoordinates(_ place: SelectedPlace) -> String {
        String(format: "%.5f, %.5f", place.coordinate.latitude, place.coordinate.longitude)
    }

    func routeStopsList(_ route: ActiveRoute) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(route.stops.enumerated()), id: \.element.id) { index, stop in
                routeStepRow(index: index, stop: stop, estimate: route.legEstimates[stop.id])
                if stop.id != route.stops.last?.id {
                    Divider().padding(.leading, 46)
                }
            }
        }
        .background(Color(.secondarySystemFill), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    func routeStepRow(index: Int, stop: RouteStop, estimate: LegEstimate?) -> some View {
        HStack(spacing: 12) {
            Text("\(index + 1)")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Color.accentColor, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(stop.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                if let estimate = estimate {
                    Text(routeEstimateText(estimate))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 52)
    }

    var activeRouteControlDock: some View {
        let paused = simulationState == "paused"
        return HStack(spacing: 10) {
            Button(action: paused ? onResumeRoute : onPauseRoute) {
                Label(paused ? "Reprendre" : "Pause", systemImage: paused ? "play.fill" : "pause.fill")
                    .font(.headline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.glassProminent)
            .tint(Color.accentColor)
            .buttonBorderShape(.capsule)

            Button(action: onStopRoute) {
                Label("ArrÃªter", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 48, height: 48)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)

            Menu {
                Button(action: onRecenterActiveRoute) {
                    Label("Recentrer", systemImage: "location.viewfinder")
                }
                Button(action: onShowActiveRouteDetails) {
                    Label("DÃ©tails", systemImage: "list.bullet")
                }
                Button(action: onOpenSettings) {
                    Label("RÃ©glages", systemImage: "gearshape.fill")
                }
            } label: {
                Label("Plus", systemImage: "ellipsis")
                    .labelStyle(.iconOnly)
                    .frame(width: 48, height: 48)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 12)
    }

    func activeRouteSubtitle(_ route: ActiveRoute) -> String {
        var parts: [String] = []
        if let estimate = totalEstimate(for: route) {
            parts.append(routeEstimateText(estimate))
        }
        parts.append(route.profile == "walking" ? "Marche" : "Voiture")
        parts.append("\(Int(route.speed)) km/h")
        return parts.joined(separator: " Â· ")
    }

    func routeEstimateText(_ estimate: LegEstimate) -> String {
        let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
        var parts = [routeDistanceFormatter.string(from: distance)]
        if let duration = routeDurationFormatter.string(from: estimate.travelTime), !duration.isEmpty {
            parts.append(duration)
        }
        return parts.joined(separator: " Â· ")
    }

    func routeDistanceText(_ estimate: LegEstimate) -> String {
        routeDistanceFormatter.string(from: Measurement(value: estimate.distanceMeters, unit: UnitLength.meters))
    }

    func routeDurationText(_ estimate: LegEstimate) -> String {
        routeDurationFormatter.string(from: estimate.travelTime) ?? "--"
    }

    var simulationControlBar: some View {
        HStack(spacing: 10) {
            Image(systemName: simulationState == "paused" ? "pause.circle.fill" : "location.north.circle.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(simulationState == "paused" ? "Simulation en pause" : "Position active")
                    .font(.subheadline.weight(.semibold))
                Text(simulationState == "paused" ? "Reprendre ou arrêter le parcours" : "Le moteur applique la position")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if simulationState == "paused" {
                Button(action: onResumeRoute) {
                    Label("Reprendre", systemImage: "play.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glassProminent)
                .tint(.accentColor)
                .buttonBorderShape(.circle)
            } else {
                Button(action: onPauseRoute) {
                    Label("Mettre en pause", systemImage: "pause.fill")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            }
            Button(action: onStopRoute) {
                Label("Arrêter", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
    }

    var patrolActiveBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("Patrouille active")
                    .font(.subheadline.weight(.semibold))
                Text("Déplacement automatique dans la zone")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: patrol.onStop) {
                Label("Arrêter la patrouille", systemImage: "stop.fill")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.red)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    var searchResultsSection: some View {
        if searchSuggestions.isEmpty {
            Text("Recherche...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        } else {
            VStack(spacing: 0) {
                // Stable composite identity (title|subtitle) instead of the
                // array index: keying on `.offset` re-identified every row as
                // the completion list mutates on each keystroke, breaking
                // diffing/animation. See §4 (perf) of docs/UI_UX_BASELINE.md.
                ForEach(searchSuggestions, id: \.compositeID) { completion in
                    searchResultRow(completion)
                    if completion.compositeID != searchSuggestions.last?.compositeID {
                        Divider()
                            .padding(.leading, 58)
                    }
                }
            }
            .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 16)
        }
    }

    func searchResultRow(_ completion: MKLocalSearchCompletion) -> some View {
        Button {
            onSelectSuggestion(completion)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemFill), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(completion.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if !completion.subtitle.isEmpty {
                        Text(completion.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private extension MKLocalSearchCompletion {
    /// A stable identity for SwiftUI diffing: `MKLocalSearchCompletion` isn't
    /// `Identifiable`, and its array position changes on every keystroke, so
    /// title+subtitle is the closest thing to a durable key for a row.
    var compositeID: String { "\(title)|\(subtitle)" }
}

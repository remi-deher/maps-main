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

struct BottomSheetActiveRouteControlsView: View {
    let route: ActiveRoute
    let simulationState: String?
    let selectedPlace: SelectedPlace?
    let placeActions: PlaceActions
    let favorites: [Favorite]
    var onResumeRoute: () -> Void
    var onPauseRoute: () -> Void
    var onStopRoute: () -> Void
    var onRecenterActiveRoute: () -> Void
    var onShowActiveRouteDetails: () -> Void
    var onOpenSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: route.profile == "walking" ? "figure.walk.circle.fill" : "car.circle.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text(simulationState == "paused" ? "Itineraire en pause" : "Itineraire en cours")
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
                    routeMetricTile(title: "Duree", value: routeDurationText(estimate))
                    routeMetricTile(title: "Vitesse", value: "\(Int(route.speed)) km/h")
                } else {
                    routeMetricTile(title: "Trajet", value: route.stepCount > 1 ? "\(route.stepCount) arrets" : "Direct")
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

    private func totalEstimate(for route: ActiveRoute) -> LegEstimate? {
        let estimates = route.stops.compactMap { route.legEstimates[$0.id] }
        guard !estimates.isEmpty else { return nil }
        return LegEstimate(
            distanceMeters: estimates.reduce(0) { $0 + $1.distanceMeters },
            travelTime: estimates.reduce(0) { $0 + $1.travelTime }
        )
    }

    private func routeMetricTile(title: String, value: String) -> some View {
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

    private func activeRoutePlaceCard(_ place: SelectedPlace) -> some View {
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
                    Label("Ajouter un arret", systemImage: "plus")
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

    private func placeCoordinates(_ place: SelectedPlace) -> String {
        String(format: "%.5f, %.5f", place.coordinate.latitude, place.coordinate.longitude)
    }

    private func routeStopsList(_ route: ActiveRoute) -> some View {
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

    private func routeStepRow(index: Int, stop: RouteStop, estimate: LegEstimate?) -> some View {
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

    private func isFavorite(_ place: SelectedPlace) -> Bool {
        favorites.contains { favorite in
            abs(favorite.lat - place.coordinate.latitude) < 0.000001
                && abs(favorite.lon - place.coordinate.longitude) < 0.000001
        }
    }

    private func routeEstimateText(_ estimate: LegEstimate) -> String {
        let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
        var parts = [routeDistanceFormatter.string(from: distance)]
        if let duration = routeDurationFormatter.string(from: estimate.travelTime), !duration.isEmpty {
            parts.append(duration)
        }
        return parts.joined(separator: " - ")
    }

    private func routeDistanceText(_ estimate: LegEstimate) -> String {
        routeDistanceFormatter.string(from: Measurement(value: estimate.distanceMeters, unit: UnitLength.meters))
    }

    private func routeDurationText(_ estimate: LegEstimate) -> String {
        routeDurationFormatter.string(from: estimate.travelTime) ?? "--"
    }
}

struct BottomSheetActiveRouteHeaderView: View {
    let route: ActiveRoute
    let simulationState: String?
    var onShowActiveRouteDetails: () -> Void

    var body: some View {
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
        .accessibilityLabel("Details de l'itineraire")
    }

    private func activeRouteSubtitle(_ route: ActiveRoute) -> String {
        var parts: [String] = []
        if let estimate = totalEstimate(for: route) {
            parts.append(routeEstimateText(estimate))
        }
        parts.append(route.profile == "walking" ? "Marche" : "Voiture")
        parts.append("\(Int(route.speed)) km/h")
        return parts.joined(separator: " - ")
    }

    private func totalEstimate(for route: ActiveRoute) -> LegEstimate? {
        let estimates = route.stops.compactMap { route.legEstimates[$0.id] }
        guard !estimates.isEmpty else { return nil }
        return LegEstimate(
            distanceMeters: estimates.reduce(0) { $0 + $1.distanceMeters },
            travelTime: estimates.reduce(0) { $0 + $1.travelTime }
        )
    }

    private func routeEstimateText(_ estimate: LegEstimate) -> String {
        let distance = Measurement(value: estimate.distanceMeters, unit: UnitLength.meters)
        var parts = [routeDistanceFormatter.string(from: distance)]
        if let duration = routeDurationFormatter.string(from: estimate.travelTime), !duration.isEmpty {
            parts.append(duration)
        }
        return parts.joined(separator: " - ")
    }
}

struct BottomSheetActiveRouteControlDockView: View {
    let simulationState: String?
    var onResumeRoute: () -> Void
    var onPauseRoute: () -> Void
    var onStopRoute: () -> Void
    var onRecenterActiveRoute: () -> Void
    var onShowActiveRouteDetails: () -> Void
    var onOpenSettings: () -> Void

    var body: some View {
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
                Label("Arreter", systemImage: "stop.fill")
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
                    Label("Details", systemImage: "list.bullet")
                }
                Button(action: onOpenSettings) {
                    Label("Reglages", systemImage: "gearshape.fill")
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
}

struct SimulationControlBarView: View {
    let simulationState: String?
    var onResumeRoute: () -> Void
    var onPauseRoute: () -> Void
    var onStopRoute: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: simulationState == "paused" ? "pause.circle.fill" : "location.north.circle.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(simulationState == "paused" ? "Simulation en pause" : "Position active")
                    .font(.subheadline.weight(.semibold))
                Text(simulationState == "paused" ? "Reprendre ou arreter le parcours" : "Le moteur applique la position")
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
                Label("Arreter", systemImage: "stop.fill")
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
}

struct PatrolActiveBarView: View {
    let patrol: PatrolControls

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text("Patrouille active")
                    .font(.subheadline.weight(.semibold))
                Text("Deplacement automatique dans la zone")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: patrol.onStop) {
                Label("Arreter la patrouille", systemImage: "stop.fill")
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
}

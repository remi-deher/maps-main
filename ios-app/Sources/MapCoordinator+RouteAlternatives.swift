import CoreLocation
import MapKit
import SwiftUI

// Une variante de trajet proposée pour une destination unique.
struct RouteAlternative: Identifiable {
    let id = UUID()
    let index: Int
    let route: OSRMRoute
    let isFastest: Bool
    // Écart de durée avec le tracé le plus rapide, en secondes.
    let extraSeconds: TimeInterval
}

// Alternatives de trajet, façon Plans — avec une subtilité qui n'est pas
// cosmétique : le moteur ne reçoit qu'un début et une fin par tronçon
// (`domain.RouteLeg` : start / end / speed) et recalcule lui-même la route.
// Afficher un choix de tracés sans plus serait donc un mensonge — la
// simulation suivrait de toute façon l'itinéraire par défaut.
//
// D'où `viaPointForSelectedAlternative` : choisir une variante insère, au
// moment du lancement, un point de passage pris là où elle s'écarte le plus du
// tracé rapide. Le moteur route alors début → point de passage → destination,
// ce qui le fait emprunter la variante choisie. Le point de passage n'existe
// que dans la séquence envoyée au moteur ; la liste d'étapes affichée reste
// celle de l'utilisateur.
extension MapCoordinator {
    var routeAlternativeChoices: [RouteAlternative] {
        guard routeAlternatives.count > 1, let fastest = routeAlternatives.first else { return [] }
        return routeAlternatives.enumerated().map { index, route in
            RouteAlternative(
                index: index,
                route: route,
                isFastest: index == 0,
                extraSeconds: route.durationSeconds - fastest.durationSeconds
            )
        }
    }

    // Tracés à dessiner en gris derrière celui qui est retenu.
    var unselectedAlternativePaths: [[CLLocationCoordinate2D]] {
        guard routeAlternatives.count > 1 else { return [] }
        return routeAlternatives.enumerated()
            .filter { $0.offset != selectedAlternativeIndex }
            .map { $0.element.path }
    }

    func selectAlternative(_ index: Int) {
        guard routeAlternatives.indices.contains(index) else { return }
        selectedAlternativeIndex = index
        plannedRoutePath = routeAlternatives[index].path
    }

    // Recharge les variantes pour une destination unique. Au-delà d'une étape,
    // Plans ne propose pas d'alternative non plus, et le point de passage
    // deviendrait ambigu.
    func refreshRouteAlternatives(session: MapSessionModel) {
        alternativesTask?.cancel()
        guard itineraryStops.count == 1,
              let destination = itineraryStops.first?.coordinate,
              let origin = spoofedCoordinate(session: session) ?? session.location.lastLocation?.coordinate else {
            clearRouteAlternatives()
            return
        }

        let profile = itineraryProfile
        alternativesTask = Task { [weak self] in
            let routes = await OSRMClient.fetchRoutes(from: origin, to: destination, profile: profile)
            guard let self, !Task.isCancelled else { return }
            // Affectations directes plutôt que `clearRouteAlternatives()` : on
            // est *dans* `alternativesTask`, et l'annuler depuis lui-même n'a
            // pas de sens.
            guard routes.count > 1 else {
                routeAlternatives = []
                selectedAlternativeIndex = 0
                return
            }
            routeAlternatives = routes
            selectedAlternativeIndex = 0
            plannedRoutePath = routes[0].path
        }
    }

    func clearRouteAlternatives() {
        alternativesTask?.cancel()
        alternativesTask = nil
        routeAlternatives = []
        selectedAlternativeIndex = 0
    }

    // Étapes réellement envoyées au moteur : celles de l'utilisateur, plus le
    // point de passage quand une variante non rapide a été choisie.
    func stopsForPlayback(_ stops: [RouteStop]) -> [RouteStop] {
        guard stops.count == 1, let via = viaPointForSelectedAlternative(), let destination = stops.first else {
            return stops
        }
        return [RouteStop(coordinate: via, name: "Point de passage"), destination]
    }

    // Point de la variante retenue le plus éloigné du tracé le plus rapide :
    // c'est celui qui force le routeur du moteur à emprunter cette variante
    // plutôt qu'une autre.
    func viaPointForSelectedAlternative() -> CLLocationCoordinate2D? {
        guard selectedAlternativeIndex > 0,
              routeAlternatives.indices.contains(selectedAlternativeIndex),
              let fastest = routeAlternatives.first else { return nil }

        let chosen = sampled(routeAlternatives[selectedAlternativeIndex].path)
        let reference = sampled(fastest.path).map { CLLocation(latitude: $0.latitude, longitude: $0.longitude) }
        guard chosen.count > 2, !reference.isEmpty else { return nil }

        var best: (coordinate: CLLocationCoordinate2D, distance: CLLocationDistance)?
        for candidate in chosen {
            let location = CLLocation(latitude: candidate.latitude, longitude: candidate.longitude)
            var nearest = CLLocationDistance.greatestFiniteMagnitude
            for point in reference {
                nearest = min(nearest, location.distance(from: point))
            }
            if best == nil || nearest > best!.distance {
                best = (candidate, nearest)
            }
        }

        // En deçà de ~150 m les deux tracés se confondent : imposer un point de
        // passage n'apporterait rien et risquerait un détour absurde.
        guard let best, best.distance > 150 else { return nil }
        return best.coordinate
    }

    // Ramène un tracé à ~120 points : la comparaison est quadratique, et cette
    // résolution suffit largement à trouver l'endroit où deux routes divergent.
    private func sampled(_ path: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        guard path.count > 120 else { return path }
        let step = path.count / 120
        return stride(from: 0, to: path.count, by: max(step, 1)).map { path[$0] }
    }
}

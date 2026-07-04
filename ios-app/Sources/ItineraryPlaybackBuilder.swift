import CoreLocation

struct ItineraryPlaybackBuilder {
    // CHANTIER VÉLO (audit UI/UX #19) — différé, points de blocage :
    //
    // Ajouter un profil « vélo » au sélecteur d'itinéraire multi-étapes est
    // aujourd'hui bloqué à trois niveaux, pas seulement dans l'app :
    //
    //  1. Moteur : `domain.LegType` (engine/internal/domain/types.go) ne connaît
    //     que start/drive/walk/flight/wait — aucun type cyclable. `sequenceLegs`
    //     ci-dessous mappe donc tout sauf "walking" vers "drive" : un trajet
    //     « vélo » serait simulé EN VOITURE. Le profil `cycling` n'existe côté
    //     moteur que pour `PlayRoute` mono-destination (validate.go /
    //     routing.SupportedProfiles), pas pour les séquences.
    //  2. Estimation d'ETA (ItineraryEstimator) : le serveur OSRM démo public
    //     n'expose que le profil voiture, et le fallback `MKDirections` ne
    //     supporte pas le vélo (.automobile/.walking/.transit uniquement). Un
    //     leg vélo n'aurait donc ni ETA ni géométrie réelle (ligne droite).
    //
    // Faire le vélo proprement = chantier transverse : (a) ajouter un LegType
    // cyclable au moteur + son routage cycling en séquence, (b) une source
    // d'ETA/tracé vélo (OSRM self-hosté avec profil bike, ou table de vitesses).
    // Tant que (1) et (2) ne sont pas levés, exposer « vélo » dans l'UI livre
    // une option cassée — d'où son absence volontaire du Picker profil.
    func sequenceLegs(
        for stops: [RouteStop],
        speed: Double,
        profile: String,
        startingCoordinate: CLLocationCoordinate2D?
    ) -> [[String: Any]] {
        guard !stops.isEmpty else { return [] }
        let legType = profile == "walking" ? "walk" : "drive"
        var previousCoordinate = startingCoordinate ?? stops[0].coordinate

        return stops.map { stop in
            defer { previousCoordinate = stop.coordinate }
            return [
                "type": legType,
                "start": ["lat": previousCoordinate.latitude, "lon": previousCoordinate.longitude],
                "end": ["lat": stop.coordinate.latitude, "lon": stop.coordinate.longitude],
                "speed": speed
            ]
        }
    }
}

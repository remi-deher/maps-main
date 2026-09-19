import CoreLocation
import Observation

// Géocodage inverse mutualisé, sérialisé et mis en cache.
//
// Avant, chaque ligne de favori/récent lançait son propre `CLGeocoder` au
// déploiement de la sheet — jusqu'à quinze requêtes simultanées. CoreLocation
// limite agressivement le géocodage (il est explicitement documenté comme une
// ressource partagée à n'utiliser qu'avec parcimonie) : passé le quota, les
// requêtes échouaient et la ligne restait indéfiniment sur son placeholder
// masqué « Adresse… », sans repli ni message.
// Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P2-6.
//
// Ici : une seule requête à la fois, un cache mémoire + disque partagé par
// toutes les vues, et un repli sur les coordonnées formatées en cas d'échec —
// de sorte qu'une ligne finit toujours par afficher quelque chose de lisible.
@MainActor
@Observable
final class AddressResolver {
    static let shared = AddressResolver()

    private static let storageKey = "resolvedAddresses"
    private static let cacheLimit = 200

    // Clé "lat,lon" arrondie -> libellé affichable. Observé par les vues.
    private(set) var addresses: [String: String]

    @ObservationIgnored private var queued: [PendingLookup] = []
    @ObservationIgnored private var worker: Task<Void, Never>?
    @ObservationIgnored private let geocoder = CLGeocoder()

    private struct PendingLookup: Equatable {
        let key: String
        let latitude: Double
        let longitude: Double
    }

    // `nonisolated` : l'initialisation de `shared` a lieu hors du main actor.
    // Elle ne fait qu'affecter des propriétés stockées, ce que Swift autorise
    // depuis un init non isolé — même motif que la note de MapSessionModel sur
    // les expressions évaluées en contexte non isolé.
    nonisolated init() {
        addresses = UserDefaults.standard.dictionary(forKey: Self.storageKey) as? [String: String] ?? [:]
    }

    static func key(latitude: Double, longitude: Double) -> String {
        String(format: "%.5f,%.5f", latitude, longitude)
    }

    // Libellé déjà connu pour ce point, ou nil tant qu'il n'a pas été résolu.
    func address(latitude: Double, longitude: Double) -> String? {
        addresses[Self.key(latitude: latitude, longitude: longitude)]
    }

    // Demande la résolution d'un point. Idempotent : un point déjà résolu ou
    // déjà en file ne relance rien.
    func request(latitude: Double, longitude: Double) {
        let key = Self.key(latitude: latitude, longitude: longitude)
        guard addresses[key] == nil else { return }
        let lookup = PendingLookup(key: key, latitude: latitude, longitude: longitude)
        guard !queued.contains(lookup) else { return }
        queued.append(lookup)
        startWorkerIfNeeded()
    }

    private func startWorkerIfNeeded() {
        guard worker == nil else { return }
        worker = Task { [weak self] in
            guard let self else { return }
            while let next = dequeue() {
                await resolve(next)
                // Respiration entre deux requêtes : CoreLocation coupe le
                // robinet bien avant la fin d'une longue liste sinon.
                try? await Task.sleep(for: .milliseconds(250))
            }
            // Tout est sur le main actor : personne ne peut empiler une
            // demande entre le dequeue vide et cette ligne.
            worker = nil
        }
    }

    private func dequeue() -> PendingLookup? {
        queued.isEmpty ? nil : queued.removeFirst()
    }

    private func resolve(_ lookup: PendingLookup) async {
        let location = CLLocation(latitude: lookup.latitude, longitude: lookup.longitude)
        let placemark = try? await geocoder.reverseGeocodeLocation(location).first
        store(lookup: lookup, label: label(for: placemark) ?? fallback(for: lookup))
    }

    private func label(for placemark: CLPlacemark?) -> String? {
        guard let placemark else { return nil }
        let parts = [placemark.thoroughfare, placemark.locality]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
        if !parts.isEmpty {
            return parts.joined(separator: ", ")
        }
        guard let name = placemark.name, !name.isEmpty else { return nil }
        return name
    }

    // Repli lisible plutôt qu'un placeholder qui ne part jamais : les
    // coordonnées valent mieux que rien, et évitent de re-tenter en boucle.
    private func fallback(for lookup: PendingLookup) -> String {
        String(format: "%.4f, %.4f", lookup.latitude, lookup.longitude)
    }

    private func store(lookup: PendingLookup, label: String) {
        addresses[lookup.key] = label
        if addresses.count > Self.cacheLimit {
            // Cache borné : on repart d'une table vide plutôt que de tenir un
            // ordre d'accès pour une poignée d'entrées peu coûteuses à refaire.
            addresses = [lookup.key: label]
        }
        UserDefaults.standard.set(addresses, forKey: Self.storageKey)
    }
}

import SwiftUI
import Observation

// Icône et couleur d'un favori, choisies par l'utilisateur.
//
// Plans laisse personnaliser ses lieux favoris ; ici l'app se contentait de
// deviner « maison » ou « travail » depuis le nom, et tout le reste tombait sur
// une étoile grise. Le choix est stocké côté app (clé « lat,lon ») parce que le
// modèle `Favorite` du moteur ne transporte que lat/lon/nom/date : personnaliser
// l'icône ne justifie pas de changer le protocole.
enum FavoriteAppearance: String, CaseIterable, Identifiable {
    case home
    case work
    case star
    case heart
    case food
    case school
    case car
    case flag

    var id: String { rawValue }

    var label: String {
        switch self {
        case .home: return "Maison"
        case .work: return "Travail"
        case .star: return "Favori"
        case .heart: return "Coup de cœur"
        case .food: return "Restaurant"
        case .school: return "École"
        case .car: return "Stationnement"
        case .flag: return "Repère"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house.fill"
        case .work: return "briefcase.fill"
        case .star: return "star.fill"
        case .heart: return "heart.fill"
        case .food: return "fork.knife"
        case .school: return "graduationcap.fill"
        case .car: return "car.fill"
        case .flag: return "flag.fill"
        }
    }

    var color: Color {
        switch self {
        case .home: return .blue
        case .work: return .brown
        case .star: return .yellow
        case .heart: return .pink
        case .food: return .orange
        case .school: return .purple
        case .car: return .blue
        case .flag: return .red
        }
    }

    // Repli quand l'utilisateur n'a rien choisi : on continue de deviner depuis
    // le nom, ce qui couvre les deux cas les plus fréquents sans réglage.
    static func inferred(fromName name: String?) -> FavoriteAppearance {
        let lowercased = (name ?? "").lowercased()
        if ["maison", "domicile", "home", "chez moi"].contains(where: lowercased.contains) {
            return .home
        }
        if ["travail", "bureau", "work", "boulot"].contains(where: lowercased.contains) {
            return .work
        }
        return .star
    }
}

// Pas de `@MainActor` ici, contrairement à `AddressResolver` : ce magasin ne
// fait que lire et écrire un dictionnaire dans UserDefaults, sans travail
// asynchrone, et son `shared` s'initialise donc hors du main actor — ce que le
// compilateur refusait (« main actor-isolated property 'choices' can not be
// mutated from a nonisolated context »). Même forme que `AppLogger`, qui rend
// le même service depuis toujours. Tous les accès viennent du corps des vues,
// donc du thread principal.
@Observable
final class FavoriteAppearanceStore {
    static let shared = FavoriteAppearanceStore()

    private static let storageKey = "favoriteAppearances"

    // Clé « lat,lon » arrondie -> rawValue de FavoriteAppearance.
    private(set) var choices: [String: String]

    private init() {
        choices = UserDefaults.standard.dictionary(forKey: Self.storageKey) as? [String: String] ?? [:]
    }

    private static func key(latitude: Double, longitude: Double) -> String {
        String(format: "%.5f,%.5f", latitude, longitude)
    }

    func appearance(latitude: Double, longitude: Double, name: String?) -> FavoriteAppearance {
        let key = Self.key(latitude: latitude, longitude: longitude)
        if let raw = choices[key], let chosen = FavoriteAppearance(rawValue: raw) {
            return chosen
        }
        return .inferred(fromName: name)
    }

    func setAppearance(_ appearance: FavoriteAppearance, latitude: Double, longitude: Double) {
        choices[Self.key(latitude: latitude, longitude: longitude)] = appearance.rawValue
        UserDefaults.standard.set(choices, forKey: Self.storageKey)
    }
}

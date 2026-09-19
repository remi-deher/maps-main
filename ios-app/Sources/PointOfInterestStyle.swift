import MapKit
import SwiftUI

// Habillage d'un point d'intérêt : libellé français, symbole et couleur.
//
// Plans ne pose pas des épingles rouges identiques : chaque catégorie a sa
// pastille colorée (restauration orange, transports bleus, nature verte…) et
// son symbole, et la fiche affiche « Restaurant · à 2,3 km » sous le titre.
// MapKit expose la catégorie (`MKMapItem.pointOfInterestCategory`) mais aucun
// libellé localisé ni couleur — d'où cette table.
//
// Volontairement limitée aux catégories que l'on rencontre réellement en
// cherchant un point où se téléporter : une catégorie inconnue retombe sur le
// repère générique, ce qui est le bon comportement par défaut.
enum PointOfInterestStyle {
    struct Appearance {
        let label: String?
        let symbol: String
        let color: Color
    }

    private static let genericAppearance = Appearance(
        label: nil,
        symbol: "mappin",
        color: .red
    )

    static func appearance(for category: MKPointOfInterestCategory?) -> Appearance {
        guard let category, let known = table[category] else { return genericAppearance }
        return known
    }

    static func label(for category: MKPointOfInterestCategory?) -> String? {
        appearance(for: category).label
    }

    // MARK: - Table

    private static let table: [MKPointOfInterestCategory: Appearance] = [
        // Restauration — orange, comme Plans.
        .restaurant: Appearance(label: "Restaurant", symbol: "fork.knife", color: .orange),
        .cafe: Appearance(label: "Café", symbol: "cup.and.saucer.fill", color: .orange),
        .bakery: Appearance(label: "Boulangerie", symbol: "birthday.cake.fill", color: .orange),
        .brewery: Appearance(label: "Brasserie", symbol: "mug.fill", color: .orange),
        .winery: Appearance(label: "Domaine viticole", symbol: "wineglass.fill", color: .orange),
        .nightlife: Appearance(label: "Vie nocturne", symbol: "wineglass.fill", color: .purple),

        // Commerces — jaune/ambre.
        .store: Appearance(label: "Magasin", symbol: "bag.fill", color: .yellow),
        .foodMarket: Appearance(label: "Supermarché", symbol: "cart.fill", color: .yellow),
        .laundry: Appearance(label: "Laverie", symbol: "washer.fill", color: .yellow),

        // Automobile et transports — bleu.
        .gasStation: Appearance(label: "Station-service", symbol: "fuelpump.fill", color: .blue),
        .parking: Appearance(label: "Parking", symbol: "parkingsign", color: .blue),
        .carRental: Appearance(label: "Location de voiture", symbol: "car.fill", color: .blue),
        .evCharger: Appearance(label: "Borne de recharge", symbol: "bolt.car.fill", color: .green),
        .publicTransport: Appearance(label: "Transports", symbol: "tram.fill", color: .blue),
        .airport: Appearance(label: "Aéroport", symbol: "airplane", color: .blue),
        .marina: Appearance(label: "Port de plaisance", symbol: "sailboat.fill", color: .blue),

        // Services — rouge pour l'urgence, bleu pour l'administratif.
        .hospital: Appearance(label: "Hôpital", symbol: "cross.fill", color: .red),
        .pharmacy: Appearance(label: "Pharmacie", symbol: "cross.case.fill", color: .red),
        .fireStation: Appearance(label: "Pompiers", symbol: "flame.fill", color: .red),
        .police: Appearance(label: "Police", symbol: "shield.fill", color: .blue),
        .postOffice: Appearance(label: "Poste", symbol: "envelope.fill", color: .blue),
        .bank: Appearance(label: "Banque", symbol: "banknote.fill", color: .green),
        .atm: Appearance(label: "Distributeur", symbol: "creditcard.fill", color: .green),
        .restroom: Appearance(label: "Toilettes", symbol: "figure.dress.line.vertical.figure", color: .blue),

        // Hébergement — violet.
        .hotel: Appearance(label: "Hôtel", symbol: "bed.double.fill", color: .purple),
        .campground: Appearance(label: "Camping", symbol: "tent.fill", color: .green),

        // Culture et savoir — brun/ocre.
        .museum: Appearance(label: "Musée", symbol: "building.columns.fill", color: .brown),
        .library: Appearance(label: "Bibliothèque", symbol: "books.vertical.fill", color: .brown),
        .school: Appearance(label: "École", symbol: "graduationcap.fill", color: .brown),
        .university: Appearance(label: "Université", symbol: "building.columns.fill", color: .brown),
        .theater: Appearance(label: "Théâtre", symbol: "theatermasks.fill", color: .pink),
        .movieTheater: Appearance(label: "Cinéma", symbol: "film.fill", color: .pink),

        // Nature et sport — vert.
        .park: Appearance(label: "Parc", symbol: "tree.fill", color: .green),
        .nationalPark: Appearance(label: "Parc national", symbol: "leaf.fill", color: .green),
        .beach: Appearance(label: "Plage", symbol: "beach.umbrella.fill", color: .teal),
        .aquarium: Appearance(label: "Aquarium", symbol: "fish.fill", color: .teal),
        .zoo: Appearance(label: "Zoo", symbol: "pawprint.fill", color: .green),
        .stadium: Appearance(label: "Stade", symbol: "sportscourt.fill", color: .green),
        .fitnessCenter: Appearance(label: "Salle de sport", symbol: "figure.run", color: .green),
        .amusementPark: Appearance(label: "Parc d'attractions", symbol: "ferriswheel", color: .pink)
    ]
}

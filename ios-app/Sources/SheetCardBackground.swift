import SwiftUI

// Fond des cartes de contenu **à l'intérieur de la bottom sheet**.
//
// Remplace l'ancien `adaptiveGlassEffect` (AdaptiveGlass.swift, supprimé) : le
// verre y était posé sur le matériau de la sheet, et souvent sur du verre —
// une fiche lieu en verre contenant une carte de détails en verre contenant une
// barre d'actions en verre. Apple réserve Liquid Glass à la couche de contrôle
// flottante (celle qui surnage au-dessus du contenu) et ne l'empile jamais :
// Plans utilise des fonds groupés opaques dès qu'on entre dans la sheet.
// Voir docs/UI_UX_AUDIT_IOS_2026-09.md, P1-1 et P1-2.
//
// Le verre reste donc uniquement au-dessus de la carte
// (ContentView+MapChrome.swift, RecenterButton.swift), où il est légitime — et
// où les styles système `.glass` gèrent eux-mêmes « Réduire la transparence ».
struct SheetCardBackground<S: Shape>: ViewModifier {
    let shape: S

    func body(content: Content) -> some View {
        content.background(Color(.secondarySystemGroupedBackground), in: shape)
    }
}

extension View {
    // Carte de premier niveau dans la sheet (fiche lieu, liste de favoris,
    // panneau GPX/patrouille…).
    func sheetCardBackground<S: Shape>(in shape: S) -> some View {
        modifier(SheetCardBackground(shape: shape))
    }

    // Sous-bloc à l'intérieur d'une carte : un fond « fill » translucide, qui
    // se distingue du blanc de la carte parente sans réintroduire un second
    // niveau de matériau.
    func sheetInnerBackground<S: Shape>(in shape: S) -> some View {
        background(Color(.tertiarySystemFill), in: shape)
    }
}

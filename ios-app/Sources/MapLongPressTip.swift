import TipKit

/// First-run discoverability for the map long-press gesture (drop a pin to
/// teleport, route, add a stop, or save a favorite) — there's no other
/// affordance hinting at it otherwise. Invalidated automatically once the
/// user performs a successful long-press (see `EngineMapView`'s
/// `longPressFeedback` trigger). §3.21 of docs/UI_UX_BASELINE.md.
struct MapLongPressTip: Tip {
    var title: Text {
        Text("Touchez la carte pour agir")
    }

    var message: Text? {
        Text("Maintenez un point enfoncé pour vous y téléporter, lancer un itinéraire ou l'ajouter à vos favoris.")
    }

    var image: Image? {
        Image(systemName: "hand.point.up.left.and.text")
    }
}

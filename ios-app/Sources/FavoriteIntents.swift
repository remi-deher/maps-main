import AppIntents

// Exposes the engine's favorites as App Intent entities so Siri, Spotlight and
// the Shortcuts app can teleport to one by name ("Téléporte-moi à Maison")
// without opening the app (§3.23 of docs/UI_UX_BASELINE.md). Like the
// simulation intents, this acts on the live connection via EngineClient.shared;
// if the engine isn't connected the underlying send is a no-op.

/// One favorite, mirrored from `Favorite` (EngineProtocolModels.swift). The id is the
/// same `"lat,lon"` string the engine status uses, so resolution stays stable.
struct FavoriteEntity: AppEntity, Identifiable {
    let id: String
    let lat: Double
    let lon: Double
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Favori"

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var defaultQuery = FavoriteQuery()
}

/// Resolves favorites from the live engine status. There's no local store —
/// favorites live engine-side and arrive via STATUS broadcasts — so an empty
/// list (engine disconnected) simply yields no suggestions.
struct FavoriteQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [FavoriteEntity] {
        allFavorites().filter { identifiers.contains($0.id) }
    }

    @MainActor
    func suggestedEntities() async throws -> [FavoriteEntity] {
        allFavorites()
    }

    @MainActor
    private func allFavorites() -> [FavoriteEntity] {
        (EngineClient.shared?.status?.favorites ?? []).map { fav in
            FavoriteEntity(
                id: fav.id,
                lat: fav.lat,
                lon: fav.lon,
                name: fav.name ?? "Favori"
            )
        }
    }
}

struct TeleportToFavoriteIntent: AppIntent {
    static var title: LocalizedStringResource = "Téléporter vers un favori"
    static var description = IntentDescription("Téléporte la position simulée vers un lieu favori enregistré.")

    @Parameter(title: "Favori")
    var favorite: FavoriteEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        EngineClient.shared?.setLocation(lat: favorite.lat, lon: favorite.lon, name: favorite.name)
        return .result()
    }
}

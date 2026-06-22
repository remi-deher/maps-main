import AppIntents

// App Intents exposing the running-simulation controls to Siri, Spotlight and
// the Shortcuts app (§3.5 / §3.23 of docs/UI_UX_BASELINE.md). They act on the
// live engine connection via EngineClient.shared; if the engine isn't
// connected the underlying send is a no-op, so they fail gracefully.

struct PauseSimulationIntent: AppIntent {
    static var title: LocalizedStringResource = "Mettre la simulation en pause"
    static var description = IntentDescription("Met en pause la simulation GPS en cours.")

    @MainActor
    func perform() async throws -> some IntentResult {
        EngineClient.shared?.pauseRoute()
        return .result()
    }
}

struct ResumeSimulationIntent: AppIntent {
    static var title: LocalizedStringResource = "Reprendre la simulation"
    static var description = IntentDescription("Reprend une simulation GPS en pause.")

    @MainActor
    func perform() async throws -> some IntentResult {
        EngineClient.shared?.resumeRoute()
        return .result()
    }
}

struct StopSimulationIntent: AppIntent {
    static var title: LocalizedStringResource = "Arrêter la simulation"
    static var description = IntentDescription("Arrête la simulation GPS en cours.")

    @MainActor
    func perform() async throws -> some IntentResult {
        EngineClient.shared?.stopRoute()
        return .result()
    }
}

struct RelanceSimulationIntent: AppIntent {
    static var title: LocalizedStringResource = "Relancer la position"
    static var description = IntentDescription("Réinjecte la dernière position simulée (relance).")

    @MainActor
    func perform() async throws -> some IntentResult {
        EngineClient.shared?.relance()
        return .result()
    }
}

struct GpsMockShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PauseSimulationIntent(),
            phrases: ["Mettre \(.applicationName) en pause", "Pause \(.applicationName)"],
            shortTitle: "Pause",
            systemImageName: "pause.fill"
        )
        AppShortcut(
            intent: ResumeSimulationIntent(),
            phrases: ["Reprendre \(.applicationName)"],
            shortTitle: "Reprendre",
            systemImageName: "play.fill"
        )
        AppShortcut(
            intent: StopSimulationIntent(),
            phrases: ["Arrêter \(.applicationName)"],
            shortTitle: "Arrêter",
            systemImageName: "stop.fill"
        )
        AppShortcut(
            intent: RelanceSimulationIntent(),
            phrases: ["Relancer \(.applicationName)"],
            shortTitle: "Relancer",
            systemImageName: "arrow.clockwise"
        )
    }
}

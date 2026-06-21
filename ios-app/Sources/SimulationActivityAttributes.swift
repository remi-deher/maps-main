import ActivityKit

/// Shared between the main app (starts/updates/ends the activity) and the
/// GpsMockWidgets extension (renders it) — must be a member of both targets.
struct SimulationActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var state: String // moving | paused
        var locationName: String?
    }
}

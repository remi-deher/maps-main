import ActivityKit
import Foundation
import Observation

// Starts/updates/ends the Lock Screen + Dynamic Island Live Activity that
// mirrors the engine's simulation state — entirely client-side (no push
// updates needed since the app is the one driving state changes). Gated by
// a user-facing toggle (SettingsSheet) since some users may not want a
// Lock Screen widget revealing that a simulation is running.
@MainActor
@Observable
final class LiveActivityManager {
    private var activity: Activity<SimulationActivityAttributes>?

    // Call whenever engine.status changes. No-ops if disabled or the
    // simulation isn't running; ends a previously-started activity the
    // moment either condition becomes true.
    func sync(state: String?, locationName: String?, enabled: Bool) {
        guard enabled, let state, state == "moving" || state == "paused" else {
            endIfNeeded()
            return
        }

        let contentState = SimulationActivityAttributes.ContentState(state: state, locationName: locationName)
        let content = ActivityContent(state: contentState, staleDate: nil)

        if let activity {
            Task { await activity.update(content) }
        } else {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            do {
                activity = try Activity.request(attributes: SimulationActivityAttributes(), content: content)
            } catch {
                AppLogger.shared.error("Live Activity request failed: \(error)")
            }
        }
    }

    // Call when the toggle is switched off explicitly, in addition to the
    // automatic end inside sync(enabled: false).
    func endIfNeeded() {
        guard let activity else { return }
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
        self.activity = nil
    }
}

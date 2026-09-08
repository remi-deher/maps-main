import BackgroundTasks
import Foundation

// Opportunistic safety net for the standby keep-alive — NOT the primary
// mechanism. Continuous execution in standby comes from the `location`
// background mode (LocationManager + ContentView's location callback); this
// only covers the gaps where iOS has nonetheless suspended the app (Always
// authorization refused, or the GPS stream stalled after a long period of
// perfect stillness). When the system grants one of its ~15 min+ refresh
// windows, this reconnects to the engine and re-asserts the last injected
// position once, then reschedules itself.
//
// Uses a transient EngineClient rather than the view's live instance: a
// BGAppRefreshTask wakes the app for ~30 s and suspends it again, so there's
// nothing to keep alive afterwards — a one-shot connect + RELANCE is enough,
// and the engine already accepts several concurrent clients (desktop + iOS +
// headless), so an extra short-lived one is harmless.
enum BackgroundRefreshManager {
    // Must also appear in project.yml's BGTaskSchedulerPermittedIdentifiers,
    // or submit(_:) throws .notPermitted.
    static let taskIdentifier = "com.remi2.gpsmock.companion.keepalive"

    // Registered from the App initializer (before launch completes, as
    // BGTaskScheduler requires).
    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            handle(refreshTask)
        }
    }

    // Schedules the next refresh. `earliestBeginDate` is only a hint — the
    // system picks the actual time based on usage and power. Called on entering
    // the background and again from inside the handler (re-schedule pattern).
    static func schedule() {
        guard keepAliveEnabled, !engineAddress.isEmpty else { return }
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            AppLogger.shared.warn("Planification du réveil arrière-plan échouée: \(error.localizedDescription)")
        }
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule() // re-arm before doing any work

        guard keepAliveEnabled, !engineAddress.isEmpty else {
            task.setTaskCompleted(success: true)
            return
        }

        // EngineClient is main-actor isolated, so the whole one-shot runs
        // there. BGTaskScheduler hands us this callback on an arbitrary queue,
        // hence the hop.
        let address = engineAddress
        Task { @MainActor in
            await runOneShotRelance(for: task, address: address)
        }
    }

    // Connects, re-asserts the position once, and tears the socket back down.
    //
    // The engine is held for the lifetime of the work so ARC can't close the
    // socket before RELANCE flushes, and setTaskCompleted is called from
    // exactly one place — awaiting the work — instead of from both the happy
    // path and the expiration handler, which could report the task twice.
    @MainActor
    private static func runOneShotRelance(for task: BGAppRefreshTask, address: String) async {
        let engine = EngineClient()
        let work = Task { @MainActor in
            // engine_health's checkAuth rejects any non-loopback client with no
            // paired-device token — building the bare ws://… endpoint here
            // (instead of going through the same helper as the foreground
            // connect path) meant this background reconnect was silently
            // rejected whenever the engine wasn't on localhost, so the
            // safety-net RELANCE never actually fired.
            engine.connect(to: MapSessionModel.webSocketEndpoint(for: address))
            // Wait up to ~10 s for the handshake (well within the ~30 s budget).
            for _ in 0..<20 {
                if Task.isCancelled || engine.state == .connected { break }
                try? await Task.sleep(for: .milliseconds(500))
            }
            let connected = engine.state == .connected
            if connected { engine.relance() }
            // Give the send a moment to flush before the socket is closed.
            try? await Task.sleep(for: .seconds(1))
            engine.disconnect()
            return connected
        }

        // Cancelling unblocks the sleeps above, so the work falls through to
        // disconnect() and returns on its own.
        task.expirationHandler = { work.cancel() }

        task.setTaskCompleted(success: await work.value)
    }

    // @AppStorage is backed by UserDefaults — read the same keys here, applying
    // the app's own defaults for keys the user has never toggled.
    private static var keepAliveEnabled: Bool {
        UserDefaults.standard.object(forKey: "keepAliveEnabled") as? Bool ?? true
    }

    private static var engineAddress: String {
        UserDefaults.standard.string(forKey: "engineAddress") ?? ""
    }
}

import SwiftUI
import TipKit

@main
struct GpsMockCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        try? Tips.configure()
        // BGTaskScheduler requires handlers be registered before launch
        // completes — the App initializer is the SwiftUI equivalent of
        // didFinishLaunchingWithOptions.
        BackgroundRefreshManager.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, phase in
            // Arm the safety-net refresh when leaving the foreground; it's a
            // no-op unless keep-alive is on and an engine address is known.
            if phase == .background { BackgroundRefreshManager.schedule() }
        }
    }
}

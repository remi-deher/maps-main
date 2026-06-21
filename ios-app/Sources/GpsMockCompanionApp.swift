import SwiftUI
import TipKit

@main
struct GpsMockCompanionApp: App {
    init() {
        try? Tips.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

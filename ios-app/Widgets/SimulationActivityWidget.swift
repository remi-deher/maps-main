import ActivityKit
import WidgetKit
import SwiftUI

// Lock Screen + Dynamic Island presentation for the running simulation.
//
// Affichage seul : les boutons `Button(intent:)` d'une Live Activity exigent
// que l'intent soit compilé dans la cible widget *et* dans l'app (il s'exécute
// côté app), donc un App Group et un client moteur partagé entre les deux
// cibles — chantier à part, cf. docs/UI_UX_AUDIT_IOS_2026-09.md, P1-7.
// En attendant, le tap ouvre l'app sur le détail de l'itinéraire via
// `widgetURL`, ce que la version précédente affirmait faire sans le faire.
struct SimulationActivityWidget: Widget {
    // URL ouverte au tap. Le schéma est déclaré dans project.yml
    // (CFBundleURLTypes) et traité par ContentView.onOpenURL.
    private static let deepLink = URL(string: "gpsmock://simulation")

    var body: some WidgetConfiguration {
        ActivityConfiguration(
            for: SimulationActivityAttributes.self,
            content: { context in
                HStack(spacing: 12) {
                    Image(systemName: Self.symbol(for: context.state.state))
                        .font(.title2)
                        .foregroundStyle(Color.accentColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.state.state == "paused" ? "Simulation en pause" : "Simulation en cours")
                            .font(.subheadline.weight(.semibold))
                        if let name = context.state.locationName {
                            Text(name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                }
                .padding()
                .widgetURL(Self.deepLink)
            },
            dynamicIsland: { context in
                DynamicIsland {
                    DynamicIslandExpandedRegion(.leading) {
                        Image(systemName: Self.symbol(for: context.state.state))
                            .foregroundStyle(Color.accentColor)
                    }
                    DynamicIslandExpandedRegion(.trailing) {
                        Text(context.state.state == "paused" ? "Pause" : "Actif")
                            .font(.caption.weight(.semibold))
                    }
                    DynamicIslandExpandedRegion(.center) {
                        Text(context.state.locationName ?? "GPS-Mock")
                            .font(.caption)
                            .lineLimit(1)
                    }
                } compactLeading: {
                    Image(systemName: Self.symbol(for: context.state.state))
                        .foregroundStyle(Color.accentColor)
                } compactTrailing: {
                    // Symboles SF plutôt que « ▶ » / « II » en texte : mise à
                    // l'échelle correcte, teinte système, et lecture VoiceOver
                    // cohérente avec le reste de l'île.
                    Image(systemName: context.state.state == "paused" ? "pause.fill" : "play.fill")
                        .foregroundStyle(Color.accentColor)
                } minimal: {
                    Image(systemName: Self.symbol(for: context.state.state))
                        .foregroundStyle(Color.accentColor)
                }
                .keylineTint(Color.accentColor)
                .widgetURL(Self.deepLink)
            }
        )
    }

    private static func symbol(for state: String) -> String {
        state == "paused" ? "pause.circle.fill" : "location.fill"
    }
}

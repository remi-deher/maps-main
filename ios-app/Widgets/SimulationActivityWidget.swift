import ActivityKit
import WidgetKit
import SwiftUI

/// Lock Screen + Dynamic Island presentation for the running simulation.
/// Display-only (no buttons) to keep this widget-process view simple —
/// pausing/stopping stays in the app, reachable via the Dynamic Island tap
/// target which deep-links back into GpsMockCompanion.
struct SimulationActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SimulationActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Image(systemName: context.state.state == "paused" ? "pause.circle.fill" : "location.fill")
                    .font(.title2)
                    .foregroundStyle(.indigo)
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
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.state == "paused" ? "pause.circle.fill" : "location.fill")
                        .foregroundStyle(.indigo)
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
                Image(systemName: context.state.state == "paused" ? "pause.circle.fill" : "location.fill")
                    .foregroundStyle(.indigo)
            } compactTrailing: {
                Text(context.state.state == "paused" ? "II" : "▶")
                    .font(.caption2.weight(.bold))
            } minimal: {
                Image(systemName: context.state.state == "paused" ? "pause.circle.fill" : "location.fill")
                    .foregroundStyle(.indigo)
            }
            .keylineTint(.indigo)
        }
    }
}

import SwiftUI

/// Sheet panel shown once a GPX file has been picked: confirms the file, lets
/// the user set a playback speed, and launches the simulation. Promoted out of
/// Réglages › Outils so importing a track is a peer of teleport / route /
/// itinerary — a way to start a simulation — rather than an admin tool buried
/// in settings.
struct GpxPanel: View {
    let fileName: String
    @Binding var speed: Double
    var onLaunch: () -> Void
    var onCancel: () -> Void

    @State private var launchFeedback = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(fileName, systemImage: "doc.badge.gearshape")
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button(action: onCancel) {
                    Label("Annuler l'import GPX", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
            }

            HStack {
                Text("Vitesse de simulation")
                Spacer()
                Text("\(Int(speed)) km/h")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .font(.subheadline)
            Slider(value: $speed, in: 1...250, step: 5) {
                Text("Vitesse de simulation")
            }
            .accessibilityValue("\(Int(speed)) kilomètres heure")

            Button("Lancer la simulation GPX") {
                launchFeedback += 1
                onLaunch()
            }
            .buttonStyle(.glassProminent)
            .tint(.accentColor)
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .padding(18)
        .adaptiveGlassEffect(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
        .sensoryFeedback(.success, trigger: launchFeedback)
    }
}

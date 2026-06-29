import SwiftUI

// Sheet panel for defining a patrol zone, promoted out of Réglages so the
// zone is set up *against the map* (with a live dashed preview drawn while you
// drag the radius) rather than blind in a settings form. A circle is centered
// on the current spoofed/real position; a rectangle uses whatever the map is
// currently showing — so the spatial choice is made by panning/zooming the
// map underneath this panel, exactly like framing a shot in Plans.
struct PatrolPanel: View {
    @Binding var type: String
    @Binding var radius: Double
    var onLaunch: () -> Void
    var onCancel: () -> Void

    @State private var launchFeedback = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Zone de patrouille")
                    .font(.headline)
                Spacer()
                Button(action: onCancel) {
                    Label("Annuler la patrouille", systemImage: "xmark.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(.secondary)
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
            }

            Picker("Type de zone", selection: $type) {
                Label("Cercle", systemImage: "circle.dashed").tag("circle")
                Label("Rectangle", systemImage: "rectangle.dashed").tag("rectangle")
            }
            .pickerStyle(.segmented)

            if type == "circle" {
                HStack {
                    Text("Rayon")
                    Spacer()
                    Text("\(Int(radius)) m")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .font(.subheadline)
                Slider(value: $radius, in: 50...2000, step: 50) {
                    Text("Rayon")
                }
                .accessibilityValue("\(Int(radius)) mètres")
            } else {
                Text("La zone actuellement visible sur la carte servira de rectangle de patrouille — déplacez ou zoomez la carte pour la cadrer.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("Lancer la patrouille") {
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

import SwiftUI

/// Floating glass card listing the stops of an itinerary being built — à la
/// Plans' multi-stop directions editor. Reordering uses up/down buttons
/// rather than drag handles, since this card lives outside a List (which is
/// where SwiftUI's native drag-to-reorder normally requires hosting it).
struct ItineraryPanel: View {
    @Binding var stops: [RouteStop]
    @Binding var speed: Double
    @Binding var profile: String
    var onAddStop: () -> Void
    var onLaunch: () -> Void
    var onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Itinéraire (\(stops.count) étape\(stops.count > 1 ? "s" : ""))")
                    .font(.headline)
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
            }

            VStack(spacing: 0) {
                ForEach(Array(stops.enumerated()), id: \.element.id) { index, stop in
                    HStack(spacing: 10) {
                        Text("\(index + 1)")
                            .font(.caption.bold())
                            .frame(width: 22, height: 22)
                            .background(.indigo, in: Circle())
                            .foregroundStyle(.white)

                        Text(stop.name)
                            .lineLimit(1)

                        Spacer()

                        Button {
                            moveUp(index)
                        } label: {
                            Image(systemName: "chevron.up")
                        }
                        .disabled(index == 0)

                        Button {
                            moveDown(index)
                        } label: {
                            Image(systemName: "chevron.down")
                        }
                        .disabled(index == stops.count - 1)

                        Button {
                            stops.remove(at: index)
                        } label: {
                            Image(systemName: "trash")
                                .foregroundStyle(.red)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 6)

                    if index < stops.count - 1 {
                        Divider()
                    }
                }
            }

            Button(action: onAddStop) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Ajouter un arrêt")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glass)

            HStack {
                Text("Vitesse")
                Stepper("\(Int(speed)) km/h", value: $speed, in: 5...130, step: 5)
            }
            .font(.subheadline)

            Picker("Profil", selection: $profile) {
                Text("Voiture").tag("driving")
                Text("Marche").tag("walking")
            }
            .pickerStyle(.segmented)

            Button("Lancer l'itinéraire", action: onLaunch)
                .buttonStyle(.glassProminent)
                .tint(.indigo)
                .frame(maxWidth: .infinity)
                .disabled(stops.isEmpty)
        }
        .padding(18)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
    }

    private func moveUp(_ index: Int) {
        guard index > 0 else { return }
        stops.swapAt(index, index - 1)
    }

    private func moveDown(_ index: Int) {
        guard index < stops.count - 1 else { return }
        stops.swapAt(index, index + 1)
    }
}

import SwiftUI

/// Floating "omnibar" à la Plans: a glass search capsule plus a separate
/// glass settings button, grouped in one GlassEffectContainer so they share
/// consistent blur/lighting and can morph together (per Apple's iOS 26
/// Liquid Glass guidance: glass effects should be grouped, not applied to
/// each element independently).
struct OmniBar: View {
    @Binding var query: String
    var isFocused: FocusState<Bool>.Binding
    var onSettingsTap: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(.secondary)

                    TextField("Rechercher une adresse", text: $query)
                        .focused(isFocused)
                        .submitLabel(.search)

                    if !query.isEmpty {
                        Button {
                            query = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .glassEffect(.regular.interactive(), in: .capsule)

                Button(action: onSettingsTap) {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 46, height: 46)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
    }
}

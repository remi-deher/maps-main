import SwiftUI

/// Live view of the engine's in-memory log buffer (LOG/LOGS events) — gives
/// admin/debug visibility from the phone alone, no terminal/SSH access to the
/// machine running the engine required.
struct LogsView: View {
    @ObservedObject var engine: EngineClient

    @State private var query = ""
    @State private var levelFilter: LevelFilter = .all

    private enum LevelFilter: String, CaseIterable {
        case all = "Tous"
        case info = "Info"
        case warn = "Avertissements"
        case error = "Erreurs"

        var rawLevel: String? {
            switch self {
            case .all: return nil
            case .info: return "info"
            case .warn: return "warn"
            case .error: return "error"
            }
        }
    }

    private let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private var filteredLogs: [LogEntryPayload] {
        engine.logs.reversed().filter { entry in
            if let rawLevel = levelFilter.rawLevel, entry.level != rawLevel { return false }
            guard !query.isEmpty else { return true }
            return entry.message.localizedCaseInsensitiveContains(query)
                || entry.source.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            if engine.logs.isEmpty {
                ContentUnavailableView(
                    "Aucun journal",
                    systemImage: "doc.text",
                    description: Text("Les événements du moteur apparaîtront ici en temps réel.")
                )
            } else {
                Picker("Niveau", selection: $levelFilter) {
                    ForEach(LevelFilter.allCases, id: \.self) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)

                ForEach(Array(filteredLogs.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(for: entry.level))
                            .foregroundStyle(color(for: entry.level))
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.message)
                                .font(.subheadline)
                            HStack(spacing: 6) {
                                Text(entry.source)
                                Text("·")
                                Text(timeFormatter.string(from: Date(timeIntervalSince1970: Double(entry.timestamp) / 1000)))
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Rechercher dans les journaux")
        .navigationTitle("Journaux")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { engine.getLogs() }
        .onAppear { engine.getLogs() }
    }

    private func icon(for level: String) -> String {
        switch level {
        case "error": return "xmark.octagon.fill"
        case "warn": return "exclamationmark.triangle.fill"
        default: return "info.circle.fill"
        }
    }

    private func color(for level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn": return .orange
        default: return .secondary
        }
    }
}

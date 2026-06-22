import SwiftUI

/// Live view of two log sources: the engine's in-memory buffer (LOG/LOGS
/// events over the WebSocket) and the app's own client-side buffer
/// (`AppLogger` — connection, discovery, OSRM, notifications). Gives
/// admin/debug visibility from the phone alone, no terminal/SSH access to
/// the machine running the engine, or a Mac + Console.app for the client
/// side, required.
struct LogsView: View {
    var engine: EngineClient
    private var appLogger = AppLogger.shared

    @State private var query = ""
    @State private var levelFilter: LevelFilter = .all
    @State private var source: LogSource = .engine

    private enum LogSource: String, CaseIterable {
        case engine = "Moteur"
        case app = "App"
    }

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

    private struct DisplayRow: Identifiable {
        let id: Int
        let level: String
        let message: String
        let detail: String
        let date: Date
    }

    private let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private var rows: [DisplayRow] {
        switch source {
        case .engine:
            return engine.logs.reversed().enumerated().map { offset, entry in
                DisplayRow(
                    id: offset,
                    level: entry.level,
                    message: entry.message,
                    detail: entry.source,
                    date: Date(timeIntervalSince1970: Double(entry.timestamp) / 1000)
                )
            }
        case .app:
            return appLogger.entries.reversed().enumerated().map { offset, entry in
                DisplayRow(id: offset, level: entry.level, message: entry.message, detail: "app", date: entry.timestamp)
            }
        }
    }

    private var filteredRows: [DisplayRow] {
        rows.filter { row in
            if let rawLevel = levelFilter.rawLevel, row.level != rawLevel { return false }
            guard !query.isEmpty else { return true }
            return row.message.localizedCaseInsensitiveContains(query)
                || row.detail.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            Picker("Source", selection: $source) {
                ForEach(LogSource.allCases, id: \.self) { source in
                    Text(source.rawValue).tag(source)
                }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)

            if rows.isEmpty {
                ContentUnavailableView(
                    "Aucun journal",
                    systemImage: "doc.text",
                    description: Text(source == .engine
                        ? "Les événements du moteur apparaîtront ici en temps réel."
                        : "Les événements côté app (connexion, découverte, OSRM, notifications) apparaîtront ici.")
                )
            } else {
                Picker("Niveau", selection: $levelFilter) {
                    ForEach(LevelFilter.allCases, id: \.self) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)

                ForEach(filteredRows) { row in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(for: row.level))
                            .foregroundStyle(color(for: row.level))
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.message)
                                .font(.subheadline)
                            HStack(spacing: 6) {
                                Text(row.detail)
                                Text("·")
                                Text(timeFormatter.string(from: row.date))
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

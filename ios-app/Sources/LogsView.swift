import SwiftUI

// Live view of two log sources: the engine's in-memory buffer (LOG/LOGS
// events over the WebSocket) and the app's own client-side buffer
// (`AppLogger` — connection, discovery, OSRM, notifications). Gives
// admin/debug visibility from the phone alone, no terminal/SSH access to
// the machine running the engine, or a Mac + Console.app for the client
// side, required.
struct LogsView: View {
    var engine: any EngineClientProtocol
    private var appLogger = AppLogger.shared

    init(engine: any EngineClientProtocol) {
        self.engine = engine
    }

    @State private var query = ""
    @State private var levelFilter: LevelFilter = .all
    @State private var source: LogSource = .engine
    @State private var logMode: LogMode = .normal
    @State private var isCopied = false

    private enum LogSource: String, CaseIterable {
        case engine = "Moteur"
        case app = "App"
    }

    private enum LogMode: String, CaseIterable {
        case normal = "Normal"
        case ultraDetailed = "Ultra-détaillé"
    }

    private enum LevelFilter: String, CaseIterable {
        case all = "Tous"
        case info = "Info"
        case debugConsole = "Debug & Console"
        case warn = "Avertissements"
        case error = "Erreurs"

        var rawLevels: [String]? {
            switch self {
            case .all: return nil
            case .info: return ["info"]
            case .debugConsole: return ["debug", "console"]
            case .warn: return ["warn"]
            case .error: return ["error"]
            }
        }
    }

    private struct DisplayRow: Identifiable {
        let id: Int
        let level: String
        let message: String
        let detail: String
        let fields: String
        let date: Date
    }

    private let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private let timeFormatterMs: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
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
                    detail: [entry.source, entry.category, entry.action]
                        .compactMap { value in
                            guard let value, !value.isEmpty else { return nil }
                            return value
                        }
                        .joined(separator: " / "),
                    fields: formatFields(entry.fields),
                    date: Date(timeIntervalSince1970: Double(entry.timestamp) / 1000)
                )
            }
        case .app:
            return appLogger.entries.reversed().enumerated().map { offset, entry in
                DisplayRow(id: offset, level: entry.level, message: entry.message, detail: "app", fields: "", date: entry.timestamp)
            }
        }
    }

    private var filteredRows: [DisplayRow] {
        rows.filter { row in
            // Filter by log mode (normal hides debug/console entries by default unless explicitly filtered)
            if logMode == .normal && levelFilter == .all {
                if row.level == "debug" || row.level == "console" {
                    return false
                }
            }
            if let rawLevels = levelFilter.rawLevels, !rawLevels.contains(row.level) {
                return false
            }
            guard !query.isEmpty else { return true }
            return row.message.localizedCaseInsensitiveContains(query)
                || row.detail.localizedCaseInsensitiveContains(query)
                || row.fields.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            VStack(spacing: 8) {
                Picker("Mode", selection: $logMode) {
                    ForEach(LogMode.allCases, id: \.self) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                Picker("Source", selection: $source) {
                    ForEach(LogSource.allCases, id: \.self) { source in
                        Text(source.rawValue).tag(source)
                    }
                }
                .pickerStyle(.segmented)
            }
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
                                .font(logMode == .ultraDetailed ? .caption.monospaced() : .subheadline)
                            HStack(spacing: 6) {
                                Text(row.detail)
                                Text("·")
                                Text(logMode == .ultraDetailed
                                    ? timeFormatterMs.string(from: row.date)
                                    : timeFormatter.string(from: row.date))
                                if logMode == .ultraDetailed {
                                    Text("·")
                                    Text(row.level.uppercased())
                                        .font(.caption2.bold())
                                        .foregroundStyle(color(for: row.level))
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                            if !row.fields.isEmpty {
                                Text(row.fields)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(logMode == .ultraDetailed ? nil : 2)
                            }
                        }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Rechercher dans les journaux")
        .navigationTitle("Journaux")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: copyLogsToClipboard) {
                    Label(isCopied ? "Copié !" : "Copier", systemImage: isCopied ? "checkmark" : "doc.on.doc")
                }
                .disabled(filteredRows.isEmpty)
            }
        }
        .refreshable { engine.getLogs() }
        .onAppear { engine.getLogs() }
    }

    private func copyLogsToClipboard() {
        let formatter = logMode == .ultraDetailed ? timeFormatterMs : timeFormatter
        let exportText = filteredRows.map { row in
            let timestamp = formatter.string(from: row.date)
            let fields = row.fields.isEmpty ? "" : " | \(row.fields)"
            return "[\(timestamp)] [\(row.level.uppercased())] [\(row.detail)] \(row.message)\(fields)"
        }.joined(separator: "\n")

        UIPasteboard.general.string = exportText
        isCopied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            isCopied = false
        }
    }

    private func icon(for level: String) -> String {
        switch level {
        case "error": return "xmark.octagon.fill"
        case "warn": return "exclamationmark.triangle.fill"
        case "debug": return "ladybug.fill"
        case "console": return "terminal.fill"
        default: return "info.circle.fill"
        }
    }

    private func color(for level: String) -> Color {
        switch level {
        case "error": return .red
        case "warn": return .orange
        case "debug": return .purple
        case "console": return .cyan
        default: return .secondary
        }
    }

    private func formatFields(_ fields: [String: String]?) -> String {
        guard let fields, !fields.isEmpty else { return "" }
        return fields
            .sorted { $0.key < $1.key }
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: " ")
    }
}

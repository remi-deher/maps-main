package engine

import "github.com/remi-deher/maps-main/engine/internal/api"

const maxLogEntries = 500

// Log appends an entry to the in-memory buffer and broadcasts it immediately.
func (e *Engine) Log(level, source, message string) {
	e.LogEvent(level, source, "", "", message, nil)
}

// LogDebug appends a debug entry to the in-memory buffer and broadcasts it.
func (e *Engine) LogDebug(source, message string) {
	e.LogEvent("debug", source, "", "", message, nil)
}

// LogConsole appends a console output entry to the in-memory buffer and broadcasts it.
func (e *Engine) LogConsole(source, message string) {
	e.LogEvent("console", source, "", "", message, nil)
}

// LogEvent appends a structured entry to the in-memory buffer and broadcasts it.
func (e *Engine) LogEvent(level, source, category, action, message string, fields map[string]string) {
	entry := e.logService.Add(level, source, category, action, message, fields)

	e.mu.RLock()
	emit := e.emit
	e.mu.RUnlock()
	emit(api.EventLog, entry)
}

// GetLogs returns a snapshot of the current log buffer, oldest first.
func (e *Engine) GetLogs() []api.LogEntryPayload {
	return e.logService.Get()
}

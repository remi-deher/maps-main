package engine

import "github.com/remi-deher/maps-main/engine/internal/api"

const maxLogEntries = 200

// Log appends an entry to the in-memory buffer and broadcasts it immediately.
func (e *Engine) Log(level, source, message string) {
	e.LogEvent(level, source, "", "", message, nil)
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

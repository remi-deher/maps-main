package engine

import (
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
)

// LogService buffers log entries in-memory and handles normalized formatting.
type LogService struct {
	mu      sync.Mutex
	logs    []api.LogEntryPayload
	maxLogs int
}

// NewLogService creates a new LogService with a defined log buffer limit.
func NewLogService(maxLogs int) *LogService {
	return &LogService{
		maxLogs: maxLogs,
	}
}

// Add appends a new structured log entry to the buffer and returns it.
func (s *LogService) Add(level, source, category, action, message string, fields map[string]string) api.LogEntryPayload {
	entry := api.LogEntryPayload{
		Timestamp: time.Now().UnixMilli(),
		Level:     normalizeLogLevel(level),
		Source:    source,
		Category:  category,
		Action:    action,
		Message:   message,
		Fields:    fields,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.logs = append(s.logs, entry)
	if len(s.logs) > s.maxLogs {
		s.logs = s.logs[len(s.logs)-s.maxLogs:]
	}
	return entry
}

// Get returns a copy of the log buffer.
func (s *LogService) Get() []api.LogEntryPayload {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]api.LogEntryPayload, len(s.logs))
	copy(out, s.logs)
	return out
}

func normalizeLogLevel(level string) string {
	switch level {
	case "warn", "error":
		return level
	default:
		return "info"
	}
}

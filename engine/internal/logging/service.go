package logging

import (
	"sync"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
)

// Service buffers structured log entries in memory.
type Service struct {
	mu      sync.Mutex
	logs    []api.LogEntryPayload
	maxLogs int
}

// NewService creates a new log buffer with a defined limit.
func NewService(maxLogs int) *Service {
	return &Service{
		maxLogs: maxLogs,
	}
}

// Add appends a new structured log entry to the buffer and returns it.
func (s *Service) Add(level, source, category, action, message string, fields map[string]string) api.LogEntryPayload {
	entry := api.LogEntryPayload{
		Timestamp: time.Now().UnixMilli(),
		Level:     normalizeLevel(level),
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
func (s *Service) Get() []api.LogEntryPayload {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]api.LogEntryPayload, len(s.logs))
	copy(out, s.logs)
	return out
}

func normalizeLevel(level string) string {
	switch level {
	case "warn", "error", "debug", "console":
		return level
	default:
		return "info"
	}
}

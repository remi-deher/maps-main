package routing

import (
	"net/http"
	"time"
)

// HTTPClient is package-level so tests can replace it with an httptest
// transport without touching real providers.
var HTTPClient = &http.Client{Timeout: 10 * time.Second}

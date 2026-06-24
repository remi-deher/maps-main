// Command wsclient is a local manual-testing tool: it connects to a running
// gpsmock-engine over its WebSocket API, sends ONE action, prints the matching
// reply as a single compact JSON line on stdout, then exits. It is meant to be
// driven by scripts/test-local.ps1, which does the menu/formatting/looping in
// PowerShell — this binary only speaks JSON in and JSON out, so it stays a
// dumb, scriptable building block instead of its own interactive UI.
//
// Everything other than the final JSON reply (connection retries, errors) goes
// to stderr, so stdout can be piped straight into ConvertFrom-Json.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

// replyTypeFor maps an action to the event type its direct reply carries, so
// runOnce can ignore unrelated broadcasts (TELEMETRY ticks, LOG lines from
// something else entirely) while waiting for the answer to THIS call.
// SWITCH_DRIVER/start-tunnel-ish actions reply via a STATUS broadcast once the
// driver is actually up, which can take longer than a plain query.
var replyTypeFor = map[string]string{
	"GET_STATUS":          "STATUS",
	"GET_DIAGNOSTICS":     "DIAGNOSTICS",
	"GET_NETWORK_DEVICES": "NETWORK_DEVICES",
	"SCAN_MDNS":           "MDNS_DEVICES",
	"PROBE_RSD_PORTS":     "RSD_PORTS",
	"GET_DEVICE_INFO":     "DEVICE_INFO",
	"GET_LOGS":            "LOGS",
	"SET_LOCATION":        "STATUS",
	"CLEAR_LOCATION":      "STATUS",
	"HEARTBEAT":           "PONG",
	"SWITCH_DRIVER":       "STATUS",
	"PAIR_DEVICE":         "PAIR_RESULT",
}

var longTimeoutActions = map[string]time.Duration{
	"SWITCH_DRIVER":   30 * time.Second,
	"SCAN_MDNS":       15 * time.Second, // 5s browse + up to 3s+3s per-instance dns-sd -L/-G resolution
	"PROBE_RSD_PORTS": 10 * time.Second, // ~180 candidate ports, 32 at a time
	"PAIR_DEVICE":     45 * time.Second, // waits on the user accepting the on-screen "Trust" prompt
}

func main() {
	addr := flag.String("addr", "localhost:8080", "engine listen address (host:port)")
	timeout := flag.Duration("timeout", 5*time.Second, "how long to wait for the matching reply")
	flag.Parse()

	args := flag.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: wsclient -addr host:port ACTION_TYPE [json-data]")
		os.Exit(2)
	}
	actionType := args[0]
	var data any
	if len(args) > 1 {
		if err := json.Unmarshal([]byte(args[1]), &data); err != nil {
			fmt.Fprintf(os.Stderr, "JSON invalide: %v\n", err)
			os.Exit(2)
		}
	}

	u := url.URL{Scheme: "ws", Host: *addr, Path: "/ws"}

	var conn *websocket.Conn
	var err error
	for attempt := 1; attempt <= 20; attempt++ {
		conn, _, err = websocket.DefaultDialer.Dial(u.String(), nil)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Échec de connexion à %s après plusieurs tentatives: %v\n", u.String(), err)
		os.Exit(1)
	}
	defer conn.Close()

	env := map[string]any{"type": actionType}
	if data != nil {
		env["data"] = data
	}
	if err := conn.WriteJSON(env); err != nil {
		fmt.Fprintf(os.Stderr, "Échec d'envoi: %v\n", err)
		os.Exit(1)
	}

	wantType, known := replyTypeFor[actionType]
	deadline := *timeout
	if d, ok := longTimeoutActions[actionType]; ok {
		deadline = d
	}
	_ = conn.SetReadDeadline(time.Now().Add(deadline))

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			fmt.Fprintln(os.Stdout, `{"type":"ERROR","data":{"message":"timeout en attente de réponse"}}`)
			os.Exit(1)
		}
		var env struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			continue
		}
		if env.Type == "ERROR" || !known || env.Type == wantType {
			// Re-marshal compact (the wire format may already be compact, but
			// this guarantees one line regardless) and print it as the sole
			// stdout output.
			var v any
			if err := json.Unmarshal(raw, &v); err == nil {
				compact, _ := json.Marshal(v)
				fmt.Fprintln(os.Stdout, string(compact))
				return
			}
			fmt.Fprintln(os.Stdout, string(raw))
			return
		}
		// Unrelated broadcast (e.g. TELEMETRY, a LOG line from something
		// else) — keep waiting for our own reply within the same deadline.
	}
}

// Command wsclient is a local manual-testing tool: it connects to a running
// gpsmock-engine over its WebSocket API and offers an interactive menu to send
// the actions a real client (Tauri/iOS app) would — without building either
// of those. Meant to be run next to `gpsmock-engine`, e.g. via
// scripts/test-local.ps1, while iterating on driver/discovery changes.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	addr := flag.String("addr", "localhost:8080", "engine listen address (host:port)")
	flag.Parse()

	u := url.URL{Scheme: "ws", Host: *addr, Path: "/ws"}
	fmt.Printf("Connexion à %s...\n", u.String())

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
		fmt.Printf("Échec de connexion après plusieurs tentatives : %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()
	fmt.Println("Connecté.")

	var mu sync.Mutex // guards stdout so the read-loop and the menu don't interleave mid-line

	// Read loop: print every inbound event as pretty JSON, as it arrives —
	// independent of the menu, so STATUS/LOG broadcasts show up live too.
	go func() {
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				mu.Lock()
				fmt.Printf("\n[connexion fermée: %v]\n", err)
				mu.Unlock()
				os.Exit(0)
			}
			mu.Lock()
			fmt.Print("\n<< ")
			printPrettyJSON(raw)
			fmt.Print("\n> ")
			mu.Unlock()
		}
	}()

	send := func(msgType string, data any) {
		env := map[string]any{"type": msgType}
		if data != nil {
			env["data"] = data
		}
		mu.Lock()
		fmt.Printf(">> %s %v\n", msgType, dataOrEmpty(data))
		mu.Unlock()
		if err := conn.WriteJSON(env); err != nil {
			fmt.Printf("[erreur d'envoi: %v]\n", err)
		}
	}

	reader := bufio.NewScanner(os.Stdin)
	printMenu()
	for {
		mu.Lock()
		fmt.Print("\n> ")
		mu.Unlock()
		if !reader.Scan() {
			return
		}
		line := strings.TrimSpace(reader.Text())
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		cmd := fields[0]

		switch cmd {
		case "h", "help", "?":
			printMenu()

		case "q", "quit", "exit":
			return

		case "status", "s":
			send("GET_STATUS", nil)

		case "diag", "d":
			send("GET_DIAGNOSTICS", nil)

		case "devices", "nd":
			send("GET_NETWORK_DEVICES", nil)

		case "deviceinfo", "di":
			send("GET_DEVICE_INFO", nil)

		case "logs", "l":
			send("GET_LOGS", nil)

		case "switch", "sw":
			// switch <driverId> [transport] [wifiAddress] [targetUdid]
			if len(fields) < 2 {
				fmt.Println("usage: switch <go-ios|pymobiledevice> [auto|usb|wifi] [wifiAddress] [targetUdid]")
				continue
			}
			payload := map[string]any{"driverId": fields[1]}
			if len(fields) > 2 {
				payload["transport"] = fields[2]
			}
			if len(fields) > 3 {
				payload["wifiAddress"] = fields[3]
			}
			if len(fields) > 4 {
				payload["targetUdid"] = fields[4]
			}
			send("SWITCH_DRIVER", payload)

		case "set", "loc":
			// set <lat> <lon> [name]
			if len(fields) < 3 {
				fmt.Println("usage: set <lat> <lon> [name]")
				continue
			}
			lat, err1 := strconv.ParseFloat(fields[1], 64)
			lon, err2 := strconv.ParseFloat(fields[2], 64)
			if err1 != nil || err2 != nil {
				fmt.Println("lat/lon invalides")
				continue
			}
			payload := map[string]any{"lat": lat, "lon": lon}
			if len(fields) > 3 {
				payload["name"] = strings.Join(fields[3:], " ")
			}
			send("SET_LOCATION", payload)

		case "clear", "c":
			send("CLEAR_LOCATION", nil)

		case "heartbeat", "hb":
			send("HEARTBEAT", nil)

		case "raw":
			// raw <ACTION_TYPE> <json-data-or-nothing>
			if len(fields) < 2 {
				fmt.Println("usage: raw <ACTION_TYPE> [{json}]")
				continue
			}
			actionType := fields[1]
			if len(fields) == 2 {
				send(actionType, nil)
				continue
			}
			rawJSON := strings.Join(fields[2:], " ")
			var data any
			if err := json.Unmarshal([]byte(rawJSON), &data); err != nil {
				fmt.Printf("JSON invalide : %v\n", err)
				continue
			}
			send(actionType, data)

		default:
			fmt.Printf("Commande inconnue %q — tape 'help' pour la liste.\n", cmd)
		}
	}
}

func dataOrEmpty(data any) string {
	if data == nil {
		return ""
	}
	b, _ := json.Marshal(data)
	return string(b)
}

func printPrettyJSON(raw []byte) {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		fmt.Print(string(raw))
		return
	}
	pretty, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fmt.Print(string(raw))
		return
	}
	fmt.Print(string(pretty))
}

func printMenu() {
	fmt.Print(`
=== gpsmock wsclient — commandes ===
  status, s                                          GET_STATUS
  diag, d                                            GET_DIAGNOSTICS (chemins/versions go-ios+pmd3, USB, pairing)
  devices, nd                                        GET_NETWORK_DEVICES (découverte mDNS/tunnel)
  deviceinfo, di                                      GET_DEVICE_INFO
  logs, l                                             GET_LOGS
  switch <driverId> [transport] [wifiAddr] [udid]    SWITCH_DRIVER, ex: switch go-ios auto
  set <lat> <lon> [name]                             SET_LOCATION, ex: set 48.8566 2.3522 Paris
  clear, c                                           CLEAR_LOCATION
  heartbeat, hb                                      HEARTBEAT
  raw <ACTION_TYPE> [{json}]                         envoie un message brut, ex: raw GET_STATUS
  help, h, ?                                         affiche ce menu
  quit, q                                            quitte

Les événements entrants (STATUS, LOG, NETWORK_DEVICES, ...) s'affichent en direct, préfixés "<<".
`)
}

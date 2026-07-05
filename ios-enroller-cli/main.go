package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/grandcat/zeroconf"
)

// mdnsServiceType is the service advertised by the engine for cluster/peer
// discovery; we reuse it here so the enroller can find engines on the LAN.
const mdnsServiceType = "_gpsmock._tcp"

// discoveredServer represents an engine found via mDNS.
type discoveredServer struct {
	Name string
	Addr string
	Port int
}

func (d discoveredServer) URL() string {
	return fmt.Sprintf("http://%s:%d", d.Addr, d.Port)
}

// Config holds the CLI configuration
type Config struct {
	ServerUrl string
	UDID      string
	GoIosBin  string
	Token     string
}

func main() {
	serverFlag := flag.String("server", "", "URL du serveur Moteur (ex: http://192.168.1.143:8080). Si omis, une découverte mDNS est tentée.")
	udidFlag := flag.String("udid", "", "UDID de l'iPhone (optionnel, détecté automatiquement)")
	iosBinFlag := flag.String("ios-bin", "", "Chemin vers l'exécutable go-ios / ios (optionnel)")
	tokenFlag := flag.String("token", "", "Clé API (GPSMOCK_API_KEY) ou jeton d'appairage du moteur distant. Requis si l'accès distant est protégé. À défaut, la variable d'environnement GPSMOCK_API_KEY est utilisée.")
	discoverTimeout := flag.Duration("discover-timeout", 3*time.Second, "Durée d'écoute mDNS pour la découverte automatique du serveur")
	flag.Parse()

	// A remote engine gates /api/device/enroll behind auth (checkAuth): any
	// non-loopback request needs the API key or a paired-device token. Fall back
	// to the env var so scripted runs don't have to repeat it on the CLI.
	token := strings.TrimSpace(*tokenFlag)
	if token == "" {
		token = strings.TrimSpace(os.Getenv("GPSMOCK_API_KEY"))
	}

	fmt.Println("===========================================")
	fmt.Println("       iOS-Enroller - Outil CLI Go")
	fmt.Println("===========================================")

	serverUrl := strings.TrimSuffix(*serverFlag, "/")
	if serverUrl == "" {
		serverUrl = resolveServerUrl(*discoverTimeout)
	}

	config := Config{
		ServerUrl: serverUrl,
		UDID:      *udidFlag,
		GoIosBin:  *iosBinFlag,
		Token:     token,
	}

	// 1. Trouver le dossier Lockdown
	lockdownDir := getLockdownDir()
	if lockdownDir == "" {
		fmt.Println("[ERREUR] Impossible de localiser le dossier Lockdown Apple sur ce système.")
		os.Exit(1)
	}
	fmt.Printf("[INFO] Dossier Lockdown identifié : %s\n", lockdownDir)

	// 2. Trouver l'exécutable go-ios/ios
	iosBin := findGoIosBinary(config.GoIosBin)
	if iosBin == "" {
		fmt.Println("[ATTENTION] Impossible de trouver l'exécutable go-ios/ios.")
		fmt.Println("            Assurez-vous qu'il est installé, sur le PATH, ou utilisez le flag -ios-bin.")
	} else {
		fmt.Printf("[INFO] Exécutable go-ios identifié : %s\n", iosBin)
	}

	// 3. Détection ou validation du UDID
	udid := config.UDID
	if udid == "" {
		if iosBin == "" {
			fmt.Println("[ERREUR] UDID non spécifié et go-ios non trouvé pour l'auto-détection.")
			fmt.Println("         Veuillez brancher votre appareil et spécifier son UDID via -udid <UDID>.")
			os.Exit(1)
		}
		var err error
		udid, err = detectUDID(iosBin)
		if err != nil {
			fmt.Printf("[ERREUR] Échec de la détection de l'appareil via go-ios : %v\n", err)
			fmt.Println("         Vérifiez que l'iPhone est bien connecté en USB.")
			os.Exit(1)
		}
		if udid == "" {
			fmt.Println("[ERREUR] Aucun iPhone détecté. Veuillez le brancher en USB.")
			os.Exit(1)
		}
	}
	fmt.Printf("[INFO] UDID de l'appareil cible : %s\n", udid)

	// 4. Vérifier si le fichier de pairage existe
	plistPath := filepath.Join(lockdownDir, udid+".plist")
	if _, err := os.Stat(plistPath); os.IsNotExist(err) {
		fmt.Println("[INFO] Aucun certificat d'association local trouvé pour cet UDID.")
		if iosBin != "" {
			fmt.Println("[INFO] Lancement de la procédure d'association (Veuillez cliquer sur 'Faire confiance' sur l'iPhone)...")
			// Exécuter 'ios info' pour forcer l'invite de pairage
			cmd := exec.Command(iosBin, "info")
			_ = cmd.Run()
			
			// Attendre quelques secondes et vérifier à nouveau
			fmt.Println("[INFO] Attente de validation sur l'iPhone (10 secondes)...")
			for i := 0; i < 5; i++ {
				time.Sleep(2 * time.Second)
				if _, err := os.Stat(plistPath); err == nil {
					break
				}
			}
		}
		
		// Vérification finale
		if _, err := os.Stat(plistPath); os.IsNotExist(err) {
			fmt.Printf("[ERREUR] L'appareil n'est pas associé avec cet ordinateur.\n")
			fmt.Printf("         Veuillez d'abord l'associer via iTunes ou en cliquant sur 'Faire confiance'.\n")
			os.Exit(1)
		}
	}

	// 5. Lire et encoder le fichier de pairage
	fmt.Println("[INFO] Lecture du certificat de pairage...")
	content, err := os.ReadFile(plistPath)
	if err != nil {
		fmt.Printf("[ERREUR] Impossible de lire le fichier de pairage : %v\n", err)
		os.Exit(1)
	}
	deviceRecordB64 := base64.StdEncoding.EncodeToString(content)

	// 6. Envoyer au serveur cible
	fmt.Printf("[INFO] Envoi vers le serveur cible : %s...\n", config.ServerUrl)
	err = sendEnrollment(config.ServerUrl, udid, deviceRecordB64, config.Token)
	if err != nil {
		fmt.Printf("[ERREUR] Échec de l'envoi : %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\n[SUCCÈS] L'enrôlement s'est terminé avec succès ! ✅")
	fmt.Println("          L'appareil peut maintenant être utilisé sur le serveur distant.")
}

// resolveServerUrl scans the LAN for engines advertising _gpsmock._tcp via
// mDNS. With one match it's used automatically; with several the user picks
// one interactively; with none it falls back to localhost:8080.
func resolveServerUrl(timeout time.Duration) string {
	const fallback = "http://localhost:8080"

	fmt.Printf("[INFO] Recherche de serveurs Moteur sur le réseau local (mDNS, %s)...\n", timeout)
	servers := discoverServers(timeout)

	switch len(servers) {
	case 0:
		fmt.Printf("[ATTENTION] Aucun serveur découvert. Utilisation de l'adresse par défaut : %s\n", fallback)
		fmt.Println("            Utilisez -server <URL> pour cibler un serveur manuellement.")
		return fallback
	case 1:
		fmt.Printf("[INFO] Serveur découvert automatiquement : %s (%s)\n", servers[0].URL(), servers[0].Name)
		return servers[0].URL()
	default:
		fmt.Println("[INFO] Plusieurs serveurs découverts :")
		for i, s := range servers {
			fmt.Printf("       %d) %s  -  %s\n", i+1, s.URL(), s.Name)
		}
		fmt.Print("Sélectionnez un serveur (numéro), ou Entrée pour le premier : ")

		var choice string
		fmt.Scanln(&choice)
		choice = strings.TrimSpace(choice)
		if choice == "" {
			return servers[0].URL()
		}
		idx := 0
		fmt.Sscanf(choice, "%d", &idx)
		if idx >= 1 && idx <= len(servers) {
			return servers[idx-1].URL()
		}
		fmt.Println("[ATTENTION] Sélection invalide, utilisation du premier serveur découvert.")
		return servers[0].URL()
	}
}

// discoverServers browses the LAN for _gpsmock._tcp engines for the given
// duration and returns the de-duplicated, sorted results.
func discoverServers(timeout time.Duration) []discoveredServer {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		fmt.Printf("[ATTENTION] Découverte mDNS indisponible : %v\n", err)
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var mu sync.Mutex
	seen := make(map[string]discoveredServer)
	entries := make(chan *zeroconf.ServiceEntry, 8)

	go func() {
		for entry := range entries {
			var addr string
			if len(entry.AddrIPv4) > 0 {
				addr = entry.AddrIPv4[0].String()
			} else if len(entry.AddrIPv6) > 0 {
				addr = entry.AddrIPv6[0].String()
			} else {
				continue
			}
			name := strings.TrimSuffix(entry.Instance, "."+mdnsServiceType)
			key := fmt.Sprintf("%s:%d", addr, entry.Port)
			mu.Lock()
			seen[key] = discoveredServer{Name: name, Addr: addr, Port: entry.Port}
			mu.Unlock()
		}
	}()

	if err := resolver.Browse(ctx, mdnsServiceType, "local.", entries); err != nil {
		fmt.Printf("[ATTENTION] Échec de la découverte mDNS : %v\n", err)
		return nil
	}

	<-ctx.Done()

	mu.Lock()
	defer mu.Unlock()
	results := make([]discoveredServer, 0, len(seen))
	for _, s := range seen {
		results = append(results, s)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].URL() < results[j].URL()
	})
	return results
}

func getLockdownDir() string {
	if runtime.GOOS == "windows" {
		programData := os.Getenv("ProgramData")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		return filepath.Join(programData, "Apple", "Lockdown")
	} else if runtime.GOOS == "darwin" {
		return "/var/db/lockdown"
	}
	return "/var/lib/lockdown"
}

func findGoIosBinary(overridePath string) string {
	if overridePath != "" {
		if _, err := os.Stat(overridePath); err == nil {
			return overridePath
		}
	}

	// Recherche dans le PATH
	if path, err := exec.LookPath("ios"); err == nil {
		return path
	}
	if path, err := exec.LookPath("go-ios"); err == nil {
		return path
	}

	// Recherche relative aux dossiers connus
	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(cwd, "ios.exe"),
		filepath.Join(cwd, "ios"),
		filepath.Join(cwd, "tauri-app", "src-tauri", "resources", "ios.exe"),
		filepath.Join(cwd, "tauri-app", "src-tauri", "resources", "ios"),
		filepath.Join(cwd, "..", "tauri-app", "src-tauri", "resources", "ios.exe"),
		filepath.Join(cwd, "..", "server", "resources", "ios.exe"),
	}

	for _, cand := range candidates {
		if _, err := os.Stat(cand); err == nil {
			return cand
		}
	}

	return ""
}

func detectUDID(iosBin string) (string, error) {
	cmd := exec.Command(iosBin, "list")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		return "", err
	}

	output := stdout.String()
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		
		// Parsing JSON ou format liste
		var parsed struct {
			DeviceList []string `json:"deviceList"`
		}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil && len(parsed.DeviceList) > 0 {
			return parsed.DeviceList[0], nil
		}

		var parsedArr []struct {
			Udid string `json:"udid"`
			UDID string `json:"Udid"`
		}
		if err := json.Unmarshal([]byte(trimmed), &parsedArr); err == nil && len(parsedArr) > 0 {
			if parsedArr[0].Udid != "" {
				return parsedArr[0].Udid, nil
			}
			return parsedArr[0].UDID, nil
		}
	}

	return "", nil
}

func sendEnrollment(serverUrl, udid, deviceRecordB64, token string) error {
	payload := map[string]string{
		"udid":         udid,
		"deviceRecord": deviceRecordB64,
	}
	bodyBytes, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 5 * time.Second}

	post := func(url string) (*http.Response, error) {
		req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyBytes))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		// The remote engine's enroll endpoint is auth-gated for non-loopback
		// callers; present the API key / paired-device token as a Bearer token
		// (also mirrored as ?token= for parity with the WS handshake path).
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		return client.Do(req)
	}

	// Essayer /api/device/enroll
	url := fmt.Sprintf("%s/api/device/enroll", serverUrl)
	fmt.Printf("[DEBUG] Tentative de POST sur %s...\n", url)
	resp, err := post(url)
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusOK {
		_ = resp.Body.Close()
		return nil
	}
	if resp.StatusCode == http.StatusUnauthorized {
		_ = resp.Body.Close()
		return errUnauthorized(token)
	}

	// Essayer l'ancienne route /api/enroll (repli 404)
	firstStatus := resp.StatusCode
	_ = resp.Body.Close()
	fallbackUrl := fmt.Sprintf("%s/api/enroll", serverUrl)
	fmt.Printf("[DEBUG] Statut %d sur /api/device/enroll, tentative de repli sur %s...\n", firstStatus, fallbackUrl)
	respFallback, errFallback := post(fallbackUrl)
	if errFallback != nil {
		return errFallback
	}
	defer func() { _ = respFallback.Body.Close() }()
	if respFallback.StatusCode == http.StatusOK {
		return nil
	}
	if respFallback.StatusCode == http.StatusUnauthorized {
		return errUnauthorized(token)
	}
	bodyStr, _ := io.ReadAll(respFallback.Body)
	return fmt.Errorf("statut d'erreur serveur : %d, corps : %s", respFallback.StatusCode, string(bodyStr))
}

// errUnauthorized returns a message that distinguishes "no credential provided"
// from "credential rejected", since both surface as HTTP 401.
func errUnauthorized(token string) error {
	if token == "" {
		return fmt.Errorf("le moteur distant a refusé la requête (401) : l'accès distant est protégé. " +
			"Fournissez la clé API ou un jeton d'appairage via -token <clé> (ou la variable GPSMOCK_API_KEY)")
	}
	return fmt.Errorf("le moteur distant a refusé le jeton fourni (401) : vérifiez la clé API / le jeton d'appairage (-token)")
}

// Package platform resolves external binaries and OS-specific paths the drivers
// depend on (go-ios, pymobiledevice3, the Lockdown pairing folder).
package platform

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// ResolveGoIos returns the path to the go-ios CLI. Lookup order:
//  1. an explicit path from cfg ("go-ios" key),
//  2. the system PATH ("ios", then "go-ios"),
//  3. known fallback locations (incl. the legacy bundled binary).
func ResolveGoIos(explicit map[string]string) (string, error) {
	if p := explicit["go-ios"]; p != "" {
		if fileExists(p) {
			return p, nil
		}
		return "", fmt.Errorf("go-ios binary not found at %q", p)
	}
	for _, name := range []string{"ios", "go-ios"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, nil
		}
	}
	for _, c := range goIosFallbacks() {
		if fileExists(c) {
			abs, err := filepath.Abs(c)
			if err == nil {
				return abs, nil
			}
			return c, nil
		}
	}
	return "", fmt.Errorf("go-ios binary not found (set BinaryPaths[\"go-ios\"] or add it to PATH)")
}

func goIosFallbacks() []string {
	name := "ios"
	if runtime.GOOS == "windows" {
		name = "ios.exe"
	}
	return []string{
		filepath.Join("legacy", "server", "resources", name),
		filepath.Join("resources", name),
		name,
	}
}

// LockdownDir returns the system Lockdown pairing-record folder if it exists,
// or "" otherwise. go-ios uses it via --pair-record-path.
func LockdownDir() string {
	var dir string
	if runtime.GOOS == "windows" {
		programData := os.Getenv("ProgramData")
		if programData == "" {
			programData = `C:\ProgramData`
		}
		dir = filepath.Join(programData, "Apple", "Lockdown")
	} else {
		dir = "/var/lib/lockdown"
	}
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		return dir
	}
	return ""
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

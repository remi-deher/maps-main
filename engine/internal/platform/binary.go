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
//  3. a "resources" folder next to the binary (manual vendoring, no PATH entry).
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
		filepath.Join("resources", name),
		name,
	}
}

// Pmd3Command resolves how to invoke pymobiledevice3. It returns the executable
// and the base args, e.g. ("python", ["-m","pymobiledevice3"]). Lookup order:
//  1. an explicit Python path from cfg ("python" key),
//  2. the system PATH (python / py on Windows, python3 / python elsewhere),
//  3. a "resources/python-embed" folder next to the binary — the Windows
//     release zip bundles python.org's embeddable distribution there with
//     pymobiledevice3 pre-installed (see release.yml), so the Windows .exe
//     works standalone without the user installing Python themselves.
func Pmd3Command(explicit map[string]string) (string, []string, error) {
	base := []string{"-m", "pymobiledevice3"}
	if p := explicit["python"]; p != "" {
		if fileExists(p) {
			return p, base, nil
		}
		return "", nil, fmt.Errorf("python not found at %q", p)
	}
	for _, name := range pythonCandidates() {
		if p, err := exec.LookPath(name); err == nil {
			return p, base, nil
		}
	}
	for _, c := range pmd3Fallbacks() {
		if fileExists(c) {
			if abs, err := filepath.Abs(c); err == nil {
				return abs, base, nil
			}
			return c, base, nil
		}
	}
	return "", nil, fmt.Errorf("python not found (set BinaryPaths[\"python\"] or add python to PATH); needed by the pymobiledevice driver")
}

func pmd3Fallbacks() []string {
	if runtime.GOOS == "windows" {
		return []string{filepath.Join("resources", "python-embed", "python.exe")}
	}
	return []string{filepath.Join("resources", "python-embed", "bin", "python3")}
}

func pythonCandidates() []string {
	if runtime.GOOS == "windows" {
		return []string{"python", "py", "python3"}
	}
	return []string{"python3", "python"}
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

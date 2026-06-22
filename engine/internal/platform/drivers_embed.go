//go:build windows && embed_drivers

// This file is compiled only for the self-contained Windows "portable" build
// (go build -tags embed_drivers). It embeds the iOS drivers — go-ios (ios.exe)
// and the python-embed + pymobiledevice3 distribution — as a single compressed
// drivers.zip baked into the engine binary, so one .exe runs with no folder to
// unzip and no system install. The zip under embedded/ is assembled in CI
// before the tagged build (see .github/workflows/release.yml); it is
// gitignored, so ordinary untagged builds (Docker, Linux/macOS, the bare .exe)
// never include it.
package platform

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"io"
	"os"
	"path/filepath"
)

//go:embed embedded/drivers.zip
var embeddedDriversZip []byte

// driversVersion names the per-version extraction cache dir, so installing a
// new release re-extracts instead of reusing stale drivers. Set at build time
// with -ldflags "-X ...platform.driversVersion=<version>".
var driversVersion = "dev"

// extractBundledDrivers unzips the embedded payload into a per-version cache dir
// under the user cache dir (%LOCALAPPDATA% on Windows) exactly once, and
// returns that dir. A marker file makes subsequent launches a no-op.
func extractBundledDrivers() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(base, "gpsmock", "drivers", driversVersion)
	marker := filepath.Join(root, ".extracted")
	if _, err := os.Stat(marker); err == nil {
		return root, nil
	}

	zr, err := zip.NewReader(bytes.NewReader(embeddedDriversZip), int64(len(embeddedDriversZip)))
	if err != nil {
		return "", err
	}
	for _, f := range zr.File {
		dst := filepath.Join(root, filepath.FromSlash(f.Name))
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return "", err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return "", err
		}
		if err := writeZipEntry(f, dst); err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(marker, []byte(driversVersion), 0o644); err != nil {
		return "", err
	}
	return root, nil
}

func writeZipEntry(f *zip.File, dst string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, rc)
	return err
}

// BundledDriverPaths extracts the embedded drivers (once) and returns explicit
// paths to go-ios and the Python interpreter, or "" for any not present.
func BundledDriverPaths() (goios string, python string) {
	root, err := extractBundledDrivers()
	if err != nil || root == "" {
		return "", ""
	}
	if g := filepath.Join(root, "ios.exe"); fileExists(g) {
		goios = g
	}
	if p := filepath.Join(root, "python-embed", "python.exe"); fileExists(p) {
		python = p
	}
	return goios, python
}

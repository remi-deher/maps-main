package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestFindResourceLocatesCwdRelative(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	rel := filepath.Join("resources", "python-embed", "python.exe")
	if err := os.MkdirAll(filepath.Dir(rel), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rel, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, ok := findResource([]string{rel})
	if !ok {
		t.Fatalf("expected to find %s under cwd", rel)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("expected an absolute path, got %q", got)
	}
}

func TestFindResourceMissingReturnsFalse(t *testing.T) {
	t.Chdir(t.TempDir())
	if p, ok := findResource([]string{filepath.Join("resources", "does-not-exist")}); ok {
		t.Errorf("expected not found, got %q", p)
	}
}

func TestResourceRootsIncludesCwdAndExeDir(t *testing.T) {
	roots := resourceRoots()
	if len(roots) == 0 || roots[0] != "." {
		t.Fatalf("expected cwd (\".\") as first root, got %v", roots)
	}
	// os.Executable() resolves in tests (the test binary), so the exe dir
	// should be appended as a second, absolute root.
	if len(roots) >= 2 && !filepath.IsAbs(roots[1]) {
		t.Errorf("expected exe-dir root to be absolute, got %q", roots[1])
	}
}

func TestPythonCandidates(t *testing.T) {
	cands := pythonCandidates()
	if len(cands) == 0 {
		t.Errorf("expected at least one python candidate")
	}

	if runtime.GOOS == "windows" {
		if len(cands) < 3 || cands[0] != "python" || cands[1] != "py" || cands[2] != "python3" {
			t.Errorf("expected windows candidates to be [python, py, python3], got %v", cands)
		}
	} else {
		if len(cands) < 2 || cands[0] != "python3" || cands[1] != "python" {
			t.Errorf("expected non-windows candidates to be [python3, python], got %v", cands)
		}
	}
}

func TestPmd3Fallbacks(t *testing.T) {
	falls := pmd3Fallbacks()
	if len(falls) == 0 {
		t.Errorf("expected at least one fallback path")
	}

	if runtime.GOOS == "windows" {
		expectedSuffix := "python.exe"
		for _, f := range falls {
			if len(f) < len(expectedSuffix) || f[len(f)-len(expectedSuffix):] != expectedSuffix {
				t.Errorf("expected fallback path to end with python.exe, got %s", f)
			}
		}
	} else {
		for _, f := range falls {
			if len(f) >= 4 && f[len(f)-4:] == ".exe" {
				t.Errorf("expected non-windows fallback to not end with .exe, got %s", f)
			}
		}
	}
}

func TestGoIosFallbacks(t *testing.T) {
	falls := goIosFallbacks()
	if len(falls) == 0 {
		t.Errorf("expected at least one fallback path")
	}

	if runtime.GOOS == "windows" {
		expectedSuffix := "ios.exe"
		for _, f := range falls {
			if len(f) < 7 || f[len(f)-7:] != expectedSuffix {
				t.Errorf("expected fallback path to end with ios.exe, got %s", f)
			}
		}
	} else {
		for _, f := range falls {
			if len(f) >= 4 && f[len(f)-4:] == ".exe" {
				t.Errorf("expected non-windows fallback to not end with .exe, got %s", f)
			}
		}
	}
}

package platform

import (
	"runtime"
	"testing"
)

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

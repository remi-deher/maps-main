package auth

import (
	"path/filepath"
	"testing"
	"time"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestCurrentCodeVerifies(t *testing.T) {
	s := openTemp(t)
	now := time.Now()
	code, err := s.CurrentCode(now)
	if err != nil {
		t.Fatalf("CurrentCode: %v", err)
	}
	if len(code) != totpDigits {
		t.Fatalf("code = %q, want %d digits", code, totpDigits)
	}
	if !s.VerifyCode(code, now) {
		t.Errorf("VerifyCode rejected a freshly generated code")
	}
	if s.VerifyCode("000000", now.Add(10*time.Minute)) {
		t.Errorf("VerifyCode accepted an unrelated code far in the future")
	}
}

func TestVerifyCodeToleratesSkew(t *testing.T) {
	s := openTemp(t)
	now := time.Now()
	code, _ := s.CurrentCode(now)
	// A code generated now must still verify one step earlier/later.
	if !s.VerifyCode(code, now.Add(-totpStep)) || !s.VerifyCode(code, now.Add(totpStep)) {
		t.Errorf("VerifyCode should tolerate ±1 step of skew")
	}
}

func TestPairAndVerifyToken(t *testing.T) {
	s := openTemp(t)
	token, dev, err := s.Pair("iPhone de Rémi")
	if err != nil {
		t.Fatalf("Pair: %v", err)
	}
	if dev.Label != "iPhone de Rémi" {
		t.Errorf("label = %q", dev.Label)
	}
	if !s.VerifyToken(token) {
		t.Errorf("VerifyToken rejected the token just issued")
	}
	if s.VerifyToken(dev.ID + ".wrong-secret") {
		t.Errorf("VerifyToken accepted a wrong secret")
	}
	if s.VerifyToken("no-dot-token") {
		t.Errorf("VerifyToken accepted a malformed token")
	}
}

func TestRevoke(t *testing.T) {
	s := openTemp(t)
	token, dev, _ := s.Pair("PC")
	if err := s.Revoke(dev.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if s.VerifyToken(token) {
		t.Errorf("revoked token still verifies")
	}
	if err := s.Revoke(dev.ID); err != ErrInvalidToken {
		t.Errorf("Revoke(unknown) = %v, want ErrInvalidToken", err)
	}
}

// TestTokenSurvivesReopen is the core guarantee: a paired device keeps working
// across an engine restart (a fresh Store over the same file).
func TestTokenSurvivesReopen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")

	s1, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	token, _, err := s1.Pair("iPhone")
	if err != nil {
		t.Fatalf("Pair: %v", err)
	}
	codeBefore, _ := s1.CurrentCode(time.Unix(1_700_000_000, 0))
	_ = s1.Close()

	s2, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = s2.Close() }()

	if !s2.VerifyToken(token) {
		t.Errorf("token did not survive a store reopen")
	}
	// Same persisted seed ⇒ same code for the same instant.
	if codeAfter, _ := s2.CurrentCode(time.Unix(1_700_000_000, 0)); codeAfter != codeBefore {
		t.Errorf("seed changed across reopen: %q != %q", codeAfter, codeBefore)
	}
}

func TestRegenerateSeedInvalidatesCode(t *testing.T) {
	s := openTemp(t)
	at := time.Unix(1_700_000_000, 0)
	before, _ := s.CurrentCode(at)
	if err := s.RegenerateSeed(); err != nil {
		t.Fatalf("RegenerateSeed: %v", err)
	}
	if after, _ := s.CurrentCode(at); after == before {
		t.Errorf("seed regeneration did not change the code")
	}
}

package auth

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// totpStep is the time window for one code (RFC 6238 default). A code is valid
// for one step, and VerifyCode also accepts the immediately preceding and
// following steps to tolerate clock skew between the engine and the device
// scanning the QR / typing the code.
const totpStep = 30 * time.Second

// totpDigits is the length of the human-facing pairing code.
const totpDigits = 6

// codeAt derives the RFC 6238 TOTP value for seed (base32) at time t. The seed
// is the long-lived secret persisted in the DB; only the short-lived derived
// code ever leaves the host (shown in the desktop UI / embedded in the QR).
func codeAt(seedB32 string, t time.Time) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(seedB32))
	if err != nil {
		return "", fmt.Errorf("decode totp seed: %w", err)
	}
	counter := uint64(t.Unix()) / uint64(totpStep.Seconds())

	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(msg[:])
	sum := mac.Sum(nil)

	// Dynamic truncation (RFC 4226 §5.3).
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])

	mod := uint32(1)
	for i := 0; i < totpDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", totpDigits, value%mod), nil
}

// verifyCodeAt reports whether code matches the seed within ±1 step of t,
// using a constant-time comparison so a remote attacker can't learn digits
// from response timing.
func verifyCodeAt(seedB32, code string, t time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	for _, skew := range []time.Duration{0, -totpStep, totpStep} {
		want, err := codeAt(seedB32, t.Add(skew))
		if err != nil {
			return false
		}
		if hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

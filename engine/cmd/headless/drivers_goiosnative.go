//go:build goiosnative

package main

// Registers the in-process go-ios backend, which is only compiled into builds
// carrying the `goiosnative` tag. See internal/driver/goiosnative for why it is
// opt-in: go-ios as a library pulls gvisor, quic-go and the TUN backends into
// the binary, which is a lot of weight for a backend not yet validated against
// a real device.
import _ "github.com/remi-deher/maps-main/engine/internal/driver/goiosnative"

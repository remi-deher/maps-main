//go:build !goiosnative

// This file is what the package compiles down to without the `goiosnative`
// build tag: nothing. It exists so `go build ./...` and `go vet ./...` still
// see a valid package here instead of failing with "build constraints exclude
// all Go files", and so nothing registers the backend — a default build links
// none of go-ios, gvisor or quic-go.
package goiosnative

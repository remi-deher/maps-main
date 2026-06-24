// Package build exposes the version string injected at compile time via
// -ldflags="-X github.com/remi-deher/maps-main/engine/internal/build.Version=x.y.z".
// When not set (dev builds, unit tests) it defaults to "dev".
package build

// Version is set by the release workflow via:
//
//	go build -ldflags="-X github.com/remi-deher/maps-main/engine/internal/build.Version=$ver"
var Version = "dev"

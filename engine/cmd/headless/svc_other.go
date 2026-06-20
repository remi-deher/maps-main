//go:build !windows

package main

// isWindowsService is always false off Windows.
func isWindowsService() bool { return false }

// runService is never called off Windows; present so main compiles everywhere.
func runService(runConfig) error { return nil }

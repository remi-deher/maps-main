// Package exectest provides the shared plumbing goios and pmd3 use to test
// their os/exec-based driver code without a real go-ios/python binary: it
// re-execs the test binary itself, restricted to that package's own
// TestHelperProcess test, which then behaves like the external tool
// according to a scenario name passed via an env var. This is the same
// technique os/exec's own tests use.
//
// What's NOT shared on purpose: each package's TestHelperProcess still
// defines its own scenario→behavior switch (e.g. the exact RSD line format,
// or the JSON device-list shape), since that's the whole point of the test —
// only the re-exec/arg-parsing plumbing around it is identical.
package exectest

import (
	"context"
	"os"
	"os/exec"
)

// FakeCommand returns a drop-in replacement for exec.Command: instead of
// running name/arg for real, it re-execs the calling test binary with
// -test.run=TestHelperProcess and the original name/arg passed through
// after "--", plus env vars that tell TestHelperProcess which scenario to
// play and that it's not a normal test run.
func FakeCommand(scenario string) func(name string, arg ...string) *exec.Cmd {
	return func(name string, arg ...string) *exec.Cmd {
		cmd := exec.Command(os.Args[0], helperArgs(name, arg)...)
		cmd.Env = helperEnv(scenario)
		return cmd
	}
}

// FakeCommandContext is FakeCommand's exec.CommandContext counterpart.
func FakeCommandContext(scenario string) func(ctx context.Context, name string, arg ...string) *exec.Cmd {
	return func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, os.Args[0], helperArgs(name, arg)...)
		cmd.Env = helperEnv(scenario)
		return cmd
	}
}

func helperArgs(name string, arg []string) []string {
	return append([]string{"-test.run=TestHelperProcess", "--", name}, arg...)
}

func helperEnv(scenario string) []string {
	return append(os.Environ(), "GO_WANT_HELPER_PROCESS=1", "FAKE_SCENARIO="+scenario)
}

// HelperArgs is called at the top of a package's TestHelperProcess test. It
// returns ok=false immediately under a normal `go test` run (the env var
// FakeCommand sets isn't present), so the test is a harmless no-op then.
// When invoked as the re-exec'd child process, it returns the original
// name/arg passed to FakeCommand/FakeCommandContext (with the wrapper's own
// "-test.run=... --" prefix stripped) and the scenario name to switch on.
func HelperArgs() (args []string, scenario string, ok bool) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return nil, "", false
	}
	args = os.Args
	for len(args) > 0 {
		if args[0] == "--" {
			args = args[1:]
			break
		}
		args = args[1:]
	}
	return args, os.Getenv("FAKE_SCENARIO"), true
}

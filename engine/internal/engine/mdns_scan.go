package engine

import (
	"bufio"
	"context"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MdnsDevice is one Bonjour entry found while actively browsing for an Apple
// device service. Unlike ListNetworkDevices (which only reflects what the
// active driver's tunnel daemon already tracks), this browses the LAN
// directly — useful to tell apart "the iPhone isn't even announcing itself on
// mDNS" from "it announces fine, the tunnel daemon just isn't picking it up".
type MdnsDevice struct {
	// Service is which of appleMdnsServices answered (see mdns_wake.go):
	// _apple-mobdev2._tcp answers from any paired-once iPhone regardless of
	// Developer Mode; _remotepairing._tcp/_remoted._tcp are the ones the
	// iOS17+ RSD tunnel daemon actually needs, and only appear once Developer
	// Mode is on AND a RemotePairing record exists from a prior USB session —
	// finding mobdev2 but not those two means that's exactly what's missing.
	Service  string   `json:"service"`
	Instance string   `json:"instance"`
	Hostname string   `json:"hostname"`
	IPv4     []string `json:"ipv4,omitempty"`
	IPv6     []string `json:"ipv6,omitempty"`
	Port     int      `json:"port"`
}

// ScanMdnsAll browses every appleMdnsServices entry for `timeout` and returns
// whatever answered, across all of them.
//
// It shells out to the platform's own mDNS resolver (dns-sd on
// Windows/macOS, avahi-browse on Linux) rather than using a Go mDNS library:
// on Windows, a raw-socket multicast join (e.g. grandcat/zeroconf) joins
// every multicast-capable interface returned by net.Interfaces(), including
// disconnected/virtual adapters, and silently misses replies that only come
// back over the real Wi-Fi adapter's IPv6 link-local scope — verified by
// dns-sd seeing _apple-mobdev2._tcp replies that a zeroconf-based browse
// missed entirely. dns-sd talks to the already-running Bonjour
// mDNSResponder service, which handles Windows' per-interface multicast
// scoping correctly; mdns_wake.go already relies on the same tool for its
// keep-alive browse.
func ScanMdnsAll(ctx context.Context, timeout time.Duration) ([]MdnsDevice, error) {
	bctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var mu sync.Mutex
	var found []MdnsDevice
	var wg sync.WaitGroup

	for _, svc := range appleMdnsServices {
		wg.Add(1)
		go func(svc string) {
			defer wg.Done()
			// Browsing (bctx) eats the whole `timeout` budget by design — it
			// blocks until cancelled. Resolution must not share that
			// deadline or it always starts with zero time left; give it its
			// own short window off the caller's un-timed ctx instead.
			devices := scanService(bctx, ctx, svc)
			mu.Lock()
			found = append(found, devices...)
			mu.Unlock()
		}(svc)
	}
	wg.Wait()

	sort.Slice(found, func(i, j int) bool {
		if found[i].Service != found[j].Service {
			return found[i].Service < found[j].Service
		}
		return found[i].Instance < found[j].Instance
	})
	return found, nil
}

// scanService browses one service type for instances, then resolves each
// instance's host:port and IP addresses. Best-effort throughout: a failed or
// timed-out lookup just means that device's row stays sparse, not an error
// for the whole scan.
func scanService(bctx, parentCtx context.Context, svc string) []MdnsDevice {
	instances := browseInstances(bctx, svc)

	var mu sync.Mutex
	var devices []MdnsDevice
	var wg sync.WaitGroup
	for _, instance := range instances {
		wg.Add(1)
		go func(instance string) {
			defer wg.Done()
			d := MdnsDevice{Service: svc, Instance: instance}
			// -L and -G each run until their own context is killed (neither
			// exits on its own), so they need separate timeouts rather than
			// sharing one budget that the first call would fully consume.
			lctx, lcancel := context.WithTimeout(parentCtx, resolveTimeout)
			host, port, ok := lookupInstance(lctx, instance, svc)
			lcancel()
			if ok {
				d.Hostname = host
				d.Port = port
				gctx, gcancel := context.WithTimeout(parentCtx, resolveTimeout)
				d.IPv4, d.IPv6 = resolveHost(gctx, host)
				gcancel()
			}
			mu.Lock()
			devices = append(devices, d)
			mu.Unlock()
		}(instance)
	}
	wg.Wait()
	return devices
}

// resolveTimeout bounds each instance's -L/-G resolution lookups, run after
// the browse window already closed.
const resolveTimeout = 3 * time.Second

// browseAddLineRe matches a dns-sd -B "Add" line, e.g.:
//
//	15:45:58.888  Add     2 19 local.   _apple-mobdev2._tcp.   c8:1f:e8...-supportsRP-24
//
// The instance name is everything after the service-type column — it can't
// be split on whitespace alone since dns-sd right-pads the Service Type
// column with spaces rather than using a fixed separator.
var browseAddLineRe = regexp.MustCompile(`^\S+\s+Add\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+?)\s*$`)

// avahiNewLineRe matches an `avahi-browse -r` "+" (found) line, e.g.:
//
//	+ wlan0 IPv4 c8:1f:e8:bf:5f:bd@...-supportsRP-24 _apple-mobdev2._tcp local
var avahiNewLineRe = regexp.MustCompile(`^\+\s+\S+\s+\S+\s+(.+?)\s+\S+\s+local\s*$`)

// browseInstances runs a short, time-bounded browse for svc and returns the
// distinct instance names that answered.
func browseInstances(ctx context.Context, svc string) []string {
	tool, args := browseCommand(svc)
	if tool == "" {
		return nil
	}
	if _, err := exec.LookPath(tool); err != nil {
		return nil
	}

	cmd := exec.CommandContext(ctx, tool, args...)
	out, _ := cmd.StdoutPipe()
	if out == nil {
		return nil
	}
	if err := cmd.Start(); err != nil {
		return nil
	}

	seen := map[string]bool{}
	var instances []string
	scanner := bufio.NewScanner(out)
	for scanner.Scan() {
		line := scanner.Text()
		var name string
		switch {
		case strings.Contains(line, "Add"):
			if m := browseAddLineRe.FindStringSubmatch(line); m != nil {
				name = m[2]
			}
		case strings.HasPrefix(strings.TrimSpace(line), "+"):
			if m := avahiNewLineRe.FindStringSubmatch(line); m != nil {
				name = strings.TrimSpace(m[1])
			}
		}
		if name != "" && !seen[name] {
			seen[name] = true
			instances = append(instances, name)
		}
	}
	// ctx expiring kills the (otherwise indefinite) browse; either way we've
	// already drained whatever it printed before exiting.
	_ = cmd.Wait()
	return instances
}

// instanceReachedRe matches the "can be reached at host:port" line from
// `dns-sd -L`.
var instanceReachedRe = regexp.MustCompile(`can be reached at\s+(\S+):(\d+)`)

// avahiResolveRe matches the "hostname = [host:port]" line from
// `avahi-browse -r`.
var avahiResolveRe = regexp.MustCompile(`hostname\s*=\s*\[([^:\]]+):(\d+)\]`)

// lookupInstance resolves one already-discovered instance to its host:port.
func lookupInstance(ctx context.Context, instance, svc string) (host string, port int, ok bool) {
	switch runtime.GOOS {
	case "windows", "darwin":
		// dns-sd -L never exits on its own; ctx's timeout kills it once it's
		// had time to print a result, so Output() always reports a non-zero
		// exit even on success — check the captured text, not err.
		out, _ := exec.CommandContext(ctx, "dns-sd", "-L", instance, svc, "local").Output()
		if m := instanceReachedRe.FindStringSubmatch(string(out)); m != nil {
			p, _ := strconv.Atoi(m[2])
			return strings.TrimSuffix(m[1], "."), p, true
		}
	case "linux":
		out, err := exec.CommandContext(ctx, "avahi-resolve-service", "-n", instance, svc, "local").CombinedOutput()
		if err == nil {
			if m := avahiResolveRe.FindStringSubmatch(string(out)); m != nil {
				p, _ := strconv.Atoi(m[2])
				return strings.TrimSuffix(m[1], "."), p, true
			}
		}
	}
	return "", 0, false
}

// addressLineRe matches a dns-sd -G v4v6 address line, e.g.:
//
//	15:49:46.861  Add  3 19 iPhone.local.  192.168.1.105                4500
//	15:49:46.861  Add  3 19 iPhone.local.  FE80::EE:5727:6AF7:58A9%wireless 4500
var addressLineRe = regexp.MustCompile(`^\S+\s+Add\s+\S+\s+\S+\s+\S+\s+(\S+)\s+\d+\s*$`)

// resolveHost runs a short, time-bounded address lookup for host and splits
// the results into IPv4/IPv6. Best-effort — an empty result just means the
// device row won't show addresses, not a scan failure.
func resolveHost(ctx context.Context, host string) (ipv4, ipv6 []string) {
	if host == "" {
		return nil, nil
	}
	switch runtime.GOOS {
	case "windows", "darwin":
		// Same story as -L: dns-sd -G runs until killed by ctx, so a
		// non-zero exit is expected and doesn't mean the lookup failed.
		out, _ := exec.CommandContext(ctx, "dns-sd", "-G", "v4v6", host).Output()
		for _, line := range strings.Split(string(out), "\n") {
			m := addressLineRe.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			addr := m[1]
			if i := strings.IndexByte(addr, '%'); i >= 0 {
				addr = addr[:i] // strip the Windows zone suffix; not a routable form here
			}
			if strings.Contains(addr, ":") {
				ipv6 = append(ipv6, addr)
			} else {
				ipv4 = append(ipv4, addr)
			}
		}
	case "linux":
		out, err := exec.CommandContext(ctx, "avahi-resolve-host-name", "-4", host).Output()
		if err == nil {
			if fields := strings.Fields(string(out)); len(fields) == 2 {
				ipv4 = append(ipv4, fields[1])
			}
		}
		out, err = exec.CommandContext(ctx, "avahi-resolve-host-name", "-6", host).Output()
		if err == nil {
			if fields := strings.Fields(string(out)); len(fields) == 2 {
				ipv6 = append(ipv6, fields[1])
			}
		}
	}
	return ipv4, ipv6
}

// browseCommand returns the platform's mDNS browse tool and its args for a
// single time-bounded browse of svc. Mirrors mdnsBrowseCommand in
// mdns_wake.go, which runs the same tool indefinitely as a keep-alive.
func browseCommand(svc string) (string, []string) {
	switch runtime.GOOS {
	case "windows", "darwin":
		return "dns-sd", []string{"-B", svc}
	case "linux":
		return "avahi-browse", []string{"-r", "-p", svc}
	default:
		return "", nil
	}
}

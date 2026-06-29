package discovery

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

// MDNSDevice is one Bonjour entry found while actively browsing for an Apple
// device service.
type MDNSDevice struct {
	Service  string
	Instance string
	Hostname string
	IPv4     []string
	IPv6     []string
	Port     int
}

// ScanMDNSAll browses every AppleMDNSServices entry for timeout and returns
// whatever answered, across all of them.
func ScanMDNSAll(ctx context.Context, timeout time.Duration) ([]MDNSDevice, error) {
	bctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var mu sync.Mutex
	var found []MDNSDevice
	var wg sync.WaitGroup

	for _, svc := range AppleMDNSServices {
		wg.Add(1)
		go func(svc string) {
			defer wg.Done()
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

func scanService(bctx, parentCtx context.Context, svc string) []MDNSDevice {
	instances := browseInstances(bctx, svc)

	var mu sync.Mutex
	var devices []MDNSDevice
	var wg sync.WaitGroup
	for _, instance := range instances {
		wg.Add(1)
		go func(instance string) {
			defer wg.Done()
			d := MDNSDevice{Service: svc, Instance: instance}
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

const resolveTimeout = 3 * time.Second

var browseAddLineRe = regexp.MustCompile(`^\S+\s+Add\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+?)\s*$`)
var avahiNewLineRe = regexp.MustCompile(`^\+\s+\S+\s+\S+\s+(.+?)\s+\S+\s+local\s*$`)

func browseInstances(ctx context.Context, svc string) []string {
	tool, args := BrowseCommand(svc)
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
	_ = cmd.Wait()
	return instances
}

var instanceReachedRe = regexp.MustCompile(`can be reached at\s+(\S+):(\d+)`)
var avahiResolveRe = regexp.MustCompile(`hostname\s*=\s*\[([^:\]]+):(\d+)\]`)

func lookupInstance(ctx context.Context, instance, svc string) (host string, port int, ok bool) {
	switch runtime.GOOS {
	case "windows", "darwin":
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

var addressLineRe = regexp.MustCompile(`^\S+\s+Add\s+\S+\s+\S+\s+\S+\s+(\S+)\s+\d+\s*$`)

func resolveHost(ctx context.Context, host string) (ipv4, ipv6 []string) {
	if host == "" {
		return nil, nil
	}
	switch runtime.GOOS {
	case "windows", "darwin":
		out, _ := exec.CommandContext(ctx, "dns-sd", "-G", "v4v6", host).Output()
		for _, line := range strings.Split(string(out), "\n") {
			m := addressLineRe.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			addr := m[1]
			if i := strings.IndexByte(addr, '%'); i >= 0 {
				addr = addr[:i]
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

// BrowseCommand returns the platform's mDNS browse tool and its args for a
// single time-bounded browse of svc.
func BrowseCommand(svc string) (string, []string) {
	switch runtime.GOOS {
	case "windows", "darwin":
		return "dns-sd", []string{"-B", svc}
	case "linux":
		return "avahi-browse", []string{"-r", "-p", svc}
	default:
		return "", nil
	}
}

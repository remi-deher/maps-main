package engine

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"
)

// rsdProbePorts are the TCP ports Apple's RemotePairing/RSD service has been
// observed listening on over WiFi. There is no mDNS record to browse for it —
// _apple-mobdev2._tcp only hands out the device's link-local IPv6 address (and,
// per its "-supportsRP-NN" instance suffix, confirms RemotePairing support);
// finding the live port means probing this candidate range directly. Mirrors
// the previous (Electron) build's NativeBonjour port list.
var rsdProbePorts = buildRsdProbePorts()

func buildRsdProbePorts() []int {
	ports := []int{53248}
	for p := 53400; p <= 53460; p++ {
		ports = append(ports, p)
	}
	for p := 62000; p <= 62060; p++ {
		ports = append(ports, p)
	}
	return ports
}

// ProbeRSDPorts dials every candidate port on host concurrently and returns
// the ones that accepted a TCP connection, sorted ascending. host may be an
// IPv4 address, a global IPv6 address, or a link-local IPv6 address with a
// zone (e.g. "fe80::1%Wi-Fi") — link-local addresses need the zone or the
// dial fails outright since Windows can't otherwise pick the right interface.
func ProbeRSDPorts(ctx context.Context, host string, perPortTimeout time.Duration) []int {
	var mu sync.Mutex
	var open []int
	var wg sync.WaitGroup

	sem := make(chan struct{}, 32) // bound concurrent dials
	for _, port := range rsdProbePorts {
		wg.Add(1)
		go func(port int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			d := net.Dialer{Timeout: perPortTimeout}
			conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
			if err != nil {
				return
			}
			_ = conn.Close()
			mu.Lock()
			open = append(open, port)
			mu.Unlock()
		}(port)
	}
	wg.Wait()

	sort.Ints(open)
	return open
}

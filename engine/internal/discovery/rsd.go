package discovery

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"
)

var rsdProbePorts = buildRSDProbePorts()

func buildRSDProbePorts() []int {
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
// the ones that accepted a TCP connection, sorted ascending.
func ProbeRSDPorts(ctx context.Context, host string, perPortTimeout time.Duration) []int {
	var mu sync.Mutex
	var open []int
	var wg sync.WaitGroup

	sem := make(chan struct{}, 32)
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

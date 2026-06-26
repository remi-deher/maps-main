package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/remi-deher/maps-main/engine/internal/api"
	"github.com/remi-deher/maps-main/engine/internal/engine"
)

// dispatchUnmarshal decodes env.Data into a fresh T and, on success, runs fn
// with it; a decode failure is silently ignored (matching the prior
// per-action behavior) and an fn error is logged under label. It factors out
// the unmarshal-then-call-then-log-on-error shape shared by most dispatch
// cases below. If T implements Validate() error (see internal/api/validate.go),
// it's checked before fn runs — a validation failure is logged as a warning
// and fn is not called.
func dispatchUnmarshal[T any](env api.Envelope, label string, fn func(T) error) error {
	var p T
	if err := json.Unmarshal(env.Data, &p); err != nil {
		return err
	}
	if v, ok := any(p).(interface{ Validate() error }); ok {
		if err := v.Validate(); err != nil {
			slog.Warn(label+": rejecting invalid payload", "error", err)
			return err
		}
	}
	err := fn(p)
	if err != nil {
		slog.Error(label, "error", err)
	}
	return err
}

// dispatch routes one inbound WebSocket envelope to the Engine. Each case is
// a thin call into either dispatchUnmarshal (decode + validate + call) or a
// dedicated dispatchXxx method for actions with custom response shapes —
// keeping this switch itself a routing table, not where the logic lives.
func (s *Server) dispatch(c *client, env api.Envelope) {
	ctx, cancel := context.WithTimeout(context.Background(), s.actionTimeout)
	defer cancel()

	var err error
	defer func() {
		if env.Type != api.ActionSwitchDriver {
			s.trackAction(env.Type, err)
		}
		if err != nil {
			slog.Error("WebSocket action failed", "type", env.Type, "error", err)
		}
	}()

	switch env.Type {
	case api.ActionSetLocation:
		err = dispatchUnmarshal(env, "SET_LOCATION", func(p api.SetLocationPayload) error {
			return s.eng.SetLocation(ctx, p.Lat, p.Lon, p.Name)
		})
	case api.ActionClearLocation:
		err = s.eng.ClearLocation(ctx)
		if err != nil {
			slog.Error("CLEAR_LOCATION", "error", err)
		}
	case api.ActionGetStatus:
		c.send <- encode(api.EventStatus, s.eng.Status())
	case api.ActionRealLocation:
		err = dispatchUnmarshal(env, "REAL_LOCATION", func(p api.RealLocationPayload) error {
			s.eng.ReportRealLocation(ctx, p.Latitude, p.Longitude)
			return nil
		})
	case api.ActionHeartbeat:
		var p api.HeartbeatPayload
		_ = json.Unmarshal(env.Data, &p)
		c.send <- encode(api.EventPong, s.eng.Heartbeat(p))
	case api.ActionPlayRoute, api.ActionPlayOsrmRoute:
		err = dispatchUnmarshal(env, "PLAY_ROUTE", func(p api.PlayRoutePayload) error {
			return s.eng.PlayRoute(ctx, p.EndLat, p.EndLon, p.Speed, p.Profile)
		})
	case api.ActionPlaySequence:
		err = dispatchUnmarshal(env, "PLAY_SEQUENCE", func(p api.PlaySequencePayload) error {
			return s.eng.PlaySequence(ctx, p.Legs, p.Looping)
		})
	case api.ActionPlayCustomGpx:
		err = dispatchUnmarshal(env, "PLAY_CUSTOM_GPX", func(p api.PlayCustomGpxPayload) error {
			return s.eng.PlayCustomGpx(ctx, p.GpxContent, p.Speed)
		})
	case api.ActionPatrolUpdate:
		err = dispatchUnmarshal(env, "PATROL_UPDATE", func(p api.PatrolUpdatePayload) error {
			return s.eng.PatrolUpdate(ctx, p.Zone)
		})
	case api.ActionStopRoute:
		err = s.eng.StopRoute(ctx)
		if err != nil {
			slog.Error("STOP_ROUTE", "error", err)
		}
	case api.ActionPauseRoute:
		err = s.eng.PauseRoute(ctx)
		if err != nil {
			slog.Error("PAUSE_ROUTE", "error", err)
		}
	case api.ActionResumeRoute:
		err = s.eng.ResumeRoute(ctx)
		if err != nil {
			slog.Error("RESUME_ROUTE", "error", err)
		}
	case api.ActionAddFavorite:
		err = dispatchUnmarshal(env, "ADD_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.AddFavorite(ctx, p.Lat, p.Lon, p.Name)
		})
	case api.ActionRemoveFavorite:
		err = dispatchUnmarshal(env, "REMOVE_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.RemoveFavorite(ctx, p.Lat, p.Lon)
		})
	case api.ActionRenameFavorite:
		err = dispatchUnmarshal(env, "RENAME_FAVORITE", func(p api.FavoritePayload) error {
			return s.eng.RenameFavorite(ctx, p.Lat, p.Lon, p.NewName)
		})
	case api.ActionClearHistory:
		err = s.eng.ClearHistory(ctx)
		if err != nil {
			slog.Error("CLEAR_HISTORY", "error", err)
		}
	case api.ActionSwitchDriver:
		s.dispatchSwitchDriver(env)
	case api.ActionGetLogs:
		c.send <- encode(api.EventLogs, s.eng.GetLogs())
	case api.ActionDebugLog:
		err = dispatchUnmarshal(env, "DEBUG_LOG", s.dispatchDebugLog)
	case api.ActionSaveSettings:
		err = dispatchUnmarshal(env, "SAVE_SETTINGS", func(p api.SaveSettingsPayload) error {
			return s.eng.SaveSettings(ctx, p)
		})
	case api.ActionRelance:
		err = s.eng.Relance(ctx)
		if err != nil {
			slog.Error("RELANCE", "error", err)
		}
	case api.ActionGetDeviceInfo:
		err = s.dispatchGetDeviceInfo(ctx, c)
	case api.ActionGetNetworkDevices:
		err = s.dispatchGetNetworkDevices(ctx, c)
	case api.ActionScanMdns:
		err = s.dispatchScanMdns(ctx, c)
	case api.ActionProbeRsdPorts:
		s.dispatchProbeRsdPorts(ctx, c, env)
	case api.ActionPairDevice:
		err = s.dispatchPairDevice(ctx, c)
	case api.ActionGetPairCode:
		err = s.dispatchGetPairCode(c)
	case api.ActionListPairedDevices:
		s.dispatchListPairedDevices(c)
	case api.ActionRevokePairedDevice:
		err = s.dispatchRevokePairedDevice(c, env)
	case api.ActionGetDiagnostics:
		err = s.dispatchGetDiagnostics(ctx, c)
	default:
		slog.Warn("server: unrecognized WS action", "type", env.Type)
		err = fmt.Errorf("unrecognized WS action: %s", env.Type)
	}
}

// dispatchDebugLog forwards a client-side log line (typically from the iOS
// companion app) into the engine's own log stream, defaulting level/source.
func (s *Server) dispatchDebugLog(p api.DebugLogPayload) error {
	level := p.Level
	if level == "" {
		level = "info"
	}
	source := p.Source
	if source == "" {
		source = "ios-client"
	}
	s.eng.LogEvent(level, source, p.Category, p.Action, p.Message, p.Fields)
	return nil
}

// dispatchSwitchDriver runs the driver switch in the background: it can take
// up to 90s (device pairing/handshake), far longer than the per-action
// timeout the rest of dispatch uses, so it gets its own context and reports
// its outcome via trackAction once done instead of blocking the dispatch
// loop or this action's deferred tracking.
func (s *Server) dispatchSwitchDriver(env api.Envelope) {
	var p api.SwitchDriverPayload
	if err := json.Unmarshal(env.Data, &p); err != nil {
		slog.Error("SWITCH_DRIVER payload unmarshal failed", "error", err)
		s.trackAction(api.ActionSwitchDriver, err)
		return
	}
	go func(driverID, transport, wifiAddress, targetUDID string) {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		err := s.eng.SwitchDriver(ctx, driverID, transport, wifiAddress, targetUDID)
		if err != nil {
			slog.Error("SWITCH_DRIVER", "error", err)
		}
		s.trackAction(api.ActionSwitchDriver, err)
	}(p.DriverID, p.Transport, p.WifiAddress, p.TargetUdid)
}

func (s *Server) dispatchGetDeviceInfo(ctx context.Context, c *client) error {
	info, err := s.eng.GetDeviceInfo(ctx)
	if err != nil {
		slog.Error("GET_DEVICE_INFO", "error", err)
		c.send <- encode(api.EventDeviceInfo, api.DeviceInfoPayload{Error: err.Error()})
		return err
	}
	c.send <- encode(api.EventDeviceInfo, api.DeviceInfoPayload{
		UDID:           info.UDID,
		Name:           info.Name,
		ProductType:    info.ProductType,
		ProductVersion: info.ProductVersion,
		SerialNumber:   info.SerialNumber,
		WifiAddress:    info.WifiAddress,
		TunnelAddress:  info.TunnelAddress,
	})
	return nil
}

func (s *Server) dispatchGetNetworkDevices(ctx context.Context, c *client) error {
	devices, err := s.eng.ListNetworkDevices(ctx)
	if err != nil {
		slog.Error("GET_NETWORK_DEVICES", "error", err)
		c.send <- encode(api.EventNetworkDevices, api.NetworkDevicesPayload{Error: err.Error()})
		return err
	}
	payload := api.NetworkDevicesPayload{Devices: make([]api.NetworkDevicePayload, 0, len(devices))}
	for _, d := range devices {
		payload.Devices = append(payload.Devices, api.NetworkDevicePayload{UDID: d.UDID, Address: d.Address, Port: d.Port})
	}
	c.send <- encode(api.EventNetworkDevices, payload)
	return nil
}

func (s *Server) dispatchScanMdns(ctx context.Context, c *client) error {
	devices, err := engine.ScanMdnsAll(ctx, 5*time.Second)
	if err != nil {
		slog.Error("SCAN_MDNS", "error", err)
		c.send <- encode(api.EventMdnsDevices, api.MdnsDevicesPayload{Error: err.Error()})
		return err
	}
	payload := api.MdnsDevicesPayload{Devices: make([]api.MdnsDevicePayload, 0, len(devices))}
	for _, d := range devices {
		payload.Devices = append(payload.Devices, api.MdnsDevicePayload{
			Service: d.Service, Instance: d.Instance, Hostname: d.Hostname, IPv4: d.IPv4, IPv6: d.IPv6, Port: d.Port,
		})
	}
	c.send <- encode(api.EventMdnsDevices, payload)
	return nil
}

func (s *Server) dispatchProbeRsdPorts(ctx context.Context, c *client, env api.Envelope) {
	var p api.ProbeRsdPortsPayload
	if err := json.Unmarshal(env.Data, &p); err != nil || p.Host == "" {
		c.send <- encode(api.EventRsdPorts, api.RsdPortsPayload{Error: "host manquant ou invalide"})
		return
	}
	openPorts := engine.ProbeRSDPorts(ctx, p.Host, 400*time.Millisecond)
	c.send <- encode(api.EventRsdPorts, api.RsdPortsPayload{Host: p.Host, OpenPorts: openPorts})
}

func (s *Server) dispatchPairDevice(ctx context.Context, c *client) error {
	if err := s.eng.PairDevice(ctx); err != nil {
		slog.Error("PAIR_DEVICE", "error", err)
		c.send <- encode(api.EventPairResult, api.PairResultPayload{Error: err.Error()})
		return err
	}
	c.send <- encode(api.EventPairResult, api.PairResultPayload{OK: true})
	return nil
}

func (s *Server) dispatchGetDiagnostics(ctx context.Context, c *client) error {
	diag, err := s.eng.GetDiagnostics(ctx)
	if err != nil {
		slog.Error("GET_DIAGNOSTICS", "error", err)
		c.send <- encode(api.EventDiagnostics, map[string]any{"error": err.Error()})
		return err
	}
	c.send <- encode(api.EventDiagnostics, diag)
	return nil
}

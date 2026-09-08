package diagnostics

import (
	"context"
	"strconv"
	"strings"

	"github.com/remi-deher/maps-main/engine/internal/driver"
)

// Pre-flight check.
//
// Four things must be true before a position can be injected, and until now
// three of them failed the same way: a 45-second tunnel timeout with a generic
// hint. PairingHint could tell "no device" and "not paired" apart; Developer
// Mode and the Developer Disk Image it could not see at all — its own doc says
// so ("the tunnel failed for a reason this check can't see (dev mode off,
// phone locked, missing admin rights)").
//
// This reports each prerequisite separately, with what was observed and what to
// do about it, so an operator learns which step is missing before waiting out a
// timeout rather than after.

// RequirementStatus is a prerequisite's outcome. Unknown is deliberately
// distinct from Failed: a check that could not run must not be presented as a
// problem the user caused.
type RequirementStatus string

const (
	RequirementOK      RequirementStatus = "ok"
	RequirementFailed  RequirementStatus = "failed"
	RequirementUnknown RequirementStatus = "unknown"
)

// Requirement is one pre-flight check.
type Requirement struct {
	ID     string            `json:"id"`
	Label  string            `json:"label"`
	Status RequirementStatus `json:"status"`
	// Detail is what was actually observed, so the report stands on evidence
	// rather than on a verdict alone.
	Detail string `json:"detail"`
	// Fix is the remediation, present only when there is something to do.
	Fix string `json:"fix,omitempty"`
}

// Readiness is the full pre-flight report. Ready is true only when every
// requirement passed — an unknown is not a pass.
type Readiness struct {
	Ready        bool          `json:"ready"`
	Requirements []Requirement `json:"requirements"`
}

// CheckReadiness runs the pre-flight checks. prober may be nil (a driver that
// can't interrogate the device), in which case the device-state requirements
// report Unknown rather than being omitted — a prerequisite nobody verified is
// still a prerequisite, and hiding it is how it gets forgotten.
func CheckReadiness(ctx context.Context, lister DeviceLister, prober driver.DeviceStateProbe) Readiness {
	var report Readiness

	devices, err := lister.ListDevices(ctx)
	deviceReq := Requirement{ID: "device", Label: "iPhone détecté"}
	switch {
	case err != nil:
		deviceReq.Status = RequirementFailed
		deviceReq.Detail = "La détection USB a échoué : " + err.Error()
		deviceReq.Fix = "Vérifiez qu'Apple Mobile Device Service / iTunes (usbmuxd) est lancé, puis rebranchez le câble."
	case len(devices) == 0:
		deviceReq.Status = RequirementFailed
		deviceReq.Detail = "Aucun appareil vu par usbmux."
		deviceReq.Fix = "Branchez l'iPhone en USB et déverrouillez-le. Un appareil uniquement en Wi-Fi ne suffit pas tant qu'il n'a jamais été appairé en USB."
	default:
		deviceReq.Status = RequirementOK
		deviceReq.Detail = describeDevices(devices)
	}
	report.Requirements = append(report.Requirements, deviceReq)

	report.Requirements = append(report.Requirements, pairingRequirement(devices))

	var state driver.DeviceState
	if prober != nil {
		state = prober.ProbeDeviceState(ctx)
	}

	report.Requirements = append(report.Requirements, Requirement{
		ID:     "developer-mode",
		Label:  "Mode développeur activé",
		Status: statusOf(state.DeveloperModeEnabled),
		Detail: detailFor(state.DeveloperModeEnabled,
			"Le mode développeur est activé sur l'appareil.",
			"Le mode développeur est désactivé.",
			"Impossible d'interroger l'appareil (verrouillé, non appairé, ou pilote sans cette capacité)."),
		Fix: fixFor(state.DeveloperModeEnabled,
			"Sur l'iPhone : Réglages → Confidentialité et sécurité → Mode développeur, puis redémarrez l'appareil. Sans lui le tunnel s'établit mais tous les services DVT sont refusés."),
	})

	report.Requirements = append(report.Requirements, Requirement{
		ID:     "developer-image",
		Label:  "Image développeur (DDI) montée",
		Status: statusOf(state.DeveloperImageMounted),
		Detail: detailFor(state.DeveloperImageMounted,
			"L'image développeur est montée.",
			"Aucune image développeur montée.",
			"Impossible d'interroger l'appareil (verrouillé, non appairé, ou pilote sans cette capacité)."),
		Fix: fixFor(state.DeveloperImageMounted,
			"Le moteur la monte automatiquement au démarrage du tunnel. Sur iOS 17+ l'image est signée par Apple : une connexion Internet est nécessaire au premier montage."),
	})

	report.Ready = true
	for _, req := range report.Requirements {
		if req.Status != RequirementOK {
			report.Ready = false
			break
		}
	}
	return report
}

// pairingRequirement checks the Lockdown trust record, which the iOS 17+ RSD
// tunnel cannot be established without — over Wi-Fi *or* USB.
func pairingRequirement(devices []driver.Device) Requirement {
	req := Requirement{ID: "pairing", Label: "Appairage Lockdown"}
	if len(devices) == 0 {
		req.Status = RequirementUnknown
		req.Detail = "Aucun appareil à vérifier."
		return req
	}
	var unpaired []string
	for _, dev := range devices {
		if dev.UDID != "" && !IsPaired(dev.UDID) {
			unpaired = append(unpaired, dev.UDID)
		}
	}
	if len(unpaired) == 0 {
		req.Status = RequirementOK
		req.Detail = "Certificat d'appairage présent."
		return req
	}
	req.Status = RequirementFailed
	req.Detail = "Aucun certificat pour : " + joinUDIDs(unpaired)
	req.Fix = "Branchez l'iPhone en USB et validez « Faire confiance à cet ordinateur ? » sur son écran (ou lancez l'action PAIR_DEVICE)."
	return req
}

func statusOf(value *bool) RequirementStatus {
	switch {
	case value == nil:
		return RequirementUnknown
	case *value:
		return RequirementOK
	default:
		return RequirementFailed
	}
}

func detailFor(value *bool, whenOK, whenFailed, whenUnknown string) string {
	switch {
	case value == nil:
		return whenUnknown
	case *value:
		return whenOK
	default:
		return whenFailed
	}
}

// fixFor attaches the remediation only when there is something to remedy: a
// passing check with advice attached reads like a warning.
func fixFor(value *bool, fix string) string {
	if value != nil && *value {
		return ""
	}
	return fix
}

func joinUDIDs(udids []string) string { return strings.Join(udids, ", ") }

func itoa(n int) string { return strconv.Itoa(n) }

func describeDevices(devices []driver.Device) string {
	if len(devices) == 1 {
		name := devices[0].Name
		if name == "" {
			name = devices[0].UDID
		}
		return name + " détecté."
	}
	return itoa(len(devices)) + " appareils détectés."
}

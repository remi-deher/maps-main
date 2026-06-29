package simulation

import (
	"math"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func Distance(p1, p2 domain.LatLon) float64 {
	const earthRadius = 6371000.0
	dLat := (p2.Lat - p1.Lat) * math.Pi / 180.0
	dLon := (p2.Lon - p1.Lon) * math.Pi / 180.0
	lat1 := p1.Lat * math.Pi / 180.0
	lat2 := p2.Lat * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Sin(dLon/2)*math.Sin(dLon/2)*math.Cos(lat1)*math.Cos(lat2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadius * c
}

func Interpolate(rawPoints []domain.LatLon, speedKmh float64) []domain.LatLon {
	if len(rawPoints) < 2 {
		return rawPoints
	}
	if speedKmh <= 0 {
		speedKmh = 15.0
	}

	speedMs := speedKmh / 3.6
	var interpolated []domain.LatLon
	interpolated = append(interpolated, rawPoints[0])

	for i := 0; i < len(rawPoints)-1; i++ {
		p1 := rawPoints[i]
		p2 := rawPoints[i+1]
		dist := Distance(p1, p2)
		if dist <= speedMs {
			interpolated = append(interpolated, p2)
			continue
		}

		steps := int(math.Floor(dist / speedMs))
		for s := 1; s <= steps; s++ {
			fraction := float64(s) / (dist / speedMs)
			lat := p1.Lat + (p2.Lat-p1.Lat)*fraction
			lon := p1.Lon + (p2.Lon-p1.Lon)*fraction
			interpolated = append(interpolated, domain.LatLon{Lat: lat, Lon: lon})
		}
		interpolated = append(interpolated, p2)
	}

	return interpolated
}

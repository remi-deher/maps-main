package routing

import (
	"fmt"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

func latLonFromGeoJSON(coords [][]float64) ([]domain.LatLon, error) {
	points := make([]domain.LatLon, 0, len(coords))
	for _, coord := range coords {
		if len(coord) < 2 {
			continue
		}
		points = append(points, domain.LatLon{Lat: coord[1], Lon: coord[0]})
	}
	if len(points) == 0 {
		return nil, fmt.Errorf("empty geometry")
	}
	return points, nil
}

func decodeEncodedPolyline(encoded string) ([]domain.LatLon, error) {
	var points []domain.LatLon
	var index, lat, lon int
	for index < len(encoded) {
		dLat, next, err := decodePolylineValue(encoded, index)
		if err != nil {
			return nil, err
		}
		index = next
		dLon, next, err := decodePolylineValue(encoded, index)
		if err != nil {
			return nil, err
		}
		index = next
		lat += dLat
		lon += dLon
		points = append(points, domain.LatLon{Lat: float64(lat) / 1e5, Lon: float64(lon) / 1e5})
	}
	if len(points) == 0 {
		return nil, fmt.Errorf("empty encoded polyline")
	}
	return points, nil
}

func decodePolylineValue(encoded string, index int) (int, int, error) {
	var result, shift int
	for {
		if index >= len(encoded) {
			return 0, index, fmt.Errorf("invalid encoded polyline")
		}
		b := int(encoded[index]) - 63
		index++
		result |= (b & 0x1f) << shift
		shift += 5
		if b < 0x20 {
			break
		}
	}
	if result&1 != 0 {
		return ^(result >> 1), index, nil
	}
	return result >> 1, index, nil
}

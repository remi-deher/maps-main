package simulation

import (
	"encoding/xml"

	"github.com/remi-deher/maps-main/engine/internal/domain"
)

type gpxTrkpt struct {
	Lat float64 `xml:"lat,attr"`
	Lon float64 `xml:"lon,attr"`
}

type gpxDoc struct {
	Tracks []struct {
		Segments []struct {
			Points []gpxTrkpt `xml:"trkpt"`
		} `xml:"trkseg"`
	} `xml:"trk"`
}

func ParseGPXCoordinates(gpxContent string) []domain.LatLon {
	var doc gpxDoc
	if err := xml.Unmarshal([]byte(gpxContent), &doc); err != nil {
		return nil
	}
	var points []domain.LatLon
	for _, trk := range doc.Tracks {
		for _, seg := range trk.Segments {
			for _, pt := range seg.Points {
				points = append(points, domain.LatLon{Lat: pt.Lat, Lon: pt.Lon})
			}
		}
	}
	return points
}

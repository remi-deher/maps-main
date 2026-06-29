package simulation

import "github.com/remi-deher/maps-main/engine/internal/domain"

type Plan struct {
	Points  []domain.LatLon
	Looping bool
	Speed   float64
}

type Strategy interface {
	Plan() (Plan, error)
}

type RoutePath struct {
	RawPoints []domain.LatLon
	SpeedKmh  float64
	Looping   bool
}

func (s RoutePath) Plan() (Plan, error) {
	return Plan{
		Points:  Interpolate(s.RawPoints, s.SpeedKmh),
		Looping: s.Looping,
		Speed:   s.SpeedKmh,
	}, nil
}

type GPX struct {
	Content  string
	SpeedKmh float64
}

func (s GPX) Plan() (Plan, error) {
	points := ParseGPXCoordinates(s.Content)
	return Plan{
		Points:  Interpolate(points, s.SpeedKmh),
		Looping: false,
		Speed:   s.SpeedKmh,
	}, nil
}

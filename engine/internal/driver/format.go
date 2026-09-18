package driver

import "strconv"

// Shared formatting/decoding helpers. Both backends build CLI arguments from
// the same float/int values and decode the same kind of loosely-typed JSON
// device metadata, so these live here rather than being redefined identically
// in each backend package.

// Ftoa formats a coordinate for a CLI argument: full precision, no exponent.
func Ftoa(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// Itoa formats a port (or any int) for a CLI argument.
func Itoa(v int) string { return strconv.Itoa(v) }

// StringField reads key from a decoded JSON object, returning "" when absent or
// not a string. Device metadata payloads drift between tool versions, so a
// missing field must degrade to empty rather than fail the whole decode.
func StringField(raw map[string]any, key string) string {
	s, _ := raw[key].(string)
	return s
}

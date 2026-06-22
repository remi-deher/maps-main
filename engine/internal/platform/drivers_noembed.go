//go:build !windows || !embed_drivers

package platform

// BundledDriverPaths returns empty paths for every build except the
// self-contained Windows portable build (-tags embed_drivers): there are no
// embedded drivers to extract, so the normal PATH / resources / system-Python
// resolution applies. See drivers_embed.go for the embedded variant.
func BundledDriverPaths() (goios string, python string) {
	return "", ""
}

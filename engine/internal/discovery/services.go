package discovery

// AppleMDNSServices are the Bonjour service types iOS devices advertise for
// pairing and remote discovery. Continuously browsing them keeps the device's
// mDNS responder awake: iOS powers that responder down when idle, which is the
// usual reason a tunnel daemon can't find a device over WiFi even though it's on
// the same network. A passive browse query nudges it to re-announce.
var AppleMDNSServices = []string{
	"_apple-mobdev2._tcp", // classic WiFi-sync pairing, most reliably advertised
	"_remotepairing._tcp", // iOS 17+ RSD remote pairing (WiFi tunnel)
	"_remoted._tcp",       // iOS 17+ remoted (USB-ethernet interface)
}

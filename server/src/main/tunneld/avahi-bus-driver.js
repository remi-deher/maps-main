'use strict'

const dbus = require('dbus-next');
const { EventEmitter } = require('events');
const { dbg } = require('../logger');

/**
 * AvahiBusDriver - Gère la découverte mDNS via le service système Avahi (D-Bus)
 * Évite les conflits sur le port 5353.
 */
class AvahiBusDriver extends EventEmitter {
  constructor() {
    super();
    this.bus = null;
    this.server = null;
    this.browser = null;
    this._isDiscoveryActive = false;
  }

  async startDiscovery() {
    if (this._isDiscoveryActive) return;
    
    try {
      dbg('[avahi-bus] Connexion au System Bus D-Bus...');
      this.bus = dbus.systemBus();
      
      // Récupération de l'interface serveur Avahi
      const obj = await this.bus.getProxyObject('org.freedesktop.Avahi', '/');
      this.server = obj.getInterface('org.freedesktop.Avahi.Server');

      dbg('[avahi-bus] Création du ServiceBrowser pour _apple-mobdev2._tcp...');
      
      // ServiceBrowserNew(interface, protocol, type, domain, flags)
      // interface=-1 (toutes), protocol=-1 (tous), type=_apple-mobdev2._tcp, domain=local, flags=0
      const browserPath = await this.server.ServiceBrowserNew(-1, -1, '_apple-mobdev2._tcp', 'local', 0);
      
      const browserObj = await this.bus.getProxyObject('org.freedesktop.Avahi', browserPath);
      this.browser = browserObj.getInterface('org.freedesktop.Avahi.ServiceBrowser');

      // Écoute du signal ItemNew
      this.browser.on('ItemNew', async (iface, protocol, name, type, domain, flags) => {
        dbg(`[avahi-bus] Item trouvé : ${name} sur interface ${iface}`);
        await this._resolve(iface, protocol, name, type, domain);
      });

      this._isDiscoveryActive = true;
      dbg('[avahi-bus] Découverte active.');

    } catch (err) {
      dbg(`[avahi-bus] ERREUR : Impossible de démarrer la découverte Avahi : ${err.message}`);
      if (err.message.includes('The name org.freedesktop.Avahi was not provided')) {
          dbg('[avahi-bus] CONSEIL : Vérifiez que avahi-daemon est installé et lancé (sudo systemctl start avahi-daemon)');
      }
      this.emit('error', err);
    }
  }

  async _resolve(iface, protocol, name, type, domain) {
    try {
      // ResolveService(interface, protocol, name, type, domain, aprotocol, flags)
      // aprotocol=-1 (auto)
      const result = await this.server.ResolveService(iface, protocol, name, type, domain, -1, 0);
      
      // Index du résultat :
      // 0: iface, 1: proto, 2: name, 3: type, 4: domain, 5: host, 6: aprotocol, 7: address, 8: port, 9: txt, 10: flags
      const address = result[7];
      const port = result[8];
      const txtArray = result[9]; // Array of byte arrays
      
      const device = {
        name: name,
        host: result[5],
        address: address,
        port: port,
        interface: iface,
        protocol: protocol,
        udid: this._extractUdid(name, txtArray)
      };

      // Si c'est une adresse IPv6 Link-Local, on ajoute le scope ID (%interface)
      if (address.startsWith('fe80:')) {
        // Note: On devrait idealement resoudre le nom d'interface (eth0, etc) 
        // mais l'index iface suffit souvent aux outils comme go-ios si on l'ajoute (%)
        device.address = `${address}%${iface}`;
      }

      dbg(`[avahi-bus] Résolu : ${device.name} -> ${device.address}:${device.port} (UDID: ${device.udid})`);
      this.emit('deviceFound', device);

    } catch (err) {
      dbg(`[avahi-bus] Erreur de résolution pour ${name}: ${err.message}`);
    }
  }

  _extractUdid(name, txtArray) {
    // 1. Chercher dans les TXT records (format key=value)
    if (txtArray && Array.isArray(txtArray)) {
      for (const bytes of txtArray) {
        const line = Buffer.from(bytes).toString();
        if (line.startsWith('identifier=')) {
          return line.split('=')[1];
        }
      }
    }

    // 2. Fallback : Extraire du nom de l'instance si format UDID connu
    // Souvent le nom contient l'UDID après le @
    const match = name.match(/@([a-fA-F0-9-]{25,})/);
    if (match) return match[1];

    return null;
  }

  stopDiscovery() {
    if (this.bus) {
      try {
        this.bus.disconnect();
      } catch (_) {}
      this.bus = null;
      this.server = null;
      this.browser = null;
      this._isDiscoveryActive = false;
      dbg('[avahi-bus] Découverte arrêtée.');
    }
  }
}

module.exports = new AvahiBusDriver();

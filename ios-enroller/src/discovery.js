const { Bonjour } = require('bonjour-service');

// Service mDNS annoncé par le moteur Go (_gpsmock._tcp), réutilisé ici pour
// découvrir automatiquement les serveurs disponibles sur le réseau local.
const MDNS_SERVICE_TYPE = 'gpsmock';
const SCAN_DURATION_MS = 3000;

// Scanne le réseau local pendant SCAN_DURATION_MS et résout avec la liste
// dédupliquée des serveurs Moteur découverts.
function scanEngines(durationMs = SCAN_DURATION_MS) {
    return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const found = new Map();

        const browser = bonjour.find({ type: MDNS_SERVICE_TYPE }, (service) => {
            const addr = (service.addresses || []).find((a) => a.includes('.')) || (service.addresses || [])[0];
            if (!addr) return;
            const key = `${addr}:${service.port}`;
            found.set(key, { name: service.name, host: addr, port: service.port });
        });

        setTimeout(() => {
            browser.stop();
            bonjour.destroy();
            resolve(Array.from(found.values()));
        }, durationMs);
    });
}

module.exports = { scanEngines };

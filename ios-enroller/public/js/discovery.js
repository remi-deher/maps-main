import { log } from './logger.js';

const btnScan = document.getElementById('btnScan');
const discoveredServers = document.getElementById('discoveredServers');
const targetIpInput = document.getElementById('targetIp');

export function initDiscovery() {
    btnScan.addEventListener('click', async () => {
        btnScan.disabled = true;
        discoveredServers.classList.add('hidden');
        discoveredServers.innerHTML = '';
        log('Scan mDNS du réseau local (3s)...');

        try {
            const res = await fetch('/api/scan-engines');
            const data = await res.json();
            const servers = data.servers || [];

            if (servers.length === 0) {
                log('Aucun serveur Moteur découvert sur le réseau.', 'error');
            } else {
                log(`${servers.length} serveur(s) découvert(s) sur le réseau.`, 'success');
                discoveredServers.innerHTML = '<option value="">— Choisir un serveur découvert —</option>' +
                    servers.map(s => `<option value="${s.host}:${s.port}">${s.name} (${s.host}:${s.port})</option>`).join('');
                discoveredServers.classList.remove('hidden');
            }
        } catch (e) {
            log('Erreur lors du scan réseau.', 'error');
        }

        btnScan.disabled = false;
    });

    discoveredServers.addEventListener('change', () => {
        if (discoveredServers.value) {
            targetIpInput.value = discoveredServers.value;
        }
    });
}

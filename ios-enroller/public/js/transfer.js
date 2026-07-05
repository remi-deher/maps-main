import { log } from './logger.js';
import { getCurrentUdid, setStatusSubtext } from './deviceStatus.js';

const btnTransfer = document.getElementById('btnTransfer');
const targetIpInput = document.getElementById('targetIp');
const apiTokenInput = document.getElementById('apiToken');

export function initTransfer() {
    btnTransfer.addEventListener('click', async () => {
        const targetIp = targetIpInput.value.trim();
        if (!targetIp) {
            log("Veuillez saisir l'adresse IP cible.", 'error');
            return;
        }
        const token = apiTokenInput ? apiTokenInput.value.trim() : '';

        btnTransfer.disabled = true;
        log(`Envoi des certificats vers ${targetIp}...`);

        try {
            const res = await fetch('/api/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetIp, udid: getCurrentUdid(), token }),
            });
            const data = await res.json();

            if (data.success) {
                log('Envoi réussi ✅ ! Les certificats sont installés sur le moteur distant.', 'success');
                setStatusSubtext('Clés de pairage enregistrées avec succès.');
            } else {
                log("Échec de l'envoi : " + data.error, 'error');
            }
        } catch (e) {
            log('Erreur réseau lors de la communication de transfert.', 'error');
        }

        btnTransfer.disabled = false;
    });
}

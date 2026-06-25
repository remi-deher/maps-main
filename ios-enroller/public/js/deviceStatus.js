import { log, getMessageCount } from './logger.js';

const statusMain = document.getElementById('statusMain');
const statusSub = document.getElementById('statusSub');
const statusDot = document.getElementById('statusDot');
const btnPair = document.getElementById('btnPair');
const transferSection = document.getElementById('transferSection');

let currentUdid = null;

export function getCurrentUdid() {
    return currentUdid;
}

export function setStatusSubtext(text) {
    statusSub.textContent = text;
}

function showPaired(udid) {
    statusMain.textContent = 'Prêt à être enrôlé ✅';
    statusMain.style.color = 'var(--success)';
    statusDot.className = 'pulse-dot paired';
    statusSub.textContent = `UDID: ${udid}`;
    btnPair.classList.add('hidden');
    transferSection.classList.remove('hidden');
}

function showUnpaired() {
    statusMain.textContent = 'Non associé';
    statusMain.style.color = 'var(--text-main)';
    statusDot.className = 'pulse-dot connected';
    statusSub.textContent = "Cliquez sur Associer puis validez sur l'écran.";
    btnPair.classList.remove('hidden');
    transferSection.classList.add('hidden');
}

function showDisconnected() {
    statusMain.textContent = 'Aucun appareil trouvé';
    statusMain.style.color = 'var(--text-muted)';
    statusDot.className = 'pulse-dot';
    statusSub.textContent = 'Veuillez brancher votre iPhone en USB';
    btnPair.classList.add('hidden');
    transferSection.classList.add('hidden');
}

export async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        if (data.connected && data.udid) {
            if (currentUdid !== data.udid) {
                log(`Appareil branché : ${data.udid}`, 'success');
            }
            currentUdid = data.udid;
            data.isPaired ? showPaired(data.udid) : showUnpaired();
        } else {
            if (currentUdid !== null) {
                log('Appareil déconnecté.', 'error');
            }
            currentUdid = null;
            showDisconnected();
        }
    } catch (e) {
        if (getMessageCount() < 5) {
            log('Attente de connexion avec le serveur local...', 'error');
        }
    }
}

export function initPairing() {
    btnPair.addEventListener('click', async () => {
        btnPair.disabled = true;
        log("Lancement de la procédure d'association...");
        try {
            const res = await fetch('/api/pair', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                log(data.message, 'success');
                statusMain.textContent = 'Faire confiance à cet ordinateur ?';
                statusSub.textContent = "Déverrouillez l'iPhone et acceptez la demande de confiance.";
            } else {
                log("Erreur d'association : " + data.error, 'error');
            }
        } catch (e) {
            log('Erreur réseau de pairage.', 'error');
        }
        setTimeout(() => { btnPair.disabled = false; }, 3000);
    });
}

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SELF_IDENTITY_PATH, LOCKDOWN_DIR } = require('./paths');

function normalizeServerUrl(targetIp) {
    let baseUrl = targetIp;
    if (!baseUrl.startsWith('http')) baseUrl = `http://${baseUrl}`;
    if (!baseUrl.includes(':', 6)) baseUrl = `${baseUrl}:8080`;
    return baseUrl;
}

// Turns a low-level axios/network failure (no HTTP response) into an actionable
// message. Returns null when the request did get a response (an HTTP status the
// caller should handle itself, e.g. 401/404).
function networkErrorMessage(err, url) {
    if (err.response) return null;
    const code = err.code || '';
    if (code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
        return `Le moteur ne répond pas à ${url} (délai dépassé). Vérifiez qu'il est démarré, qu'il écoute sur ce port (0.0.0.0, pas seulement 127.0.0.1), et que le pare-feu / le réseau autorise la connexion.`;
    }
    if (code === 'ECONNREFUSED') {
        return `Connexion refusée par ${url} : aucun moteur n'écoute sur ce port à cette adresse (ou le pare-feu la bloque).`;
    }
    if (['ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(code)) {
        return `Hôte injoignable (${url}) : vérifiez l'adresse IP et que les deux machines sont sur le même réseau.`;
    }
    return `Impossible de joindre le moteur (${url}) : ${err.message}`;
}

// Échange le code d'appairage à 6 chiffres (affiché par l'écran "Accès distant"
// du moteur, il change toutes les 30 s) contre un jeton durable via POST
// /api/pair — le seul endpoint qu'un client non encore approuvé peut appeler.
async function redeemPairCode(targetIp, code) {
    const baseUrl = normalizeServerUrl(targetIp);
    const payload = { code: String(code).trim(), label: 'ios-enroller (GUI)' };
    try {
        const response = await axios.post(`${baseUrl}/api/pair`, payload, { timeout: 4000 });
        const token = response.data && response.data.token;
        if (!token) throw new Error("Réponse d'appairage sans jeton.");
        return token;
    } catch (err) {
        if (err.response && err.response.status === 401) {
            throw new Error('Code d\'appairage invalide ou expiré (il change toutes les 30 s — ressaisissez le code affiché à l\'instant).');
        }
        if (err.response && err.response.status === 404) {
            throw new Error("L'accès distant n'est pas activé sur ce moteur (endpoint /api/pair absent).");
        }
        const netMsg = networkErrorMessage(err, `${baseUrl}/api/pair`);
        if (netMsg) throw new Error(netMsg);
        throw err;
    }
}

// Envoie les clés de pairage de `udid` vers le moteur Go ciblé par `targetIp`,
// en tentant l'endpoint moderne puis l'ancien en repli (404). `token` porte la
// clé API / le jeton d'appairage requis quand le moteur distant est protégé.
async function transferKeys(targetIp, udid, token) {
    const lockdownPath = path.join(LOCKDOWN_DIR, `${udid}.plist`);
    if (!fs.existsSync(lockdownPath)) {
        throw new Error(`Fichier de pairage introuvable. L'appareil est-il bien enrôlé ? (${lockdownPath})`);
    }

    let selfIdentityData = '';
    if (fs.existsSync(SELF_IDENTITY_PATH)) {
        selfIdentityData = fs.readFileSync(SELF_IDENTITY_PATH).toString('base64');
    }
    const deviceRecordData = fs.readFileSync(lockdownPath).toString('base64');

    const baseUrl = normalizeServerUrl(targetIp);
    const payload = { udid, selfIdentity: selfIdentityData, deviceRecord: deviceRecordData };
    // The remote engine gates /api/device/enroll behind auth for non-loopback
    // callers; send the credential as a Bearer token when provided.
    const headers = {};
    if (token && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
    }
    const options = { timeout: 4000, headers };

    const asUnauthorized = (err) => {
        if (err.response && err.response.status === 401) {
            return new Error(
                token && token.trim()
                    ? "Le moteur distant a refusé le jeton fourni (401). Vérifiez la clé API / le jeton d'appairage."
                    : "Le moteur distant est protégé (401). Renseignez la clé API ou un jeton d'appairage."
            );
        }
        return null;
    };

    try {
        console.log(`[DEBUG] Tentative d'envoi vers ${baseUrl}/api/device/enroll...`);
        const response = await axios.post(`${baseUrl}/api/device/enroll`, payload, options);
        return response.data;
    } catch (err) {
        const unauthorized = asUnauthorized(err);
        if (unauthorized) throw unauthorized;
        if (err.response && err.response.status === 404) {
            console.log(`[DEBUG] Endpoint moderne non trouvé (404), tentative avec l'ancien endpoint /api/enroll...`);
            try {
                const response = await axios.post(`${baseUrl}/api/enroll`, payload, options);
                return response.data;
            } catch (errFallback) {
                const unauth = asUnauthorized(errFallback);
                if (unauth) throw unauth;
                const netFb = networkErrorMessage(errFallback, `${baseUrl}/api/enroll`);
                if (netFb) throw new Error(netFb);
                throw errFallback;
            }
        }
        const netMsg = networkErrorMessage(err, `${baseUrl}/api/device/enroll`);
        if (netMsg) throw new Error(netMsg);
        throw err;
    }
}

module.exports = { transferKeys, redeemPairCode };

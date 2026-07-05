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
                throw errFallback;
            }
        }
        throw err;
    }
}

module.exports = { transferKeys };

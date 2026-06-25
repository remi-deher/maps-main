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
// en tentant l'endpoint moderne puis l'ancien en repli (404).
async function transferKeys(targetIp, udid) {
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

    try {
        console.log(`[DEBUG] Tentative d'envoi vers ${baseUrl}/api/device/enroll...`);
        const response = await axios.post(`${baseUrl}/api/device/enroll`, payload, { timeout: 4000 });
        return response.data;
    } catch (err) {
        if (err.response && err.response.status === 404) {
            console.log(`[DEBUG] Endpoint moderne non trouvé (404), tentative avec l'ancien endpoint /api/enroll...`);
            const response = await axios.post(`${baseUrl}/api/enroll`, payload, { timeout: 4000 });
            return response.data;
        }
        throw err;
    }
}

module.exports = { transferKeys };

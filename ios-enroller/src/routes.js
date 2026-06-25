const express = require('express');
const { getDeviceStatus, requestTrust } = require('./goios');
const { scanEngines } = require('./discovery');
const { transferKeys } = require('./enrollment');

const router = express.Router();

// 1. Détection de l'iPhone et récupération du UDID
router.get('/status', async (req, res) => {
    try {
        res.json(await getDeviceStatus());
    } catch (error) {
        console.error('[ERREUR] go-ios list a échoué:', error.message);
        res.json({ connected: false, error: error.message, debug: 'Erreur exécution' });
    }
});

// 2. Pairage (demander la confiance)
router.post('/pair', async (req, res) => {
    try {
        const message = await requestTrust();
        res.json({ success: true, message });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 3. Transfert des clés vers le serveur distant
router.post('/transfer', async (req, res) => {
    const { targetIp, udid } = req.body;
    if (!targetIp || !udid) {
        return res.status(400).json({ success: false, error: 'IP cible ou UDID manquant' });
    }

    try {
        const data = await transferKeys(targetIp, udid);
        res.json({ success: true, data });
    } catch (error) {
        res.status(error.status || 500).json({
            success: false,
            error: error.response ? JSON.stringify(error.response.data) : error.message,
        });
    }
});

// 4. Découverte des serveurs Moteur disponibles sur le réseau local (mDNS)
router.get('/scan-engines', async (req, res) => {
    const servers = await scanEngines();
    res.json({ servers });
});

module.exports = router;

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const GOIOS_PATH = path.join(__dirname, '..', 'server', 'resources', 'ios.exe');
const SELF_IDENTITY_PATH = path.join(__dirname, '..', 'selfIdentity.plist');
const LOCKDOWN_DIR = 'C:\\ProgramData\\Apple\\Lockdown';

// Helper pour exécuter une commande
function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error && !stdout) {
                reject(error);
            } else {
                resolve(stdout || stderr);
            }
        });
    });
}

// 1. Détection de l'iPhone et récupération du UDID
app.get('/api/status', async (req, res) => {
    try {
        console.log("[DEBUG] Exécution de go-ios list...");
        const output = await runCommand(`"${GOIOS_PATH}" list`);
        console.log("[DEBUG] Sortie brute:", output);
        
        const lines = output.split('\n');
        let udid = null;

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line.trim());
                if (parsed.deviceList && Array.isArray(parsed.deviceList) && parsed.deviceList.length > 0) {
                    udid = parsed.deviceList[0];
                    console.log("[DEBUG] UDID trouvé via deviceList:", udid);
                    break;
                } else if (Array.isArray(parsed) && parsed.length > 0) {
                    udid = parsed[0].Udid || parsed[0].udid;
                    console.log("[DEBUG] UDID trouvé via tableau natif:", udid);
                    break;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        if (udid) {
            const lockdownFile = path.join(LOCKDOWN_DIR, `${udid}.plist`);
            const isPaired = fs.existsSync(lockdownFile);
            console.log(`[DEBUG] Fichier lockdown trouvé pour ${udid} ?`, isPaired);
            return res.json({ connected: true, udid, isPaired, rawOutput: output });
        }

        console.log("[DEBUG] Échec de l'extraction de l'UDID.");
        res.json({ connected: false, message: "Aucun appareil trouvé", rawOutput: output });
    } catch (error) {
        console.error("[ERREUR] go-ios list a échoué:", error.message);
        res.json({ connected: false, error: error.message, debug: "Erreur exécution" });
    }
});

// 2. Pairage (demander la confiance)
app.post('/api/pair', async (req, res) => {
    try {
        // La commande 'info' de go-ios force généralement le prompt de Trust sur l'écran
        // s'il n'est pas déjà pairé.
        const output = await runCommand(`"${GOIOS_PATH}" info`);
        res.json({ success: true, message: "Veuillez vérifier l'écran de votre iPhone et cliquer sur 'Faire confiance'." });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 3. Transfert des clés vers le serveur distant
app.post('/api/transfer', async (req, res) => {
    const { targetIp, udid } = req.body;
    
    if (!targetIp || !udid) {
        return res.status(400).json({ success: false, error: "IP cible ou UDID manquant" });
    }

    try {
        const lockdownPath = path.join(LOCKDOWN_DIR, `${udid}.plist`);
        
        if (!fs.existsSync(SELF_IDENTITY_PATH)) {
            return res.status(400).json({ success: false, error: `selfIdentity.plist introuvable: ${SELF_IDENTITY_PATH}` });
        }
        
        if (!fs.existsSync(lockdownPath)) {
            return res.status(400).json({ success: false, error: `Fichier de pairage introuvable. L'appareil est-il bien enrôlé ? (${lockdownPath})` });
        }

        const selfIdentityData = fs.readFileSync(SELF_IDENTITY_PATH).toString('base64');
        const deviceRecordData = fs.readFileSync(lockdownPath).toString('base64');

        // Construire l'URL du serveur (ajout auto de http:// et port 8080 si non spécifié)
        let url = targetIp;
        if (!url.startsWith('http')) url = `http://${url}`;
        if (!url.includes(':', 6)) url = `${url}:8080`;
        url = `${url}/api/enroll`;

        const payload = {
            udid,
            selfIdentity: selfIdentityData,
            deviceRecord: deviceRecordData
        };

        const response = await axios.post(url, payload, { timeout: 5000 });
        res.json({ success: true, data: response.data });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.response ? JSON.stringify(error.response.data) : error.message 
        });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`[iOS-Enroller] Serveur démarré sur http://localhost:${PORT}`);
});

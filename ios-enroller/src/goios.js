const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { GOIOS_PATH, LOCKDOWN_DIR } = require('./paths');

// execFile, pas exec : les arguments sont passés tels quels au binaire au lieu
// de traverser un shell. GOIOS_PATH est un chemin résolu sur disque, il peut
// donc contenir des espaces (« C:\Program Files\... ») ou des métacaractères
// venant du nom du dossier d'installation ; avec exec il fallait le citer à la
// main et un `&` bien placé suffisait à faire exécuter autre chose.
function runIos(args) {
    return new Promise((resolve, reject) => {
        execFile(GOIOS_PATH, args, (error, stdout, stderr) => {
            if (error && !stdout) {
                reject(error);
            } else {
                resolve(stdout || stderr);
            }
        });
    });
}

function extractUdid(rawOutput) {
    const lines = rawOutput.split('\n');
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line.trim());
            if (parsed.deviceList && Array.isArray(parsed.deviceList) && parsed.deviceList.length > 0) {
                return parsed.deviceList[0];
            }
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed[0].Udid || parsed[0].udid;
            }
        } catch (e) {
            // Ignore lines that aren't valid JSON
        }
    }
    return null;
}

// Détecte l'appareil branché et indique s'il est déjà associé (pairé).
async function getDeviceStatus() {
    console.log('[DEBUG] Exécution de go-ios list...');
    const output = await runIos(['list']);
    console.log('[DEBUG] Sortie brute:', output);

    const udid = extractUdid(output);
    if (!udid) {
        console.log("[DEBUG] Échec de l'extraction de l'UDID.");
        return { connected: false, message: 'Aucun appareil trouvé', rawOutput: output };
    }

    const lockdownFile = path.join(LOCKDOWN_DIR, `${udid}.plist`);
    const isPaired = fs.existsSync(lockdownFile);
    console.log(`[DEBUG] Fichier lockdown trouvé pour ${udid} ?`, isPaired);
    return { connected: true, udid, isPaired, rawOutput: output };
}

// Force l'invite "Faire confiance" sur l'iPhone via une commande go-ios.
async function requestTrust() {
    await runIos(['info']);
    return "Veuillez vérifier l'écran de votre iPhone et cliquer sur 'Faire confiance'.";
}

module.exports = { getDeviceStatus, requestTrust };

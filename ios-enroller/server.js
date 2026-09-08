const express = require('express');
const { publicDir } = require('./src/paths');
const apiRoutes = require('./src/routes');
const { resolveConfig } = require('./src/config');
const { originGuard, requireAccessKey } = require('./src/security');

const config = resolveConfig();
const app = express();

// Pas de CORS : le GUI est servi par ce même processus, donc toujours en même
// origine. Un `cors()` permissif autorisait au contraire n'importe quelle page
// web à piloter l'enrôleur — voir src/security.js.
app.use(originGuard());
app.use(express.json({ limit: '256kb' }));
app.use(express.static(publicDir));
app.use('/api', requireAccessKey(config.accessKey), apiRoutes);

const server = app.listen(config.port, config.host, () => {
    const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
    const suffix = config.accessKey ? `/?key=${config.accessKey}` : '';
    console.log(`[iOS-Enroller] Serveur démarré sur http://${shown}:${config.port}${suffix}`);
    if (!config.loopbackOnly) {
        console.log(`[iOS-Enroller] Écoute sur ${config.host} (accessible depuis le réseau).`);
        console.log('[iOS-Enroller] /api/transfer envoie les clés de pairage de votre iPhone : gardez cette URL privée.');
        if (config.generatedKey) {
            console.log("[iOS-Enroller] Aucune clé fournie : une clé d'accès a été générée pour cette session.");
            console.log('[iOS-Enroller] Fixez-la avec GPSMOCK_ENROLLER_KEY ou --key pour qu\'elle survive au redémarrage.');
        }
    }
});

module.exports = { app, server, config };

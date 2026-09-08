const crypto = require('crypto');

// Configuration du serveur local de l'enrôleur.
//
// L'enrôleur tourne sur la machine où l'iPhone est branché en USB : c'est là,
// et seulement là, que Windows/macOS écrit l'enregistrement de pairage Lockdown
// après un « Faire confiance ». Son serveur Express n'existe que pour servir
// son propre GUI au navigateur de l'opérateur ; le moteur distant, lui, est
// joint en sortant (POST /api/device/enroll), jamais en entrant.
//
// Le défaut est donc 127.0.0.1. Mais la configuration « PC sans écran dans un
// placard, iPhone branché dessus, GUI piloté depuis un autre poste » est
// légitime : d'où GPSMOCK_ENROLLER_HOST / --host.
//
// Cette ouverture n'est pas anodine. POST /api/transfer lit l'enregistrement de
// pairage de l'appareil et l'envoie à l'IP qu'on lui donne : exposé sans
// contrôle, il permet à n'importe qui sur le réseau d'exfiltrer les clés qui
// donnent un accès durable à l'iPhone. Une écoute non-loopback exige donc une
// clé d'accès (GPSMOCK_ENROLLER_KEY / --key) ; à défaut, on en génère une et on
// l'affiche au démarrage plutôt que de démarrer ouvert.

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function argValue(argv, name) {
    const prefixed = `--${name}=`;
    const withEquals = argv.find((a) => a.startsWith(prefixed));
    if (withEquals) return withEquals.slice(prefixed.length);
    const index = argv.indexOf(`--${name}`);
    if (index !== -1 && index + 1 < argv.length) return argv[index + 1];
    return undefined;
}

function isLoopbackHost(host) {
    return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

// Résout la configuration effective à partir des arguments et de
// l'environnement. Exportée avec ses entrées en paramètres pour rester
// testable sans toucher au process réel.
function resolveConfig(argv = process.argv.slice(2), env = process.env) {
    const host = argValue(argv, 'host') || env.GPSMOCK_ENROLLER_HOST || DEFAULT_HOST;
    const port = Number(argValue(argv, 'port') || env.GPSMOCK_ENROLLER_PORT || DEFAULT_PORT);
    const loopbackOnly = isLoopbackHost(host);

    // En loopback la clé reste facultative : seul un processus déjà présent sur
    // la machine peut atteindre le serveur, et il a de toute façon accès
    // directement au dossier Lockdown.
    let accessKey = argValue(argv, 'key') || env.GPSMOCK_ENROLLER_KEY || '';
    let generatedKey = false;
    if (!loopbackOnly && !accessKey) {
        accessKey = crypto.randomBytes(16).toString('hex');
        generatedKey = true;
    }

    return {
        host,
        port: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
        loopbackOnly,
        accessKey,
        generatedKey,
    };
}

module.exports = { resolveConfig, isLoopbackHost, DEFAULT_HOST, DEFAULT_PORT };

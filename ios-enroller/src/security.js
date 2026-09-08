const crypto = require('crypto');
const { isLoopbackHost } = require('./config');

// Garde-fous HTTP de l'enrôleur.
//
// Deux protections distinctes, parce qu'elles couvrent deux attaquants
// différents :
//
//   - checkOrigin : une page web quelconque visitée par l'opérateur ne doit pas
//     pouvoir appeler http://127.0.0.1:3001/api/transfer en son nom. Le
//     navigateur estampille ces requêtes d'un `Origin` qu'il ne peut pas
//     falsifier, ce qui suffit à les distinguer du GUI (même origine). C'est
//     ce qu'un `cors()` permissif détruisait : il autorisait explicitement
//     n'importe quelle origine.
//   - requireAccessKey : quand le serveur écoute au-delà du loopback, un voisin
//     de réseau ne doit pas pouvoir exfiltrer l'enregistrement de pairage.

// Origines acceptées : aucune (requête non-navigateur, ex. curl), la même que
// celle du serveur, ou une origine loopback — le GUI est servi par ce même
// processus, donc il n'a jamais besoin d'être cross-origin.
function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase()) return true;
    return isLoopbackHost(parsed.hostname);
}

function originGuard() {
    return (req, res, next) => {
        if (!checkOrigin(req)) {
            res.status(403).json({ success: false, error: 'Origine non autorisée.' });
            return;
        }
        next();
    };
}

// Comparaison à temps constant : une comparaison naïve laisse fuir la clé
// octet par octet à qui sait mesurer.
function keyMatches(expected, provided) {
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(provided || ''));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

// La clé est acceptée dans l'en-tête X-Enroller-Key (ce qu'envoie le GUI) ou en
// paramètre ?key= (ce qui permet d'ouvrir l'URL du GUI d'un simple clic depuis
// un autre poste ; le GUI la range ensuite dans sessionStorage).
function requireAccessKey(accessKey) {
    return (req, res, next) => {
        if (!accessKey) {
            next();
            return;
        }
        const provided = req.headers['x-enroller-key'] || req.query.key;
        if (!keyMatches(accessKey, provided)) {
            res.status(401).json({ success: false, error: "Clé d'accès manquante ou invalide." });
            return;
        }
        next();
    };
}

module.exports = { checkOrigin, originGuard, requireAccessKey, keyMatches };

// Accès à l'API locale de l'enrôleur.
//
// Quand le serveur écoute au-delà du loopback (--host), il exige une clé
// d'accès. L'opérateur ouvre alors l'URL affichée au démarrage, qui porte la
// clé en `?key=` ; on la range en sessionStorage et on la retire de la barre
// d'adresse, pour qu'elle ne traîne ni dans l'historique ni dans un
// copier-coller de l'URL. Les appels suivants la présentent en en-tête.
const STORAGE_KEY = 'enrollerAccessKey';

function readKeyFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    if (!key) return null;
    params.delete('key');
    const query = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
    return key;
}

function accessKey() {
    const fromUrl = readKeyFromLocation();
    if (fromUrl) {
        try {
            sessionStorage.setItem(STORAGE_KEY, fromUrl);
        } catch {
            // Navigation privée / stockage refusé : la clé reste valable pour
            // cet appel, seule la persistance est perdue.
        }
        return fromUrl;
    }
    try {
        return sessionStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

// fetch, avec la clé d'accès attachée quand il y en a une. En loopback il n'y
// en a pas et l'appel est identique à un fetch nu.
export async function apiFetch(path, options = {}) {
    const key = accessKey();
    const headers = { ...(options.headers || {}) };
    if (key) headers['X-Enroller-Key'] = key;
    return fetch(path, { ...options, headers });
}

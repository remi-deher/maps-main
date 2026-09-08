const test = require('node:test');
const assert = require('node:assert');
const { checkOrigin, requireAccessKey, keyMatches } = require('../src/security');

function req({ origin, host = 'localhost:3001', headers = {}, query = {} } = {}) {
    return { headers: { host, ...(origin ? { origin } : {}), ...headers }, query };
}

function runMiddleware(mw, request) {
    let status = null;
    let body = null;
    let nexted = false;
    const res = {
        status(code) {
            status = code;
            return this;
        },
        json(payload) {
            body = payload;
            return this;
        },
    };
    mw(request, res, () => {
        nexted = true;
    });
    return { status, body, nexted };
}

test("une requête sans Origin passe (curl, ou navigation directe)", () => {
    assert.strictEqual(checkOrigin(req()), true);
});

test('le GUI, servi en même origine, passe', () => {
    assert.strictEqual(checkOrigin(req({ origin: 'http://localhost:3001' })), true);
    assert.strictEqual(
        checkOrigin(req({ origin: 'http://192.168.1.10:3001', host: '192.168.1.10:3001' })),
        true,
    );
});

test('une page web tierce est refusée', () => {
    // Le cas qui motive la protection : /api/transfer envoie les clés de
    // pairage de l'iPhone à l'IP qu'on lui indique.
    assert.strictEqual(checkOrigin(req({ origin: 'https://evil.example' })), false);
    assert.strictEqual(checkOrigin(req({ origin: 'pas-une-url' })), false);
});

test("sans clé configurée (loopback), l'API reste ouverte", () => {
    assert.strictEqual(runMiddleware(requireAccessKey(''), req()).nexted, true);
});

test("avec une clé configurée, l'absence de clé donne un 401", () => {
    const out = runMiddleware(requireAccessKey('secret'), req());
    assert.strictEqual(out.nexted, false);
    assert.strictEqual(out.status, 401);
});

test('la clé est acceptée en en-tête comme en paramètre', () => {
    const mw = requireAccessKey('secret');
    assert.strictEqual(runMiddleware(mw, req({ headers: { 'x-enroller-key': 'secret' } })).nexted, true);
    assert.strictEqual(runMiddleware(mw, req({ query: { key: 'secret' } })).nexted, true);
    assert.strictEqual(runMiddleware(mw, req({ query: { key: 'mauvaise' } })).nexted, false);
});

test('la comparaison de clés tolère les longueurs différentes sans lever', () => {
    assert.strictEqual(keyMatches('secret', 'court'), false);
    assert.strictEqual(keyMatches('secret', undefined), false);
    assert.strictEqual(keyMatches('secret', 'secret'), true);
});

const test = require('node:test');
const assert = require('node:assert');
const { resolveConfig } = require('../src/config');

test('écoute sur le loopback par défaut, sans clé', () => {
    const cfg = resolveConfig([], {});
    assert.strictEqual(cfg.host, '127.0.0.1');
    assert.strictEqual(cfg.port, 3001);
    assert.strictEqual(cfg.loopbackOnly, true);
    assert.strictEqual(cfg.accessKey, '');
});

test('une écoute réseau sans clé fournie en génère une', () => {
    const cfg = resolveConfig(['--host', '0.0.0.0'], {});
    assert.strictEqual(cfg.loopbackOnly, false);
    assert.strictEqual(cfg.generatedKey, true);
    assert.ok(cfg.accessKey.length >= 32, 'la clé générée doit être suffisamment longue');
});

test('une clé explicite est conservée telle quelle', () => {
    const cfg = resolveConfig(['--host', '192.168.1.10'], { GPSMOCK_ENROLLER_KEY: 'secret-choisi' });
    assert.strictEqual(cfg.accessKey, 'secret-choisi');
    assert.strictEqual(cfg.generatedKey, false);
});

test('les arguments priment sur l\'environnement', () => {
    const cfg = resolveConfig(['--port=4000'], { GPSMOCK_ENROLLER_PORT: '5000' });
    assert.strictEqual(cfg.port, 4000);
});

test('un port invalide retombe sur le défaut plutôt que de faire échouer le bind', () => {
    assert.strictEqual(resolveConfig(['--port=abc'], {}).port, 3001);
    assert.strictEqual(resolveConfig(['--port=99999'], {}).port, 3001);
});

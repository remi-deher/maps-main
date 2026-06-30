const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

test('paths lockdown dir resolution', () => {
    // Save original platform
    const originalPlatform = process.platform;
    const originalEnv = process.env.ProgramData;

    try {
        // Clear require cache for paths.js to allow reloading with different platforms
        const pathsFilePath = path.resolve(__dirname, '../src/paths.js');

        // Test Windows (win32)
        Object.defineProperty(process, 'platform', { value: 'win32' });
        process.env.ProgramData = 'C:\\MockProgramData';
        delete require.cache[pathsFilePath];
        let paths = require('../src/paths');
        assert.ok(paths.LOCKDOWN_DIR.includes('C:\\MockProgramData'));
        assert.ok(paths.LOCKDOWN_DIR.endsWith(path.join('Apple', 'Lockdown')));

        // Test macOS (darwin)
        Object.defineProperty(process, 'platform', { value: 'darwin' });
        delete require.cache[pathsFilePath];
        paths = require('../src/paths');
        assert.strictEqual(paths.LOCKDOWN_DIR, '/var/db/lockdown');

        // Test Linux (linux)
        Object.defineProperty(process, 'platform', { value: 'linux' });
        delete require.cache[pathsFilePath];
        paths = require('../src/paths');
        assert.strictEqual(paths.LOCKDOWN_DIR, '/var/lib/lockdown');

    } finally {
        // Restore
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        if (originalEnv === undefined) {
            delete process.env.ProgramData;
        } else {
            process.env.ProgramData = originalEnv;
        }
        
        // Final reload to restore standard paths
        const pathsFilePath = path.resolve(__dirname, '../src/paths.js');
        delete require.cache[pathsFilePath];
    }
});

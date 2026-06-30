const fs = require('fs');
const path = require('path');

const exeDir = path.dirname(process.execPath);
const publicDir = path.join(__dirname, '..', 'public');

function resolveGoIosPath() {
    const candidates = [
        path.join(exeDir, 'ios.exe'),
        path.join(exeDir, 'ios'),
        path.join(__dirname, '..', '..', 'server', 'resources', 'ios.exe'),
        path.join(__dirname, '..', '..', 'tauri-app', 'src-tauri', 'resources', 'ios.exe'),
        path.join(__dirname, '..', 'ios.exe'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'ios';
}

function resolveSelfIdentityPath() {
    const local = path.join(exeDir, 'selfIdentity.plist');
    if (fs.existsSync(local)) return local;
    return path.join(__dirname, '..', '..', 'selfIdentity.plist');
}

function resolveLockdownDir() {
    if (process.platform === 'win32') {
        const programData = process.env.ProgramData || 'C:\\ProgramData';
        return path.join(programData, 'Apple', 'Lockdown');
    } else if (process.platform === 'darwin') {
        return '/var/db/lockdown';
    }
    return '/var/lib/lockdown';
}

module.exports = {
    publicDir,
    GOIOS_PATH: resolveGoIosPath(),
    SELF_IDENTITY_PATH: resolveSelfIdentityPath(),
    LOCKDOWN_DIR: resolveLockdownDir(),
};

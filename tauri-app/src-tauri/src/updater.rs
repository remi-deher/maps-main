// Engine ("sidecar") component self-updater.
//
// The desktop bundle ships three independently-versioned parts: the Tauri shell
// (+ React frontend), the Go engine binary, and the big iOS-driver resources.
// The engine changes far more often than the rest, so re-downloading the whole
// installer for every engine fix wastes bandwidth. This module updates *only*
// the engine binary: it fetches the matching per-platform asset from the latest
// GitHub release, verifies its SHA-256 against the release's `checksums.txt`,
// and drops it into a writable app-data override directory. `spawn_engine`
// prefers that override when present, so no write to Program Files (and thus no
// elevation) is ever needed, and reverting is just deleting the override.
//
// Integrity note: the SHA-256 check protects against a corrupted/truncated
// download. It is NOT a substitute for signing the release assets (an attacker
// who can replace the binary on the release can also replace the checksum).
// Signature verification with an embedded public key is the planned hardening
// step, shared with the Tauri shell updater.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// GitHub repository hosting the releases. Kept as a constant so the updater has
/// a single, auditable source it will download executables from.
const RELEASE_REPO: &str = "remi-deher/maps-main";
const USER_AGENT: &str = "gpsmock-desktop-updater";

#[derive(Serialize, Clone)]
pub struct EngineRelease {
    /// Release tag, e.g. "v0.6.1".
    pub tag: String,
    /// Human-readable release name/notes title.
    pub name: String,
    /// Direct download URL of the engine asset matching this platform.
    pub asset_url: String,
    /// Asset file name, e.g. "gpsmock-engine-windows-amd64.exe".
    pub asset_name: String,
    /// Expected lowercase hex SHA-256, or empty if checksums.txt was missing.
    pub sha256: String,
}

/// Maps the compile-time target to the release asset name produced by the
/// release workflow (`gpsmock-engine-<goos>-<goarch>[.exe]`). Returns None for
/// platforms the release matrix doesn't build.
fn engine_asset_name() -> Option<String> {
    let goos = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return None;
    };
    let goarch = if cfg!(target_arch = "x86_64") {
        "amd64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        return None;
    };
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    Some(format!("gpsmock-engine-{goos}-{goarch}{ext}"))
}

/// Writable directory holding an updated engine that overrides the bundled
/// sidecar. Created on demand.
pub fn engine_override_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("engine");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Path of the overriding engine binary (may not exist).
pub fn override_engine_path(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") {
        "gpsmock-engine.exe"
    } else {
        "gpsmock-engine"
    };
    Some(engine_override_dir(app)?.join(name))
}

/// Returns the override engine path only if a usable binary is actually present,
/// so callers can decide between the override and the bundled sidecar.
pub fn active_override_engine(app: &AppHandle) -> Option<PathBuf> {
    let path = override_engine_path(app)?;
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("HTTP client init failed: {e}"))
}

/// Queries the GitHub API for the latest release and resolves the engine asset
/// for this platform plus its expected SHA-256 (from the `checksums.txt` asset).
pub async fn fetch_latest_release() -> Result<EngineRelease, String> {
    let asset_name = engine_asset_name().ok_or("unsupported platform for engine update")?;
    let client = http_client()?;

    let url = format!("https://api.github.com/repos/{RELEASE_REPO}/releases/latest");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("release lookup failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("release lookup HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("release JSON decode failed: {e}"))?;

    let tag = body["tag_name"].as_str().unwrap_or_default().to_string();
    let name = body["name"].as_str().unwrap_or(&tag).to_string();
    let assets = body["assets"].as_array().cloned().unwrap_or_default();

    let find_url = |want: &str| -> Option<String> {
        assets.iter().find_map(|a| {
            let n = a["name"].as_str()?;
            if n == want {
                a["browser_download_url"].as_str().map(str::to_string)
            } else {
                None
            }
        })
    };

    let asset_url = find_url(&asset_name)
        .ok_or_else(|| format!("no engine asset '{asset_name}' in release {tag}"))?;

    // Best-effort checksum: fetch checksums.txt and pull the line for our asset.
    let sha256 = match find_url("checksums.txt") {
        Some(cs_url) => fetch_checksum(&client, &cs_url, &asset_name)
            .await
            .unwrap_or_default(),
        None => String::new(),
    };

    Ok(EngineRelease {
        tag,
        name,
        asset_url,
        asset_name,
        sha256,
    })
}

/// Downloads checksums.txt and returns the lowercase hex SHA-256 for `asset`.
/// Accepts the standard `sha256sum` line format: "<hash>  <filename>".
async fn fetch_checksum(
    client: &reqwest::Client,
    url: &str,
    asset: &str,
) -> Result<String, String> {
    let text = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("checksums download failed: {e}"))?
        .text()
        .await
        .map_err(|e| format!("checksums read failed: {e}"))?;
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let hash = parts.next().unwrap_or_default();
        let name = parts.last().unwrap_or_default().trim_start_matches('*');
        if name == asset && hash.len() == 64 {
            return Ok(hash.to_lowercase());
        }
    }
    Err(format!("no checksum entry for {asset}"))
}

/// Downloads the engine asset, verifies its SHA-256 (when known), and writes it
/// atomically into the override directory. Returns the final path. Does NOT
/// restart the engine — the caller re-spawns so the new binary takes effect.
pub async fn download_engine_update(
    app: &AppHandle,
    rel: &EngineRelease,
) -> Result<PathBuf, String> {
    let client = http_client()?;
    let bytes = client
        .get(&rel.asset_url)
        .send()
        .await
        .map_err(|e| format!("engine download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("engine download HTTP error: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("engine download read failed: {e}"))?;

    if !rel.sha256.is_empty() {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let got: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if got != rel.sha256 {
            return Err(format!(
                "checksum mismatch: expected {}, got {got}",
                rel.sha256
            ));
        }
    }

    let dest = override_engine_path(app).ok_or("cannot resolve override path")?;
    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write temp engine failed: {e}"))?;

    // Make it executable on Unix before swapping it in.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp)
            .map_err(|e| format!("stat temp engine failed: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp, perms)
            .map_err(|e| format!("chmod temp engine failed: {e}"))?;
    }

    // Atomic-ish swap: on Windows rename fails if the destination exists, so
    // remove it first (the running engine is the bundled one or a prior override
    // that's already been killed by the caller before download).
    if dest.exists() {
        std::fs::remove_file(&dest).map_err(|e| format!("remove old override failed: {e}"))?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| format!("install engine update failed: {e}"))?;
    Ok(dest)
}

/// Removes the override so the next spawn falls back to the bundled engine.
pub fn clear_override(app: &AppHandle) -> Result<(), String> {
    if let Some(path) = override_engine_path(app) {
        if path.is_file() {
            std::fs::remove_file(&path).map_err(|e| format!("clear override failed: {e}"))?;
        }
    }
    Ok(())
}

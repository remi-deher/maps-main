use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

pub(crate) const DEFAULT_PORT: u16 = 8080;
const CONFIG_FILE: &str = "engine-config.json";

#[derive(Serialize, Deserialize)]
pub(crate) struct EngineConfig {
    pub(crate) port: u16,
    #[serde(default)]
    pub(crate) mdns_interface: Option<String>,
}

fn config_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join(CONFIG_FILE)
}

pub(crate) fn read_config(app: &AppHandle) -> EngineConfig {
    let path = config_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<EngineConfig>(&raw).ok())
        .unwrap_or(EngineConfig {
            port: DEFAULT_PORT,
            mdns_interface: None,
        })
}

pub(crate) fn write_config(app: &AppHandle, cfg: &EngineConfig) {
    let path = config_path(app);
    if let Ok(raw) = serde_json::to_string(cfg) {
        fs::write(path, raw).ok();
    }
}

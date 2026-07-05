use tauri::AppHandle;

use crate::config::{read_config, write_config};
use crate::device_records;
use crate::engine_process::{reset_restart_attempts, spawn_engine};
use crate::network::{self, NetworkInterfaceInfo};

#[tauri::command]
pub(crate) fn get_engine_port(app: AppHandle) -> u16 {
    read_config(&app).port
}

#[tauri::command]
pub(crate) fn set_engine_port(app: AppHandle, port: u16) -> Result<(), String> {
    if port < 1024 {
        return Err("Port must be at least 1024".to_string());
    }
    let mut cfg = read_config(&app);
    cfg.port = port;
    let mdns_interface = cfg.mdns_interface.clone();
    write_config(&app, &cfg);
    spawn_engine(&app, port, mdns_interface.as_deref())
}

#[tauri::command]
pub(crate) fn get_mdns_interface(app: AppHandle) -> Option<String> {
    read_config(&app).mdns_interface
}

#[tauri::command]
pub(crate) fn set_mdns_interface(app: AppHandle, interface: Option<String>) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg.mdns_interface = interface.filter(|s| !s.is_empty());
    let port = cfg.port;
    let mdns_interface = cfg.mdns_interface.clone();
    write_config(&app, &cfg);
    spawn_engine(&app, port, mdns_interface.as_deref())
}

// Manual engine (re)start, e.g. from the "Redémarrer le moteur" button shown
// when the supervisor has given up auto-restarting a repeatedly crashing engine.
#[tauri::command]
pub(crate) fn restart_engine(app: AppHandle) -> Result<(), String> {
    reset_restart_attempts(&app);
    let cfg = read_config(&app);
    spawn_engine(&app, cfg.port, cfg.mdns_interface.as_deref())
}

#[tauri::command]
pub(crate) fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    network::list_network_interfaces()
}

#[tauri::command]
pub(crate) fn read_device_plist(udid: String) -> Result<String, String> {
    device_records::read_device_plist(udid)
}

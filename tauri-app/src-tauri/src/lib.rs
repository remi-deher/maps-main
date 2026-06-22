use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEFAULT_PORT: u16 = 8080;
const CONFIG_FILE: &str = "engine-config.json";

#[derive(Default)]
struct EngineState {
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize, Deserialize)]
struct EngineConfig {
    port: u16,
    /// Network interface name (e.g. "Wi-Fi", "Ethernet", "en0") to restrict
    /// the engine's mDNS advertisement to — None/empty means "every
    /// interface", the previous default behavior. Only affects which
    /// address gets *announced* to LAN clients (the iOS app's Bonjour
    /// discovery); the HTTP/WebSocket listener itself always binds to every
    /// interface, so this can't break the desktop app's own connection.
    #[serde(default)]
    mdns_interface: Option<String>,
}

#[derive(Serialize)]
struct NetworkInterfaceInfo {
    name: String,
    ip: String,
}

fn config_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join(CONFIG_FILE)
}

fn read_config(app: &AppHandle) -> EngineConfig {
    let path = config_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<EngineConfig>(&raw).ok())
        .unwrap_or(EngineConfig {
            port: DEFAULT_PORT,
            mdns_interface: None,
        })
}

fn write_config(app: &AppHandle, cfg: &EngineConfig) {
    let path = config_path(app);
    if let Ok(raw) = serde_json::to_string(cfg) {
        fs::write(path, raw).ok();
    }
}

/// Spawns the Go engine sidecar bound to `port`, replacing any previously
/// running instance, and forwards its stdout/stderr/exit as `engine-log` /
/// `engine-status` events so the frontend can tell "starting" apart from
/// "crashed" instead of just retrying the WebSocket forever.
fn spawn_engine(app: &AppHandle, port: u16, mdns_interface: Option<&str>) -> Result<(), String> {
    let state = app.state::<EngineState>();
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }

    let shell = app.shell();
    let mut args = vec!["-addr".to_string(), format!(":{port}")];
    if let Some(iface) = mdns_interface {
        if !iface.is_empty() {
            args.push("-mdns-interface".to_string());
            args.push(iface.to_string());
        }
    }
    let mut sidecar = shell
        .sidecar("gpsmock-engine")
        .map_err(|err| format!("sidecar config not found: {err}"))?
        .args(args);

    // Point the engine at the iOS-driver binaries bundled as app resources, so
    // go-ios / pymobiledevice work with no system install or PATH setup.
    for (key, value) in bundled_driver_envs(app) {
        sidecar = sidecar.env(key, value);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("failed to spawn Go sidecar: {err}"))?;

    *state.child.lock().unwrap() = Some(child);
    let _ = app.emit("engine-status", "starting");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_handle.emit("engine-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ = app_handle.emit("engine-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle.emit("engine-status", format!("error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    *app_handle.state::<EngineState>().child.lock().unwrap() = None;
                    let _ = app_handle.emit(
                        "engine-status",
                        format!("exited:{}", payload.code.unwrap_or(-1)),
                    );
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Resolves the iOS-driver binaries bundled as Tauri resources and returns the
/// env vars pointing the engine sidecar at them. Only sets a var when the file
/// is actually present, so a missing bundle falls back to the engine's own
/// PATH / next-to-executable resolution rather than pointing at nothing.
fn bundled_driver_envs(app: &AppHandle) -> Vec<(String, String)> {
    let mut envs = Vec::new();
    let Ok(res) = app.path().resource_dir() else {
        return envs;
    };
    let base = res.join("resources");

    let goios = base.join(if cfg!(windows) { "ios.exe" } else { "ios" });
    if goios.is_file() {
        envs.push((
            "GPSMOCK_GOIOS_BIN".to_string(),
            goios.to_string_lossy().into_owned(),
        ));
    }

    let python = if cfg!(windows) {
        base.join("python-embed").join("python.exe")
    } else {
        base.join("python-embed").join("bin").join("python3")
    };
    if python.is_file() {
        envs.push((
            "GPSMOCK_PYTHON_BIN".to_string(),
            python.to_string_lossy().into_owned(),
        ));
    }

    envs
}

#[tauri::command]
fn get_engine_port(app: AppHandle) -> u16 {
    read_config(&app).port
}

#[tauri::command]
fn set_engine_port(app: AppHandle, port: u16) -> Result<(), String> {
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
fn get_mdns_interface(app: AppHandle) -> Option<String> {
    read_config(&app).mdns_interface
}

#[tauri::command]
fn set_mdns_interface(app: AppHandle, interface: Option<String>) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg.mdns_interface = interface.filter(|s| !s.is_empty());
    let port = cfg.port;
    let mdns_interface = cfg.mdns_interface.clone();
    write_config(&app, &cfg);
    spawn_engine(&app, port, mdns_interface.as_deref())
}

/// Lists local, non-loopback IPv4 network interfaces so the settings UI can
/// offer a picker instead of asking the user to know their interface name —
/// e.g. distinguishing "Wi-Fi (192.168.1.42)" from "Ethernet (10.0.0.5)" on a
/// machine with both, which matters for which one the iOS app can reach.
#[tauri::command]
fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|iface| !iface.is_loopback() && iface.ip().is_ipv4())
        .map(|iface| NetworkInterfaceInfo {
            name: iface.name.clone(),
            ip: iface.ip().to_string(),
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                let cfg = read_config(&handle);
                if let Err(err) = spawn_engine(&handle, cfg.port, cfg.mdns_interface.as_deref()) {
                    eprintln!("{err}");
                    let _ = handle.emit("engine-status", format!("error: {err}"));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<EngineState>();
                let child = state.child.lock().unwrap().take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_port,
            set_engine_port,
            get_mdns_interface,
            set_mdns_interface,
            list_network_interfaces
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

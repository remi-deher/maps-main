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
}

fn config_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join(CONFIG_FILE)
}

fn read_port(app: &AppHandle) -> u16 {
    let path = config_path(app);
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<EngineConfig>(&raw).ok())
        .map(|cfg| cfg.port)
        .unwrap_or(DEFAULT_PORT)
}

fn write_port(app: &AppHandle, port: u16) {
    let path = config_path(app);
    if let Ok(raw) = serde_json::to_string(&EngineConfig { port }) {
        fs::write(path, raw).ok();
    }
}

/// Spawns the Go engine sidecar bound to `port`, replacing any previously
/// running instance, and forwards its stdout/stderr/exit as `engine-log` /
/// `engine-status` events so the frontend can tell "starting" apart from
/// "crashed" instead of just retrying the WebSocket forever.
fn spawn_engine(app: &AppHandle, port: u16) -> Result<(), String> {
    let state = app.state::<EngineState>();
    {
        let mut guard = state.child.lock().unwrap();
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }

    let shell = app.shell();
    let sidecar = shell
        .sidecar("gpsmock-engine")
        .map_err(|err| format!("sidecar config not found: {err}"))?
        .args(["-addr", &format!(":{port}")]);

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

#[tauri::command]
fn get_engine_port(app: AppHandle) -> u16 {
    read_port(&app)
}

#[tauri::command]
fn set_engine_port(app: AppHandle, port: u16) -> Result<(), String> {
    if port < 1024 {
        return Err("Port must be at least 1024".to_string());
    }
    write_port(&app, port);
    spawn_engine(&app, port)
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
                let port = read_port(&handle);
                if let Err(err) = spawn_engine(&handle, port) {
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
        .invoke_handler(tauri::generate_handler![get_engine_port, set_engine_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

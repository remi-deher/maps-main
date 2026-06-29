use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PID_FILE: &str = "engine.pid";

#[derive(Default)]
pub(crate) struct EngineState {
    child: Mutex<Option<CommandChild>>,
}

fn pid_file_path(app: &AppHandle) -> std::path::PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("could not resolve app config dir");
    fs::create_dir_all(&dir).ok();
    dir.join(PID_FILE)
}

fn write_pid_file(app: &AppHandle, pid: u32) {
    fs::write(pid_file_path(app), pid.to_string()).ok();
}

fn clear_pid_file(app: &AppHandle) {
    fs::remove_file(pid_file_path(app)).ok();
}

#[cfg(target_os = "windows")]
fn process_image_name(pid: u32) -> Option<String> {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let name = stdout.split(',').next()?.trim_matches('"').to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

#[cfg(not(target_os = "windows"))]
fn process_image_name(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn kill_pid_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
    }
}

pub(crate) fn cleanup_stray_engine(app: &AppHandle) {
    let path = pid_file_path(app);
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(pid) = raw.trim().parse::<u32>() {
            let is_our_engine = process_image_name(pid)
                .map(|name| name.to_lowercase().contains("gpsmock-engine"))
                .unwrap_or(false);
            if is_our_engine {
                kill_pid_tree(pid);
            }
        }
    }
    let _ = fs::remove_file(path);
}

fn kill_engine_tree(child: CommandChild) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.pid();
        let _ = child.kill();
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = child.kill();
        for name in &["ios", "python3", "python"] {
            let _ = std::process::Command::new("pkill")
                .args(["-9", "-f", &format!("gpsmock.*{name}")])
                .output();
        }
    }
}

pub(crate) fn spawn_engine(
    app: &AppHandle,
    port: u16,
    mdns_interface: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<EngineState>();
    {
        let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(child) = guard.take() {
            kill_engine_tree(child);
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

    for (key, value) in bundled_driver_envs(app) {
        sidecar = sidecar.env(key, value);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("failed to spawn Go sidecar: {err}"))?;

    let pid = child.pid();
    write_pid_file(app, pid);
    *state.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    let _ = app.emit("engine-status", "starting");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ =
                        app_handle.emit("engine-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Stderr(line) => {
                    let _ =
                        app_handle.emit("engine-log", String::from_utf8_lossy(&line).to_string());
                }
                CommandEvent::Error(err) => {
                    let _ = app_handle.emit("engine-status", format!("error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    let state = app_handle.state::<EngineState>();
                    let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
                    let still_current = guard.as_ref().map(|p| p.pid()) == Some(pid);
                    if still_current {
                        *guard = None;
                        drop(guard);
                        clear_pid_file(&app_handle);
                        let _ = app_handle.emit(
                            "engine-status",
                            format!("exited:{}", payload.code.unwrap_or(-1)),
                        );
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

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

pub(crate) fn shutdown_engine(app: &AppHandle) {
    let state = app.state::<EngineState>();
    let child = state.child.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(child) = child {
        kill_engine_tree(child);
    }
    clear_pid_file(app);
}

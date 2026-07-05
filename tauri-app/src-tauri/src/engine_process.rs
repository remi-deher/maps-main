use std::fs;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PID_FILE: &str = "engine.pid";

// Auto-restart policy for an engine that dies unexpectedly (crash, OOM kill),
// so a long-running session survives a sidecar failure without the user having
// to relaunch the app. Attempts are capped to avoid a hot crash loop; the
// counter resets once an instance has run longer than RESTART_STABLE_AFTER.
const MAX_RESTART_ATTEMPTS: u32 = 5;
const RESTART_STABLE_AFTER: Duration = Duration::from_secs(600);
const MAX_RESTART_BACKOFF_SECS: u64 = 30;

#[derive(Default)]
struct RestartState {
    attempts: u32,
    last_spawn: Option<Instant>,
}

#[derive(Default)]
pub(crate) struct EngineState {
    child: Mutex<Option<CommandChild>>,
    restart: Mutex<RestartState>,
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
    state
        .restart
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .last_spawn = Some(Instant::now());
    let _ = app.emit("engine-status", "starting");

    // Captured for an automatic respawn if this instance dies unexpectedly.
    let restart_port = port;
    let restart_mdns = mdns_interface.map(|s| s.to_string());

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
                    if !still_current {
                        // A newer spawn already superseded this instance (user
                        // changed port/interface): nothing to clean up or restart.
                        break;
                    }
                    *guard = None;
                    drop(guard);
                    clear_pid_file(&app_handle);

                    let code = payload.code.unwrap_or(-1);

                    // Decide whether to auto-restart. Reset the attempt counter
                    // when the instance had been running comfortably, so an
                    // occasional crash after hours doesn't count toward the
                    // hot-loop cap.
                    let attempt = {
                        let mut r = state.restart.lock().unwrap_or_else(|e| e.into_inner());
                        let ran_long = r
                            .last_spawn
                            .map(|t| t.elapsed() >= RESTART_STABLE_AFTER)
                            .unwrap_or(false);
                        if ran_long {
                            r.attempts = 0;
                        }
                        r.attempts += 1;
                        r.attempts
                    };

                    if attempt > MAX_RESTART_ATTEMPTS {
                        // Give up: repeated rapid crashes, surface it to the UI.
                        let _ = app_handle.emit("engine-status", format!("exited:{code}"));
                        break;
                    }

                    let backoff = (1u64 << (attempt - 1)).min(MAX_RESTART_BACKOFF_SECS);
                    let _ = app_handle.emit(
                        "engine-status",
                        format!("restarting:{attempt}:{MAX_RESTART_ATTEMPTS}"),
                    );

                    // Wait out the backoff on a detached thread (no tokio timer
                    // dependency), then respawn — unless something else already
                    // brought the engine back in the meantime.
                    let restart_handle = app_handle.clone();
                    let restart_mdns = restart_mdns.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_secs(backoff));
                        let occupied = restart_handle
                            .state::<EngineState>()
                            .child
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .is_some();
                        if !occupied {
                            if let Err(err) = spawn_engine(
                                &restart_handle,
                                restart_port,
                                restart_mdns.as_deref(),
                            ) {
                                let _ = restart_handle
                                    .emit("engine-status", format!("error: {err}"));
                            }
                        }
                    });
                    break;
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

// Clears the auto-restart attempt counter — called when the user explicitly
// (re)starts the engine, so a manual restart after the auto-restart gave up
// re-arms the supervisor from scratch.
pub(crate) fn reset_restart_attempts(app: &AppHandle) {
    let state = app.state::<EngineState>();
    state
        .restart
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .attempts = 0;
}

pub(crate) fn shutdown_engine(app: &AppHandle) {
    let state = app.state::<EngineState>();
    let child = state.child.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(child) = child {
        kill_engine_tree(child);
    }
    clear_pid_file(app);
}

mod updater;

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEFAULT_PORT: u16 = 8080;
const CONFIG_FILE: &str = "engine-config.json";
const PID_FILE: &str = "engine.pid";

/// A running engine process. Either the bundled sidecar (managed by the shell
/// plugin) or an updated engine launched from the writable override directory
/// via std::process (we only need its PID — killing goes through the process
/// tree by PID, same as the sidecar path).
enum EngineProcess {
    Sidecar(CommandChild),
    Plain(u32),
}

impl EngineProcess {
    fn pid(&self) -> u32 {
        match self {
            EngineProcess::Sidecar(child) => child.pid(),
            EngineProcess::Plain(pid) => *pid,
        }
    }
}

#[derive(Default)]
struct EngineState {
    child: Mutex<Option<EngineProcess>>,
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

/// Best-effort lookup of a running process's image name, used to confirm a PID
/// read from our own PID file is still actually a `gpsmock-engine` process
/// before killing it — guards against the file going stale (PID reused by an
/// unrelated process) or two app instances overwriting each other's PID file,
/// where blindly trusting "a PID that exists" could kill the wrong process or
/// another instance's still-legitimate engine.
#[cfg(target_os = "windows")]
fn process_image_name(pid: u32) -> Option<String> {
    let output = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let name = stdout.split(',').next()?.trim_matches('"').to_string();
    if name.is_empty() { None } else { Some(name) }
}

#[cfg(not(target_os = "windows"))]
fn process_image_name(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

/// Kills the whole process tree rooted at `pid` (best-effort, ignores errors —
/// the PID may already be gone, which is the common/expected case).
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

/// Recovers from a previous crash / force-kill (e.g. Task Manager "End task" on
/// the app, which skips CloseRequested/Destroyed and so never runs
/// `shutdown_engine`). On a clean exit the PID file is removed, so finding one
/// here means a sidecar — and its go-ios/python children — may still be
/// running from a prior session. Best-effort: a missing or already-dead PID is
/// a silent no-op.
fn cleanup_stray_engine(app: &AppHandle) {
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

/// Kills the engine sidecar and all its child processes (go-ios, python workers).
///
/// On Windows we use `taskkill /F /T /PID` which recursively kills the whole
/// process tree rooted at the sidecar. On Unix we send SIGKILL to the process
/// group, which covers both the sidecar and every subprocess it spawned.
fn kill_engine_tree(child: CommandChild) {
    #[cfg(target_os = "windows")]
    {
        // Get the PID before killing so we can run taskkill on the whole tree.
        // CommandChild::pid() is available in tauri-plugin-shell ≥ 2.x.
        let pid = child.pid();
        // First try the normal kill (closes stdio, signals the process).
        let _ = child.kill();
        // Then nuke the entire subtree: go-ios tunnel daemon, python workers, etc.
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = child.kill();
        // On Linux/macOS the Go sidecar spawns children in its own process
        // group by default. Send SIGKILL to the whole group via `kill -9 -<pgid>`.
        // We do a best-effort kill of known process names as a fallback since
        // we don't have direct access to the process group ID from Rust here.
        for name in &["ios", "python3", "python"] {
            let _ = std::process::Command::new("pkill")
                .args(["-9", "-f", &format!("gpsmock.*{name}")])
                .output();
        }
    }
}

/// Kills an engine process regardless of how it was launched. The sidecar path
/// closes stdio first; the override path kills purely by PID tree.
fn kill_engine_process(proc: EngineProcess) {
    match proc {
        EngineProcess::Sidecar(child) => kill_engine_tree(child),
        EngineProcess::Plain(pid) => kill_pid_tree(pid),
    }
}

/// Spawns the Go engine sidecar bound to `port`, replacing any previously
/// running instance, and forwards its stdout/stderr/exit as `engine-log` /
/// `engine-status` events so the frontend can tell "starting" apart from
/// "crashed" instead of just retrying the WebSocket forever.
fn engine_args(port: u16, mdns_interface: Option<&str>) -> Vec<String> {
    let mut args = vec!["-addr".to_string(), format!(":{port}")];
    if let Some(iface) = mdns_interface {
        if !iface.is_empty() {
            args.push("-mdns-interface".to_string());
            args.push(iface.to_string());
        }
    }
    args
}

fn spawn_engine(app: &AppHandle, port: u16, mdns_interface: Option<&str>) -> Result<(), String> {
    let state = app.state::<EngineState>();
    {
        let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(proc) = guard.take() {
            kill_engine_process(proc);
        }
    }

    // Prefer an updated engine from the writable override dir over the bundled
    // sidecar (the component self-update path — see updater.rs).
    if let Some(path) = updater::active_override_engine(app) {
        return spawn_plain_engine(app, &path, port, mdns_interface);
    }

    let shell = app.shell();
    let mut sidecar = shell
        .sidecar("gpsmock-engine")
        .map_err(|err| format!("sidecar config not found: {err}"))?
        .args(engine_args(port, mdns_interface));

    // Point the engine at the iOS-driver binaries bundled as app resources, so
    // go-ios / pymobiledevice work with no system install or PATH setup.
    for (key, value) in bundled_driver_envs(app) {
        sidecar = sidecar.env(key, value);
    }

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|err| format!("failed to spawn Go sidecar: {err}"))?;

    write_pid_file(app, child.pid());
    *state.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(EngineProcess::Sidecar(child));
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
                    clear_pid_file(&app_handle);
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

/// Spawns an updated engine binary from an arbitrary (writable) path using
/// std::process, mirroring the sidecar path's event forwarding so the frontend
/// sees the same "starting"/"engine-log"/"exited:" signals. Used for the
/// component self-update override, where the shell plugin's sidecar resolution
/// (target-triple suffix, resource scope) doesn't apply.
fn spawn_plain_engine(
    app: &AppHandle,
    path: &std::path::Path,
    port: u16,
    mdns_interface: Option<&str>,
) -> Result<(), String> {
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(path);
    cmd.args(engine_args(port, mdns_interface))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in bundled_driver_envs(app) {
        cmd.env(key, value);
    }
    // Own process group on Unix so kill_pid_tree's `kill -<pgid>` reaches the
    // go-ios/python children too.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("failed to spawn updated engine: {err}"))?;
    let pid = child.id();

    // Forward stdout/stderr line-by-line as engine-log, like the sidecar path.
    for (stream, app_h) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), app.clone()),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), app.clone()),
    ] {
        if let Some(stream) = stream {
            std::thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app_h.emit("engine-log", line);
                }
            });
        }
    }

    write_pid_file(app, pid);
    *app.state::<EngineState>()
        .child
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(EngineProcess::Plain(pid));
    let _ = app.emit("engine-status", "starting");

    // Reap the process and report its exit, clearing state only if it's still
    // the current one (a respawn may have replaced it in the meantime).
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        let state = app_handle.state::<EngineState>();
        let mut guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
        let still_current = guard.as_ref().map(|p| p.pid()) == Some(pid);
        if still_current {
            *guard = None;
            drop(guard);
            clear_pid_file(&app_handle);
            let _ = app_handle.emit("engine-status", format!("exited:{code}"));
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

/// Kills the engine sidecar (and its full process tree) from an AppHandle.
/// Safe to call from multiple event handlers; a missing child is a no-op.
fn shutdown_engine(app: &AppHandle) {
    let state = app.state::<EngineState>();
    let child = state.child.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(proc) = child {
        kill_engine_process(proc);
    }
    clear_pid_file(app);
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

#[tauri::command]
fn read_device_plist(udid: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;
    use base64::Engine;

    let mut path = PathBuf::new();
    if cfg!(target_os = "windows") {
        let program_data = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
        path.push(program_data);
        path.push("Apple");
        path.push("Lockdown");
    } else if cfg!(target_os = "macos") {
        path.push("/var/db/lockdown");
    } else {
        path.push("/var/lib/lockdown");
    }

    path.push(format!("{}.plist", udid));

    if !path.exists() {
        return Err(format!("Fichier de pairage introuvable pour l'UDID : {}", udid));
    }

    let content = fs::read(&path)
        .map_err(|e| format!("Impossible de lire le fichier de pairage : {}", e))?;

    let base64_content = base64::engine::general_purpose::STANDARD.encode(&content);
    Ok(base64_content)
}

/// Checks GitHub for the latest engine release matching this platform. The
/// frontend compares the returned tag against the engine's running version
/// (already broadcast in STATUS) to decide whether to offer an update.
#[tauri::command]
async fn engine_check_update() -> Result<updater::EngineRelease, String> {
    updater::fetch_latest_release().await
}

/// Downloads + verifies the latest engine binary into the override dir and
/// restarts the sidecar so it takes effect immediately.
#[tauri::command]
async fn engine_apply_update(app: AppHandle) -> Result<String, String> {
    let rel = updater::fetch_latest_release().await?;
    updater::download_engine_update(&app, &rel).await?;
    let cfg = read_config(&app);
    spawn_engine(&app, cfg.port, cfg.mdns_interface.as_deref())?;
    Ok(rel.tag)
}

/// Reverts to the bundled engine by removing the override, then restarts.
#[tauri::command]
fn engine_clear_update(app: AppHandle) -> Result<(), String> {
    updater::clear_override(&app)?;
    let cfg = read_config(&app);
    spawn_engine(&app, cfg.port, cfg.mdns_interface.as_deref())
}

/// True when the running engine is an updated override rather than the bundled
/// sidecar — lets the UI show a "reverter" affordance.
#[tauri::command]
fn engine_using_override(app: AppHandle) -> bool {
    updater::active_override_engine(&app).is_some()
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
                // Recover from a previous crash/force-kill: if a PID file from
                // an earlier session is still present, that sidecar (and its
                // go-ios/python children) may still be running orphaned.
                cleanup_stray_engine(&handle);
                let cfg = read_config(&handle);
                if let Err(err) = spawn_engine(&handle, cfg.port, cfg.mdns_interface.as_deref()) {
                    eprintln!("{err}");
                    let _ = handle.emit("engine-status", format!("error: {err}"));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // CloseRequested fires when the user clicks ✕ or presses Alt+F4.
                tauri::WindowEvent::CloseRequested { .. } => {
                    shutdown_engine(window.app_handle());
                }
                // Destroyed fires after the window is actually gone — catches
                // force-quit paths (e.g. killed from the taskbar) that may skip
                // CloseRequested on some platforms.
                tauri::WindowEvent::Destroyed => {
                    shutdown_engine(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_port,
            set_engine_port,
            get_mdns_interface,
            set_mdns_interface,
            list_network_interfaces,
            read_device_plist,
            engine_check_update,
            engine_apply_update,
            engine_clear_update,
            engine_using_override
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

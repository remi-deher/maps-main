mod commands;
mod config;
mod device_records;
mod engine_process;
mod network;

use commands::{
    get_engine_port, get_mdns_interface, list_network_interfaces, read_device_plist,
    set_engine_port, set_mdns_interface,
};
use config::read_config;
use engine_process::{cleanup_stray_engine, shutdown_engine, spawn_engine, EngineState};
use tauri::{Emitter, Manager};

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
                cleanup_stray_engine(&handle);
                let cfg = read_config(&handle);
                if let Err(err) = spawn_engine(&handle, cfg.port, cfg.mdns_interface.as_deref()) {
                    eprintln!("{err}");
                    let _ = handle.emit("engine-status", format!("error: {err}"));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                shutdown_engine(window.app_handle());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_port,
            set_engine_port,
            get_mdns_interface,
            set_mdns_interface,
            list_network_interfaces,
            read_device_plist
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

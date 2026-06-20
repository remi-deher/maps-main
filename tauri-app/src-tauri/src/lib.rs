use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the Go engine sidecar process on startup
            #[cfg(desktop)]
            {
                let shell = app.shell();
                match shell.sidecar("gpsmock-engine") {
                    Ok(sidecar) => {
                        match sidecar.spawn() {
                            Ok((_rx, _tx)) => {
                                println!("Successfully spawned gpsmock-engine Go sidecar");
                            }
                            Err(err) => {
                                eprintln!("Failed to spawn Go sidecar process: {}", err);
                            }
                        }
                    }
                    Err(err) => {
                        eprintln!("Failed to find Go sidecar configuration: {}", err);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use base64::Engine;
use std::path::PathBuf;

pub(crate) fn read_device_plist(udid: String) -> Result<String, String> {
    let mut path = PathBuf::new();
    if cfg!(target_os = "windows") {
        let program_data =
            std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string());
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
        return Err(format!(
            "Fichier de pairage introuvable pour l'UDID : {}",
            udid
        ));
    }

    let content = std::fs::read(&path)
        .map_err(|err| format!("Impossible de lire le fichier de pairage : {}", err))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&content))
}

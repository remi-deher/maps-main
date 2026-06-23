fn main() {
    // On Windows, embed the custom application manifest that requests
    // administrator privileges (requireAdministrator). This triggers a UAC
    // prompt once at launch so the Go sidecar can create the IPv6 tunnel
    // required for iOS location injection.
    //
    // On all other platforms tauri_build::build() is called directly.
    #[cfg(target_os = "windows")]
    {
        let manifest = include_str!("windows/app.manifest");
        let windows_attributes =
            tauri_build::WindowsAttributes::new().app_manifest(manifest);
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(windows_attributes),
        )
        .expect("failed to run tauri-build");
    }

    #[cfg(not(target_os = "windows"))]
    tauri_build::build();
}

use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct NetworkInterfaceInfo {
    name: String,
    ip: String,
}

pub(crate) fn list_network_interfaces() -> Vec<NetworkInterfaceInfo> {
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

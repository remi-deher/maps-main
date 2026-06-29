import { invoke } from "@tauri-apps/api/core";

interface EnrollmentPayload {
  udid: string;
  deviceRecord: string;
}

export function normalizeEnrollmentServerUrl(targetServer: string): string {
  let baseUrl = targetServer.trim();
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `http://${baseUrl}`;
  }
  if (!baseUrl.includes(":", baseUrl.indexOf("//") + 2)) {
    baseUrl = `${baseUrl}:8080`;
  }
  return baseUrl.replace(/\/+$/, "");
}

async function postEnrollment(url: string, payload: EnrollmentPayload): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Erreur HTTP: ${response.status}`);
  }
}

export async function transferDeviceEnrollment(udid: string, targetServer: string): Promise<void> {
  const deviceRecord = await invoke<string>("read_device_plist", { udid });
  const payload = { udid, deviceRecord };
  const baseUrl = normalizeEnrollmentServerUrl(targetServer);

  try {
    await postEnrollment(`${baseUrl}/api/device/enroll`, payload);
  } catch {
    await postEnrollment(`${baseUrl}/api/enroll`, payload);
  }
}

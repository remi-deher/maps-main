import asyncio
import sys
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService

async def test_rsd(host, port):
    try:
        print(f"Tentative de connexion RSD sur {host}:{port}...")
        rsd = RemoteServiceDiscoveryService((host, int(port)))
        await rsd.connect()
        print(f"SUCCÈS ! Device UDID: {rsd.udid}")
        print(f"ProductVersion: {rsd.product_version}")
    except Exception as e:
        print(f"ÉCHEC: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python script.py <host> <port>")
    else:
        asyncio.run(test_rsd(sys.argv[1], sys.argv[2]))

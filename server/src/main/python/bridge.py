import asyncio
import json
import sys
import logging
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

# Configuration logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bridge')

class PymobiledeviceBridge:
    def __init__(self):
        self.providers = {}  # Cache: (host, port) -> DvtProvider

    async def get_dvt_provider(self, host, port):
        key = (host, port)
        if key in self.providers:
            provider = self.providers[key]
            if provider.dtx and not provider.dtx.transport.writer.is_closing():
                return provider
            else:
                logger.info(f"Connexion DTX perdue pour {host}:{port}, nettoyage...")
                await provider.close()
                del self.providers[key]

        logger.info(f"Nouvelle connexion RSD/DVT vers {host}:{port}")
        rsd = RemoteServiceDiscoveryService(host, port)
        await rsd.connect()
        
        provider = DvtProvider(rsd)
        await provider.connect()
        self.providers[key] = provider
        return provider

    async def handle_command(self, reader, writer):
        data = await reader.read(4096)
        if not data:
            return

        try:
            request = json.loads(data.decode())
            action = request.get('action')
            host = request.get('rsd_host')
            port = request.get('rsd_port')
            
            logger.info(f"Action recue: {action} pour {host}")

            if action == 'set_location':
                lat = float(request.get('lat'))
                lon = float(request.get('lon'))
                provider = await self.get_dvt_provider(host, port)
                async with LocationSimulation(provider) as sim:
                    await sim.set(lat, lon)
                response = {"success": True}
            
            elif action == 'clear_location':
                provider = await self.get_dvt_provider(host, port)
                async with LocationSimulation(provider) as sim:
                    await sim.clear()
                response = {"success": True}
                
            elif action == 'ping':
                response = {"success": True, "pong": True}
            
            else:
                response = {"success": False, "error": f"Action inconnue: {action}"}

        except Exception as e:
            logger.error(f"Erreur: {str(e)}")
            response = {"success": False, "error": str(e)}

        writer.write(json.dumps(response).encode())
        await writer.drain()
        writer.close()
        await writer.wait_closed()

async def main():
    bridge = PymobiledeviceBridge()
    # On ecoute sur ::1 (IPv6 Local)
    try:
        server = await asyncio.start_server(bridge.handle_command, '::1', 49000)
    except Exception as e:
        logger.error(f"Impossible de demarrer le serveur sur ::1: {e}")
        # Fallback sur 127.0.0.1 si IPv6 Loopback echoue sur cette machine
        server = await asyncio.start_server(bridge.handle_command, '127.0.0.1', 49000)
    
    addr = server.sockets[0].getsockname()
    print(f"BRIDGE_READY on {addr}")
    sys.stdout.flush()

    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

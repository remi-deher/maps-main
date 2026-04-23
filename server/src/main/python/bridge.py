import asyncio
import json
import sys
import logging
import socket
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

# Configuration logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bridge')

class PymobiledeviceBridge:
    def __init__(self):
        self.providers = {}  # Cache: (host, port) -> DvtProvider

    def _clean_host(self, host):
        """Retire les crochets si presents pour asyncio/socket"""
        if not host: return host
        return host.replace('[', '').replace(']', '')

    async def get_dvt_provider(self, host, port):
        host = self._clean_host(host)
        key = (host, port)
        
        if key in self.providers:
            provider = self.providers[key]
            try:
                if provider.dtx and not provider.dtx.transport.writer.is_closing():
                    return provider
            except Exception:
                pass
            
            logger.info(f"Connexion DTX perdue pour {host}:{port}, nettoyage...")
            await provider.close()
            del self.providers[key]

        logger.info(f"Tentative de connexion RSD/DVT vers {host}:{port}")
        
        # Tentative de resolution manuelle pour eviter [Errno 10109] sur Windows
        try:
            # Sur Windows, socket.getaddrinfo aide a valider l'adresse IPv6 avec Scope ID
            socket.getaddrinfo(host, port, socket.AF_INET6, socket.SOCK_STREAM)
            
            rsd = RemoteServiceDiscoveryService(host, port)
            await rsd.connect()
        except Exception as e:
            logger.error(f"Erreur lors de la connexion RSD: {e}")
            raise

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
            host = self._clean_host(request.get('rsd_host'))
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
                
            elif action == 'heartbeat':
                provider = await self.get_dvt_provider(host, port)
                response = {"success": True, "status": "alive"}

            elif action == 'ping':
                response = {"success": True, "pong": True}
            
            else:
                response = {"success": False, "error": f"Action inconnue: {action}"}

        except Exception as e:
            logger.error(f"Erreur Bridge: {str(e)}")
            response = {"success": False, "error": str(e)}

        writer.write(json.dumps(response).encode())
        await writer.drain()
        writer.close()
        await writer.wait_closed()

async def main():
    bridge = PymobiledeviceBridge()
    # On ecoute sur localhost (IPv6 de preference, fallback IPv4)
    try:
        server = await asyncio.start_server(bridge.handle_command, '::1', 49000)
    except Exception:
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

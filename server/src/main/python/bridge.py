import asyncio
import json
import sys
import logging
from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.dvt_secure_transport import DvtSecureTransport
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

# Configuration logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bridge')

class PymobiledeviceBridge:
    def __init__(self):
        self.connections = {}  # Cache: (host, port) -> LocationSimulation

    async def get_simulation_service(self, host, port):
        key = (host, port)
        if key in self.connections:
            try:
                # Test de connexion rapide
                return self.connections[key]
            except Exception:
                logger.info(f"Connexion perdue pour {host}:{port}, reconnexion...")
                del self.connections[key]

        logger.info(f"Nouvelle connexion RSD vers {host}:{port}")
        rsd = RemoteServiceDiscoveryService(host, port)
        await rsd.connect()
        
        # Pour iOS 17+, on utilise DVT via le tunnel QUIC géré par rsd
        dvt = DvtSecureTransport(rsd)
        await dvt.connect()
        
        sim = LocationSimulation(dvt)
        self.connections[key] = sim
        return sim

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
                lat = request.get('lat')
                lon = request.get('lon')
                sim = await self.get_simulation_service(host, port)
                sim.set_location(lat, lon)
                response = {"success": True}
            
            elif action == 'clear_location':
                sim = await self.get_simulation_service(host, port)
                sim.clear_location()
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
    # On ecoute sur ::1 (IPv6 Local) pour respecter le souhait "No IPv4"
    server = await asyncio.start_server(bridge.handle_command, '::1', 49000)
    
    addr = server.sockets[0].getsockname()
    print(f"BRIDGE_READY on {addr}")
    sys.stdout.flush()

    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    asyncio.run(main())

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
        """Retire les crochets si presents"""
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
        
        try:
            # RESOLUTION MANUELLE (CRITIQUE POUR WINDOWS)
            addr_info = socket.getaddrinfo(host, port, socket.AF_INET6, socket.SOCK_STREAM)
            # resolved_addr est un tuple (address, port, flowinfo, scope_id)
            resolved_addr = addr_info[0][4] 
            logger.info(f"Adresse resolue manuellement: {resolved_addr}")
            
            # On cree l'objet RSD
            rsd = RemoteServiceDiscoveryService(host, port)
            
            # TRICK: On injecte l'adresse resolue (tuple) directement dans le service sous-jacent
            # pour eviter que pymobiledevice3 ne tente une resolution de chaine de caractere qui echouerait sur Windows.
            # Le service de transport de rsd est generalement rsd.service (Remotexpc)
            rsd.service.host = resolved_addr[0]
            # Si le scope_id est present, on s'assure qu'il est utilise. 
            # asyncio.open_connection accepte l'adresse avec le %scope_id si c'est bien formate.
            # Mais passer le tuple complet au transport serait ideal si l'API le permettait.
            # Ici, on va essayer de reconstruire l'adresse la plus 'pure' possible.
            
            await rsd.connect()
        except Exception as e:
            logger.error(f"Echec connexion RSD: {e}")
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

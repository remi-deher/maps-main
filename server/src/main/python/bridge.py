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
            # 1. DETECTION DE LA FAMILLE (IPv4 ou IPv6)
            family = socket.AF_INET6 if ':' in host else socket.AF_INET
            
            # 2. RESOLUTION MANUELLE DU TUPLE
            addr_info = socket.getaddrinfo(host, port, family, socket.AF_INET6 if family == socket.AF_INET6 else socket.AF_INET)
            resolved_addr = addr_info[0][4] 
            logger.info(f"Adresse resolue ({'IPv6' if family == socket.AF_INET6 else 'IPv4'}): {resolved_addr}")
            
            # 3. CONNEXION MANUELLE VIA SOCKET
            loop = asyncio.get_running_loop()
            sock = socket.socket(family, socket.SOCK_STREAM)
            sock.setblocking(False)
            await loop.sock_connect(sock, resolved_addr)
            logger.info("Socket connectee.")

            # 4. CREATION DU SERVICE RSD ET MONKEYPATCHING
            rsd = RemoteServiceDiscoveryService(host, port)
            reader, writer = await asyncio.open_connection(sock=sock)
            
            # Injection manuelle dans RemoteXPCConnection
            rsd.service._reader = reader
            rsd.service._writer = writer
            
            # Handshake HTTP2
            await rsd.service._do_handshake()
            
            # Monkeypatch
            async def fake_connect():
                pass
            rsd.service.connect = fake_connect
            
            await rsd.connect()
            logger.info(f"Connexion RSD etablie sur {host}")
            
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

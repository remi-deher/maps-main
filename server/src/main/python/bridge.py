import asyncio
import json
import sys
import logging
import subprocess
import os

# Configuration logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bridge')

class PymobiledeviceBridge:
    def __init__(self):
        self.current_process = None
        self.current_params = None

    def _clean_host(self, host):
        if not host: return host
        return host.replace('[', '').replace(']', '')

    async def stop_current_sim(self):
        if self.current_process:
            logger.info("Arret de la simulation precedente...")
            try:
                # Sur Windows, on tue l'arbre de processus
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(self.current_process.pid)], 
                             capture_output=True, check=False)
            except Exception:
                self.current_process.kill()
            self.current_process = None

    async def set_location(self, host, port, lat, lon):
        host = self._clean_host(host)
        
        # Si c'est la même position, on ne fait rien
        new_params = (host, port, lat, lon)
        if self.current_params == new_params and self.current_process and self.current_process.poll() is None:
            return {"success": True, "info": "already_set"}

        await self.stop_current_sim()

        logger.info(f"Execution CLI: simulate-location set sur {host}:{port} ({lat}, {lon})")
        
        # Construction de la commande exacte qui a fonctionné pour l'utilisateur
        cmd = [
            sys.executable, "-m", "pymobiledevice3", 
            "developer", "dvt", "simulate-location", "set", 
            "--rsd", host, str(port), 
            str(lat), str(lon)
        ]

        try:
            # On lance le processus en arrière-plan
            # On utilise CREATE_NO_WINDOW pour éviter les flashs de console sur Windows
            self.current_process = subprocess.Popen(
                cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                stdin=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            self.current_params = new_params
            
            # On attend un tout petit peu pour vérifier s'il crashe immédiatement
            await asyncio.sleep(1)
            if self.current_process.poll() is not None:
                stderr = self.current_process.stderr.read().decode()
                logger.error(f"Le processus de simulation a quitte prematurement: {stderr}")
                return {"success": False, "error": stderr}
            
            return {"success": True}
        except Exception as e:
            logger.error(f"Erreur lors du lancement CLI: {e}")
            return {"success": False, "error": str(e)}

    async def handle_command(self, reader, writer):
        data = await reader.read(4096)
        if not data: return

        try:
            request = json.loads(data.decode())
            action = request.get('action')
            host = self._clean_host(request.get('rsd_host'))
            port = request.get('rsd_port')
            
            if action == 'set_location':
                lat, lon = float(request.get('lat')), float(request.get('lon'))
                response = await self.set_location(host, port, lat, lon)
            
            elif action == 'clear_location':
                await self.stop_current_sim()
                response = {"success": True}
                
            elif action == 'heartbeat':
                # Pour le heartbeat, on peut juste vérifier si le processus de sim tourne encore
                status = "alive" if self.current_process and self.current_process.poll() is None else "idle"
                response = {"success": True, "status": status}

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

import asyncio
import json
import sys
import logging
import os

# Configuration logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger('bridge')

class PymobiledeviceBridge:
    def __init__(self):
        self.current_process = None
        self.current_params = None
        self.output_task = None
        self.lock = asyncio.Lock()

    def _clean_host(self, host):
        if not host: return host
        return host.replace('[', '').replace(']', '')

    async def _log_output(self, prefix, stream):
        """Lit et logue la sortie du processus CLI en continu"""
        try:
            while True:
                line = await stream.readline()
                if not line: break
                msg = line.decode().strip()
                if msg:
                    # On ignore les erreurs de connexion reset qui polluent les logs lors du kill
                    if "10054" in msg or "ConnectionResetError" in msg:
                        continue
                    logger.info(f"[{prefix}] {msg}")
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def stop_current_sim(self):
        if self.output_task:
            self.output_task.cancel()
            try:
                await self.output_task
            except (asyncio.CancelledError, Exception):
                pass
            self.output_task = None

        if self.current_process:
            logger.info(f"Arret du processus de simulation (PID: {self.current_process.pid})...")
            try:
                # Sur Windows, taskkill est plus efficace
                kill_proc = await asyncio.create_subprocess_exec(
                    'taskkill', '/F', '/T', '/PID', str(self.current_process.pid),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
                await kill_proc.wait()
            except Exception:
                try: self.current_process.kill()
                except: pass
            
            self.current_process = None
            await asyncio.sleep(0.5)

    async def set_location(self, host, port, lat, lon):
        host = self._clean_host(host)
        new_params = (host, port, lat, lon)
        
        if self.current_params == new_params and self.current_process and self.current_process.returncode is None:
            logger.info("Position deja identique, on ignore.")
            return {"success": True}

        await self.stop_current_sim()

        logger.info(f"Relancement simulation: {lat}, {lon} sur {host}:{port}")
        
        cmd = [
            sys.executable, "-m", "pymobiledevice3", 
            "developer", "dvt", "simulate-location", "set", 
            "--rsd", host, str(port), 
            "--", # Indique la fin des options pour gérer les nombres négatifs
            str(lat), str(lon)
        ]

        try:
            self.current_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=0x08000000 if os.name == 'nt' else 0
            )
            
            # Lancer le logging en arrière-plan
            self.output_task = asyncio.gather(
                self._log_output("CLI-OUT", self.current_process.stdout),
                self._log_output("CLI-ERR", self.current_process.stderr)
            )

            # --- AMÉLIORATION : Attendre de voir si le CLI arrive à se connecter ---
            # On attend 3s. Si le process meurt durant ce laps de temps, c'est un échec de connexion.
            for _ in range(15): # 15 x 200ms = 3s
                await asyncio.sleep(0.2)
                if self.current_process.returncode is not None:
                    return {"success": False, "error": "L'iPhone a refuse la connexion (RSD/DVT error)"}

            self.current_params = new_params
            return {"success": True}
        except Exception as e:
            logger.error(f"Erreur lors du lancement CLI: {e}")
            return {"success": False, "error": str(e)}

    async def handle_command(self, reader, writer):
        async with self.lock:
            try:
                line = await reader.read(4096)
                if not line: return
                
                request = json.loads(line.decode())
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
                    status = "alive" if self.current_process and self.current_process.returncode is None else "idle"
                    response = {"success": True, "status": status}
                else:
                    response = {"success": False, "error": "Action inconnue"}

                writer.write(json.dumps(response).encode())
                await writer.drain()
            except Exception as e:
                logger.error(f"Erreur handler: {e}")
            finally:
                writer.close()
                await writer.wait_closed()

async def main():
    bridge = PymobiledeviceBridge()
    try:
        server = await asyncio.start_server(bridge.handle_command, '::1', 49000)
    except Exception:
        server = await asyncio.start_server(bridge.handle_command, '127.0.0.1', 49000)
    
    print(f"BRIDGE_READY on {server.sockets[0].getsockname()}")
    sys.stdout.flush()
    async with server:
        await server.serve_forever()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

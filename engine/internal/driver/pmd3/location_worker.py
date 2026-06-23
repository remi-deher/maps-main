import asyncio
import inspect
import json
import sys

from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

try:
    from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
    USE_LEGACY_DVT = True
except ImportError:
    from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider as DvtSecureSocketProxyService
    USE_LEGACY_DVT = False


async def maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def write(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def run_simulation(dvt):
    location = LocationSimulation(dvt)
    write({"ok": True, "ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
            action = request.get("action")
            if action == "set":
                await maybe_await(location.set(float(request["lat"]), float(request["lon"])))
                write({"ok": True})
            elif action == "clear":
                await maybe_await(location.clear())
                write({"ok": True})
            elif action == "stop":
                write({"ok": True})
                return
            else:
                write({"ok": False, "error": f"unknown action: {action}"})
        except Exception as exc:
            write({"ok": False, "error": str(exc)})


async def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: location_worker.py <rsd-address> <rsd-port>")

    address = sys.argv[1]
    port = int(sys.argv[2])

    # RemoteServiceDiscoveryService must be used as an async context manager in
    # recent pymobiledevice3 versions — calling connect() manually raises
    # "not connected — use `async with` or await connect()".
    async with RemoteServiceDiscoveryService((address, port)) as rsd:
        if USE_LEGACY_DVT:
            with DvtSecureSocketProxyService(rsd) as dvt:
                await run_simulation(dvt)
        else:
            async with DvtSecureSocketProxyService(rsd) as dvt:
                await run_simulation(dvt)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        write({"ok": False, "error": str(exc)})
        raise

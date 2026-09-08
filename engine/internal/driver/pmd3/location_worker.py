import argparse
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

# The no-root, in-process tunnel (pymobiledevice3 >= 9.x). Imported lazily-ish:
# an older bundle without it must still run in --rsd mode rather than fail at
# import time, so the Go side can fall back to the tunneld path.
try:
    from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel
    HAS_USERSPACE_TUNNEL = True
except ImportError:
    UserspaceRsdTunnel = None
    HAS_USERSPACE_TUNNEL = False


# Bounds a single DVT action. A dead tunnel (device asleep, blackholed
# route) can leave location.set() awaiting an ack forever; timing out turns
# that into a normal {"ok": false} error response, which makes the Go side
# discard this session and open a fresh one instead of blocking on it.
ACTION_TIMEOUT_SECONDS = 20


async def maybe_await(value):
    if inspect.isawaitable(value):
        return await asyncio.wait_for(value, ACTION_TIMEOUT_SECONDS)
    return value


def write(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def describe(exc):
    """Human-readable one-liner for an exception.

    Several pymobiledevice3 exceptions carry no message at all — the one that
    matters most here being NoDeviceConnectedError, whose str() is the empty
    string. Reporting {"ok": false, "error": ""} would give the engine, and
    therefore the user, nothing to act on, so fall back to the class name.
    """
    text = str(exc).strip()
    return text if text else type(exc).__name__


async def run_simulation(dvt, ready_extra=None):
    async with LocationSimulation(dvt) as location:
        write({"ok": True, "ready": True, **(ready_extra or {})})

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
                elif action == "ping":
                    # Liveness only: answering means the worker's event loop is
                    # running and its stdin/stdout protocol is in sync. In
                    # userspace mode this is what the driver's CheckHealth uses,
                    # since there is no socket to dial — the tunnel lives inside
                    # this process.
                    write({"ok": True})
                elif action == "stop":
                    write({"ok": True})
                    return
                else:
                    write({"ok": False, "error": f"unknown action: {action}"})
            except Exception as exc:
                write({"ok": False, "error": describe(exc)})


async def run_with_rsd(address, port):
    # RemoteServiceDiscoveryService must be used as an async context manager in
    # recent pymobiledevice3 versions — calling connect() manually raises
    # "not connected — use `async with` or await connect()".
    async with RemoteServiceDiscoveryService((address, port)) as rsd:
        await run_dvt(rsd)


async def run_with_userspace_tunnel(udid):
    # The no-root path: this process builds the RSD tunnel itself on a
    # pure-Python network stack, so no kernel TUN adapter (and therefore no
    # admin rights) is needed. PyTCP's stack is a process-global singleton, so
    # exactly one worker may hold a userspace tunnel at a time — the Go side
    # enforces that by keeping a single session.
    #
    # autopair lets the tunnel set up the pairing on the fly when the device
    # isn't paired yet, which removes one more manual step.
    if not HAS_USERSPACE_TUNNEL:
        raise SystemExit("pymobiledevice3 is too old: no UserspaceRsdTunnel (need >= 9.x)")
    async with UserspaceRsdTunnel(serial=udid or None, autopair=True) as rsd:
        await run_dvt(rsd, ready_extra={"userspace": True})


async def run_dvt(rsd, ready_extra=None):
    if USE_LEGACY_DVT:
        with DvtSecureSocketProxyService(rsd) as dvt:
            await run_simulation(dvt, ready_extra)
    else:
        async with DvtSecureSocketProxyService(rsd) as dvt:
            await run_simulation(dvt, ready_extra)


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="location_worker")
    parser.add_argument("--rsd", nargs=2, metavar=("ADDRESS", "PORT"),
                        help="connect to an existing RSD tunnel (tunneld)")
    parser.add_argument("--userspace", action="store_true",
                        help="build a no-root in-process RSD tunnel instead")
    parser.add_argument("--udid", default="", help="target device (userspace mode)")
    args = parser.parse_args(argv)
    if bool(args.rsd) == args.userspace:
        parser.error("exactly one of --rsd or --userspace is required")
    return args


async def main(argv):
    args = parse_args(argv)
    if args.userspace:
        await run_with_userspace_tunnel(args.udid)
    else:
        await run_with_rsd(args.rsd[0], int(args.rsd[1]))


if __name__ == "__main__":
    try:
        asyncio.run(main(sys.argv[1:]))
    except Exception as exc:
        write({"ok": False, "error": describe(exc)})
        raise

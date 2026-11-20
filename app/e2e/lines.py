"""The lines of the end-to-end stack: TCP forwarders, each one more path to the same nginx, whose
fault a journey sets while it runs.

    python lines.py --line 8081=nginx:80 --line 8082=nginx:80 --control 8090

Every --line PORT=HOST:PORT listens on PORT and forwards each connection to HOST:PORT. With
--control, an HTTP port answers GET /PORT/MODE by giving that line the fault MODE, for every
connection it carries and every new one, and GET /PORT with the line's mode:

    pass   bytes flow as they come
    dead   bytes are read and dropped in both directions and nothing is closed: a line that dies
           silently, which only the clients' own liveness rules can tell
    slow   every chunk waits 300 ms, and each direction carries at most 64 KiB/s

Without --control every line passes: in the machine's container, this is how localhost:80, :8081
and :8082 reach the stack under the same names a browser on the host uses.
"""

import argparse
import asyncio

DELAY_S = 0.3
RATE = 64 * 1024
CHUNK = 16 * 1024

modes: dict[int, str] = {}


async def pump(port: int, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while chunk := await reader.read(CHUNK):
            mode = modes[port]
            if mode == "dead":
                continue
            if mode == "slow":
                await asyncio.sleep(DELAY_S + len(chunk) / RATE)
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def forward(port: int, host: str, target: int, reader, writer) -> None:
    try:
        up_reader, up_writer = await asyncio.open_connection(host, target)
    except OSError:
        writer.close()
        return
    await asyncio.gather(pump(port, reader, up_writer), pump(port, up_reader, writer))


async def control(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    request = (await reader.readline()).decode(errors="replace").split()
    while (await reader.readline()) not in (b"\r\n", b"\n", b""):
        pass
    parts = request[1].strip("/").split("/") if len(request) > 1 else []
    status, body = "404 Not Found", "usage: GET /PORT or GET /PORT/(pass|dead|slow)\n"
    if parts and parts[0].isdigit() and int(parts[0]) in modes:
        port = int(parts[0])
        if len(parts) == 2 and parts[1] in ("pass", "dead", "slow"):
            modes[port] = parts[1]
            print(f"line {port}: {parts[1]}", flush=True)
        if len(parts) <= 2:
            status, body = "200 OK", modes[port] + "\n"
    writer.write(f"HTTP/1.0 {status}\r\nContent-Length: {len(body)}\r\n\r\n{body}".encode())
    await writer.drain()
    writer.close()


async def main() -> None:
    args = argparse.ArgumentParser()
    args.add_argument("--line", action="append", required=True, help="PORT=HOST:PORT")
    args.add_argument("--control", type=int)
    opts = args.parse_args()
    servers = []
    for spec in opts.line:
        port, to = spec.split("=")
        host, target = to.rsplit(":", 1)
        modes[int(port)] = "pass"
        handler = lambda r, w, p=int(port), h=host, t=int(target): forward(p, h, t, r, w)
        servers.append(await asyncio.start_server(handler, "0.0.0.0", int(port)))
        print(f"line {port} -> {to}", flush=True)
    if opts.control:
        servers.append(await asyncio.start_server(control, "0.0.0.0", opts.control))
    await asyncio.gather(*(s.serve_forever() for s in servers))


asyncio.run(main())

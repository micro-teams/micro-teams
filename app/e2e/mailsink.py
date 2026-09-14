#!/usr/bin/env python3
"""A throwaway SMTP server that never delivers anything, plus an HTTP window into what it caught.

Registration mails a verification code, so a test that starts where a real user starts — at the
sign-up form — has to be able to read that mail. Every alternative we had was a lie in some way:
inserting the row into Postgres (what e2e.sh does today) skips the whole sign-up path, and reading
the code out of the database asserts against our own storage rather than against what the user
would actually receive.

Stdlib only, and deliberately tiny: it speaks just enough SMTP to accept a message (no TLS, no
AUTH, no pipelining) because the only client it will ever serve is cheese-auth on a private
network. Mail is kept in memory and never written anywhere.

    python3 mailsink.py --smtp-port 52026 --http-port 52027 [--bind 0.0.0.0]

    GET /messages            every message, newest first
    GET /messages?to=x@y     only those addressed to x@y
    DELETE /messages         forget the mail and the trace (between attempts; /run survives, since
                             the run's parameters outlive an attempt that has to be tried again)
    GET /note?text=...       record one line of the journey's own trace
    GET /notes               that trace, oldest first
    POST /run  {...}         what this run's parameters are (the harness says)
    GET /run                 those parameters (the journey asks)

/run is how a value that differs every run reaches an app that was compiled once. A --dart-define is
baked in at build time, so an APK built ahead of CI cannot carry this run's ports, its run id, or an
enrolment code that did not exist when it was built. Handing them over here costs one request at
startup and lets the same binary serve every run.

The trace exists because a release web build reports a failed expectation as one line — the test's
name — and nothing else. Without it, a red run says only that the journey failed, not where. The
journey calls /note as it goes, and the harness prints the trace when something goes wrong.

Each message is {"to": [...], "from": ..., "body": "...", "at": <epoch seconds>}; `body` is the
raw DATA payload, decoded leniently, because callers here want to regex a code out of it rather
than parse MIME properly.
"""
import argparse
import asyncio
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CAUGHT = []
NOTES = []
PARAMS = {}
LOCK = threading.Lock()


class SmtpSession(asyncio.Protocol):
    def connection_made(self, transport):
        self.transport = transport
        self.buf = b''
        self.in_data = False
        self.mail_from = ''
        self.rcpt_to = []
        self.data = b''
        self.transport.write(b'220 mailsink\r\n')

    def data_received(self, chunk):
        self.buf += chunk
        while b'\r\n' in self.buf:
            line, self.buf = self.buf.split(b'\r\n', 1)
            self._line(line)

    def _line(self, line):
        if self.in_data:
            # A lone dot ends DATA; a leading dot on any other line is stuffing and comes back off.
            if line == b'.':
                self.in_data = False
                with LOCK:
                    CAUGHT.append({
                        'to': self.rcpt_to,
                        'from': self.mail_from,
                        'body': self.data.decode('utf-8', 'replace'),
                        'at': time.time(),
                    })
                self.mail_from, self.rcpt_to, self.data = '', [], b''
                self.transport.write(b'250 queued\r\n')
            else:
                self.data += (line[1:] if line.startswith(b'..') else line) + b'\n'
            return

        verb = line[:4].upper()
        text = line.decode('utf-8', 'replace')
        if verb in (b'EHLO', b'HELO'):
            self.transport.write(b'250-mailsink\r\n250 8BITMIME\r\n')
        elif verb == b'MAIL':
            self.mail_from = _addr(text)
            self.transport.write(b'250 ok\r\n')
        elif verb == b'RCPT':
            self.rcpt_to.append(_addr(text))
            self.transport.write(b'250 ok\r\n')
        elif verb == b'DATA':
            self.in_data = True
            self.transport.write(b'354 go ahead\r\n')
        elif verb == b'RSET':
            self.mail_from, self.rcpt_to, self.data = '', [], b''
            self.transport.write(b'250 ok\r\n')
        elif verb == b'QUIT':
            self.transport.write(b'221 bye\r\n')
            self.transport.close()
        elif verb == b'NOOP':
            self.transport.write(b'250 ok\r\n')
        else:
            # Refusing loudly beats a silent 250: a relay that asked for AUTH or STARTTLS and got
            # "fine" would then be surprised, and the failure would surface far from here.
            self.transport.write(b'502 not implemented\r\n')


def _addr(line):
    m = re.search(r'<([^>]*)>', line)
    return (m.group(1) if m else line.split(':', 1)[-1]).strip()


class Http(BaseHTTPRequestHandler):
    def do_GET(self):
        # /notes before /note: the shorter one is a prefix of the longer, and getting that backwards
        # makes reading the trace record a new empty line instead.
        if self.path.startswith('/run'):
            with LOCK:
                return self._send(200, dict(PARAMS))
        if self.path.startswith('/notes'):
            with LOCK:
                return self._send(200, list(NOTES))
        if self.path.startswith('/note'):
            from urllib.parse import unquote
            m = re.search(r'[?&]text=([^&]*)', self.path)
            with LOCK:
                NOTES.append(unquote(m.group(1)).replace('+', ' ') if m else '')
            return self._send(200, {'ok': True})
        if not self.path.startswith('/messages'):
            return self._send(404, {'error': 'not found'})
        want = None
        m = re.search(r'[?&]to=([^&]*)', self.path)
        if m:
            from urllib.parse import unquote
            want = unquote(m.group(1)).lower()
        with LOCK:
            msgs = [m for m in reversed(CAUGHT)
                    if want is None or any(a.lower() == want for a in m['to'])]
        self._send(200, msgs)

    def do_POST(self):
        if not self.path.startswith('/run'):
            return self._send(404, {'error': 'not found'})
        raw = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        try:
            given = json.loads(raw or b'{}')
        except ValueError:
            return self._send(400, {'error': 'not json'})
        with LOCK:
            PARAMS.clear()
            PARAMS.update({str(k): str(v) for k, v in given.items()})
        self._send(200, {'ok': True})

    def do_DELETE(self):
        with LOCK:
            CAUGHT.clear()
            NOTES.clear()
        self._send(200, {'ok': True})

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        # The browser-side test reads this straight from the app's own origin-less fetch.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--smtp-port', type=int, default=52026)
    ap.add_argument('--http-port', type=int, default=52027)
    ap.add_argument('--bind', default='0.0.0.0')
    args = ap.parse_args()

    http = ThreadingHTTPServer((args.bind, args.http_port), Http)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    server = await asyncio.get_running_loop().create_server(SmtpSession, args.bind, args.smtp_port)
    print(f'mailsink: smtp on {args.bind}:{args.smtp_port}, http on {args.bind}:{args.http_port}',
          flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

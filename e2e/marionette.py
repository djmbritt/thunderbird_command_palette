"""Minimal Marionette client (no dependencies).

Marionette is the remote-control protocol built into Gecko applications
(started with `--marionette`). Messages are `<length>:<json>`; commands are
`[0, id, name, params]` and replies `[1, id, error, result]`.

Only what the end-to-end tests need: start a session and run JavaScript in
the chrome (privileged) context, which can reach Thunderbird's windows and
the add-on's extension object.
"""

import json
import socket
import time


class MarionetteError(Exception):
    pass


class Marionette:
    def __init__(self, port, host="127.0.0.1", connect_timeout=60):
        deadline = time.time() + connect_timeout
        while True:
            try:
                self.sock = socket.create_connection((host, port), timeout=5)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.sock.settimeout(120)
        self.buf = b""
        self.msg_id = 0
        self._read()  # greeting: {"applicationType": "gecko", "marionetteProtocol": 3}

    def _read(self):
        while b":" not in self.buf:
            self._fill()
        length, rest = self.buf.split(b":", 1)
        length = int(length)
        while len(rest) < length:
            self.buf = rest
            self._fill()
            rest = self.buf
        self.buf = rest[length:]
        return json.loads(rest[:length])

    def _fill(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise MarionetteError("connection closed")
        self.buf += chunk

    def send(self, name, params=None):
        self.msg_id += 1
        data = json.dumps([0, self.msg_id, name, params or {}]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        while True:
            reply = self._read()
            if reply[0] == 1 and reply[1] == self.msg_id:
                break
        if reply[2]:
            err = reply[2]
            raise MarionetteError(f"{err.get('error')}: {err.get('message')}\n{err.get('stacktrace', '')}")
        return reply[3]

    def start(self):
        self.send("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"moz:accessibilityChecks": False}}})
        self.send("Marionette:SetContext", {"value": "chrome"})

    def js(self, script, *args, timeout_ms=30000):
        """Run `script` (an async function body; `arguments` holds args) in chrome context."""
        self.send("WebDriver:SetTimeouts", {"script": timeout_ms})
        wrapped = f"return (async function () {{\n{script}\n}}).apply(this, arguments);"
        result = self.send("WebDriver:ExecuteScript", {"script": wrapped, "args": list(args)})
        return result.get("value")

    def quit(self):
        try:
            self.send("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass

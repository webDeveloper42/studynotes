#!/usr/bin/env python3
"""StudyNotes web server: the notes page and its API, on this computer only.

    python3 -m studynotes.server [--port 8765] [--data DIR] [--open]

Listens on 127.0.0.1 and refuses other hostnames, so nothing outside this computer can reach it.
Uses only the Python standard library; the page's editor (Tiptap) and Bootstrap come from node_modules.
"""
import argparse
import json
import os
import re
import sys
import threading
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import webapi  # noqa: E402

STATIC = HERE / "static"
NODE_MODULES = Path(os.environ.get("STUDYNOTES_NODE_MODULES") or HERE.parent / "node_modules")
PAGE_FILES = {
    "/notes/": ("index.html", "text/html; charset=utf-8"),
    "/notes/index.html": ("index.html", "text/html; charset=utf-8"),
    "/notes/app.css": ("app.css", "text/css; charset=utf-8"),
    "/notes/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/notes/journal.js": ("journal.js", "text/javascript; charset=utf-8"),
    "/design/icons.js": ("icons.js", "text/javascript; charset=utf-8"),
}
LOOPBACK = {"127.0.0.1", "localhost", "[::1]"}
MAX_JSON = 30 * 1024 * 1024        # a note can hold images
MAX_UPLOAD = webapi.MAX_IMPORT     # a backup or .enex file
SAFE_NAME = re.compile(r"[^A-Za-z0-9._ -]")


class App:
    """The one notes engine this server talks to, and the folder uploaded files wait in."""

    def __init__(self, data_dir):
        self.data = Path(data_dir).expanduser()
        self.data.mkdir(parents=True, exist_ok=True)
        self.incoming = self.data / "incoming"
        self.lock = threading.Lock()
        self.notes = webapi.NotesApi(str(self.data / "notes.db"))

    def save_upload(self, stream, name, length):
        name = SAFE_NAME.sub("_", os.path.basename(name or "")).strip(" .")[:120] or "upload"
        self.incoming.mkdir(mode=0o700, exist_ok=True)
        target = self.incoming / name
        left = length
        with open(target, "wb") as out:
            while left > 0:
                chunk = stream.read(min(1 << 20, left))
                if not chunk:
                    break
                out.write(chunk)
                left -= len(chunk)
        if left:
            target.unlink(missing_ok=True)
            raise webapi.NotesError("The upload was cut off. Try again")
        return {"name": name}

    def uploaded(self, name):
        if not isinstance(name, str) or not name or SAFE_NAME.search(name) or name.startswith("."):
            raise webapi.NotesError("Choose the file again")
        path = self.incoming / name
        if not path.is_file():
            raise webapi.NotesError("Choose the file again")
        return path


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "StudyNotes"
        sys_version = ""

        def log_request(self, code="-", size="-"):  # quiet unless something fails
            if str(code).startswith(("4", "5")):
                super().log_request(code, size)

        # ── guards ──────────────────────────────────────────────────────
        def _host_allowed(self):
            """Other hostnames are refused, so a web page can't reach this through DNS rebinding."""
            host = (self.headers.get("Host") or "").lower()
            return host.rsplit(":", 1)[0] in LOOPBACK

        def _same_origin(self):
            origin = self.headers.get("Origin")
            return not origin or urlsplit(origin).netloc.lower() == (self.headers.get("Host") or "").lower()

        def _send(self, status, body, content_type="application/json", disposition=None, cache="no-store"):
            if not isinstance(body, (bytes, bytearray)):
                body = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            if content_type.startswith("text/html"):
                self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob: https: http:; "
                                 "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
                                 "font-src 'self' data:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            if disposition:
                self.send_header("Content-Disposition", disposition)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _guarded(self, call):
            try:
                result = call()
            except webapi.NotesError as error:
                return self._send(400, {"error": str(error)})
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self._send(500, {"error": "Something went wrong. Nothing else was changed. See the terminal running StudyNotes."})
            if result is None:
                return self._send(404, {"error": "Not found"})
            return self._send(200, result)

        def _download(self, make, name, content_type):
            try:
                body = make()
            except webapi.NotesError as error:
                return self._send(400, {"error": str(error)})
            except Exception:  # noqa: BLE001
                traceback.print_exc()
                return self._send(500, {"error": "That download didn't work. See the terminal running StudyNotes."})
            return self._send(200, body, content_type, disposition=f'attachment; filename="{name}"')

        # ── reading ─────────────────────────────────────────────────────
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if not self._host_allowed():
                self.close_connection = True
                return self._send(403, {"error": "Forbidden"})
            parts = urlsplit(self.path)
            path, query = parts.path, parse_qs(parts.query)
            one = lambda k: (query.get(k) or [""])[0]  # noqa: E731
            number = lambda k: int(one(k)) if one(k).isdigit() else None  # noqa: E731
            if path in ("/", "/notes"):
                self.send_response(302)
                self.send_header("Location", "/notes/")
                self.send_header("Content-Length", "0")
                return self.end_headers()
            if path in PAGE_FILES:
                name, kind = PAGE_FILES[path]
                return self._send(200, (STATIC / name).read_bytes(), kind)
            if path == "/vendor/bootstrap.min.css":
                return self._file(NODE_MODULES / "bootstrap/dist/css/bootstrap.min.css", "text/css; charset=utf-8")
            if path.startswith("/vendor/npm/"):
                # Only JavaScript files from the installed packages, for the editor's ES modules.
                relative = path[len("/vendor/npm/"):]
                if not relative or ".." in Path(relative).parts or not relative.endswith((".js", ".mjs")):
                    return self._send(404, {"error": "Not found"})
                return self._file(NODE_MODULES / relative, "text/javascript; charset=utf-8")
            if path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            if path == "/api/notes/state":
                return self._guarded(lambda: app.notes.state(one("view"), one("q"), one("sort")))
            if path == "/api/notes/note":
                return self._guarded(lambda: app.notes.note(number("id")))
            if path == "/api/notes/export":
                return self._download(lambda: app.notes.export_enex(number("notebook"), number("note")), "notes.enex", "application/xml")
            if path == "/api/notes/backup":
                return self._download(app.notes.export_backup, app.notes.backup_name(), "application/json")
            return self._send(404, {"error": "Not found"})

        def _file(self, target, kind):
            try:
                target = target.resolve()
                target.relative_to(NODE_MODULES.resolve())
                body = target.read_bytes()
            except (OSError, ValueError):
                return self._send(404, {"error": "Not found. Did you run setup-mac.sh (npm install)?"})
            return self._send(200, body, kind, cache="public, max-age=3600")

        # ── changing ────────────────────────────────────────────────────
        def do_POST(self):
            parts = urlsplit(self.path)
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if parts.path == "/api/upload":
                self.close_connection = True  # a refused upload's unread bytes can't be read as a next request
                # Other sites' pages can't set this header without a preflight, and preflights are never answered.
                if not (self._host_allowed() and self._same_origin() and self.headers.get("X-Capture-Upload") == "1"):
                    return self._send(403, {"error": "Forbidden"})
                if length < 0 or length > MAX_UPLOAD:
                    return self._send(413, {"error": "That file is too big"})
                name = (parse_qs(parts.query).get("path") or [""])[0]
                return self._guarded(lambda: app.save_upload(self.rfile, name, length))
            json_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() == "application/json"
            if not (self._host_allowed() and self._same_origin() and json_type):
                self.close_connection = True
                return self._send(403, {"error": "Forbidden"})
            if length < 0 or length > MAX_JSON:
                self.close_connection = True
                return self._send(413, {"error": "That's too long"})
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                data = None
            if not isinstance(data, dict):
                return self._send(400, {"error": "Bad request"})
            if parts.path == "/api/notes/do":
                return self._guarded(lambda: app.notes.do(data.get("action"), data))
            if parts.path == "/api/notes/import":
                return self._guarded(lambda: self._take(data, lambda p: app.notes.import_enex(str(p), data.get("name"))))
            if parts.path == "/api/notes/restore":
                return self._guarded(lambda: self._take(data, lambda p: app.notes.restore_backup(str(p), data.get("mode"))))
            return self._send(404, {"error": "Not found"})

        def _take(self, data, use):
            """Reads an uploaded file once, then clears it out of the incoming folder."""
            path = app.uploaded(data.get("file"))
            with app.lock:
                try:
                    return use(path)
                finally:
                    path.unlink(missing_ok=True)

    return Handler


def main(argv=None):
    p = argparse.ArgumentParser(prog="studynotes", description="Run StudyNotes in your browser, on this computer only.")
    p.add_argument("--port", type=int, default=int(os.environ.get("STUDYNOTES_PORT") or 8765))
    p.add_argument("--data", default=None, help="folder for your notes (default: %s)" % webapi.store.data_dir())
    p.add_argument("--open", action="store_true", help="open the page in your browser once it's running")
    a = p.parse_args(argv)
    app = App(a.data or webapi.store.data_dir())
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(app))
    except OSError:
        sys.exit(f"Port {a.port} is busy. Is StudyNotes already running? Try: studynotes --port {a.port + 1}")
    httpd.daemon_threads = True
    url = f"http://127.0.0.1:{a.port}/notes/"
    print(f"StudyNotes is running at {url}\nYour notes are in {app.data}\nPress Ctrl+C to stop.", flush=True)
    if not (NODE_MODULES / "@tiptap/core").is_dir():
        print("Warning: node_modules is missing, so the editor can't load. Run ./setup-mac.sh first.", file=sys.stderr)
    if a.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()

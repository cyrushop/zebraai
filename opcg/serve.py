#!/usr/bin/env python3
"""Local server for the OPCG collection app.

    python3 opcg/serve.py            # then open http://localhost:8765
    python3 opcg/serve.py --port 9000

* Serves the app (opcg/app) and the bot output (opcg/data).
* Saves your collection to opcg/data/collection.json (with a dated backup per day),
  so it survives clearing the browser.
* Lets the app's 設定 tab run the card bot and the deck bot.

Standard library only. Listens on 127.0.0.1 only.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
STATE = os.path.join(DATA, "collection.json")
BOTS = {
    "cards": [os.path.join(ROOT, "bot", "scrape_cards.py")],
    "cards-images": [os.path.join(ROOT, "bot", "scrape_cards.py"), "--images"],
    "decks": [os.path.join(ROOT, "bot", "scrape_decks.py")],
}

jobs = {}  # name -> {"running", "log", "code", "started"}
lock = threading.Lock()


def run_bot(name):
    with lock:
        if jobs.get(name, {}).get("running"):
            return False
        jobs[name] = {"running": True, "log": "", "code": None, "started": time.time()}

    def work():
        proc = subprocess.Popen([sys.executable, "-u", "-I"] + BOTS[name], cwd=ROOT,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                encoding="utf-8", errors="replace")
        for line in proc.stdout:
            with lock:
                jobs[name]["log"] = (jobs[name]["log"] + line)[-20000:]
        code = proc.wait()
        with lock:
            jobs[name].update(running=False, code=code)

    threading.Thread(target=work, daemon=True).start()
    return True


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if self.path.startswith("/data/") and not self.path.startswith("/data/images/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/app/")
            self.end_headers()
            return
        if self.path.startswith("/data/raw") or self.path.startswith("/bot"):
            self.send_error(404)
            return
        if self.path == "/api/state":
            if os.path.exists(STATE):
                with open(STATE, encoding="utf-8") as f:
                    return self._json({"ok": True, "state": json.load(f)})
            return self._json({"ok": True, "state": None})
        if self.path == "/api/bot":
            with lock:
                return self._json({"ok": True, "jobs": jobs})
        return super().do_GET()

    def do_PUT(self):
        if self.path != "/api/state":
            return self.send_error(404)
        n = int(self.headers.get("Content-Length") or 0)
        try:
            state = json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError:
            return self._json({"ok": False, "error": "bad json"}, 400)
        os.makedirs(DATA, exist_ok=True)
        backup = os.path.join(DATA, "backups", time.strftime("collection-%Y-%m-%d.json"))
        if os.path.exists(STATE) and not os.path.exists(backup):
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            shutil.copyfile(STATE, backup)
        tmp = STATE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(tmp, STATE)
        return self._json({"ok": True})

    def do_POST(self):
        if self.path.startswith("/api/bot/"):
            name = self.path.rsplit("/", 1)[1]
            if name not in BOTS:
                return self.send_error(404)
            started = run_bot(name)
            return self._json({"ok": True, "started": started})
        return self.send_error(404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"OPCG app: http://localhost:{args.port}   (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

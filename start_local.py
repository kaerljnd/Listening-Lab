#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import socket
import shutil
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import unquote, urlparse
import webbrowser

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
PACKS_DIR = ROOT / "practice_packs"


def safe_join(base: Path, rel: str) -> Path | None:
    rel = unquote(rel).lstrip("/")
    candidate = (base / rel).resolve()
    try:
        candidate.relative_to(base.resolve())
    except ValueError:
        return None
    return candidate


def scan_packs():
    packs, errors = [], []
    PACKS_DIR.mkdir(exist_ok=True)
    for folder in sorted(PACKS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not folder.is_dir() or folder.name.startswith("_") or folder.name.startswith("."):
            continue
        manifest_path = folder / "manifest.json"
        if not manifest_path.exists():
            errors.append({"folder": folder.name, "error": "缺少 manifest.json"})
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            pack_file = manifest.get("pack_file", "pack.json")
            if not (folder / pack_file).is_file():
                raise ValueError(f"找不到 {pack_file}")
            item = dict(manifest)
            item["folder"] = folder.name
            item["pack_file"] = pack_file
            packs.append(item)
        except Exception as exc:
            errors.append({"folder": folder.name, "error": str(exc)})
    return {"packs": packs, "errors": errors}


class Handler(SimpleHTTPRequestHandler):
    server_version = "ListeningLabLocal/1.9.1"

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def end_headers(self):
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/packs":
            payload = json.dumps(scan_packs(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return
        return super().do_GET()

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path = path / "index.html"
        if not path.is_file():
            self.send_error(404, "File not found")
            return None
        try:
            f = path.open("rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        stat = os.fstat(f.fileno())
        size = stat.st_size
        ctype = self.guess_type(str(path))
        range_header = self.headers.get("Range")
        self._byte_range = None
        if range_header and range_header.startswith("bytes="):
            try:
                spec = range_header.split("=", 1)[1].split(",", 1)[0].strip()
                a, b = spec.split("-", 1)
                if a:
                    start = int(a)
                    end = int(b) if b else size - 1
                else:
                    suffix = int(b)
                    start = max(0, size - suffix)
                    end = size - 1
                if start < 0 or start >= size or end < start:
                    raise ValueError
                end = min(end, size - 1)
                self._byte_range = (start, end)
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(end - start + 1))
            except Exception:
                f.close()
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return None
        else:
            self.send_response(200)
            self.send_header("Content-Length", str(size))
        self.send_header("Content-Type", ctype)
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.send_header("Accept-Ranges", "bytes")
        if path.suffix.lower() in {".json", ".js", ".css", ".html"}:
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        byte_range = getattr(self, "_byte_range", None)
        if not byte_range:
            return shutil.copyfileobj(source, outputfile)
        start, end = byte_range
        source.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def translate_path(self, path):
        parsed = urlparse(path)
        p = parsed.path
        if p.startswith("/packs/"):
            target = safe_join(PACKS_DIR, p[len("/packs/"):])
            return str(target or PACKS_DIR / "__invalid__")
        rel = p.lstrip("/") or "index.html"
        target = safe_join(APP_DIR, rel)
        return str(target or APP_DIR / "__invalid__")


def free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 21):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("8000–8020 端口均被占用，请用 --port 指定其他端口。")


def main():
    parser = argparse.ArgumentParser(description="Listening Lab local server")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    port = free_port(args.port)
    url = f"http://127.0.0.1:{port}/"
    print("\nListening Lab 已启动")
    print(f"地址：{url}")
    print(f"题包目录：{PACKS_DIR}")
    print("新增题包后无需重启：回到套题选择页点击‘重新扫描题包’即可。")
    print("按 Ctrl+C 停止。\n")
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nListening Lab 已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""零依赖本地静态服务器。

Windows 上 `python -m http.server` 的 mimetypes 会读取注册表，
经常把 .js 返回成 text/plain，浏览器会拒绝加载 ES modules。
这里显式指定常见前端资源的 MIME 类型。
"""

import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
HOST = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    # 浏览器会并行请求所有 ES module，单线程服务器会把连接队列打满。
    request_queue_size = 128


with Server((HOST, PORT), Handler) as httpd:
    print(f"侠盗飞车本地服务器: http://localhost:{PORT}")
    if HOST not in ("127.0.0.1", "localhost"):
        try:
            local_ip = socket.gethostbyname(socket.gethostname())
            print(f"局域网手机访问: http://{local_ip}:{PORT}")
        except OSError:
            pass
    print("按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

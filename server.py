#!/usr/bin/env python3
"""
UYAP Web Editörü — Geliştirme / Local Test Sunucusu

ArkSigner, HTTPS sayfasından ws:// bağlantısını bloklar (mixed-content).
Bu yüzden imzalama için HTTP üzerinden erişilmesi gerekir.

Kullanım:
    python3 server.py [--host 0.0.0.0] [--port 8090]

Örnekler:
    python3 server.py                      # 127.0.0.1:8090 (sadece lokal)
    python3 server.py --host 0.0.0.0       # Tüm arayüzler (ağdan erişim)
    python3 server.py --host 0.0.0.0 --port 80   # Port 80 (sudo gerekir)

Hosts dosyası ile test:
    /etc/hosts (Linux/Mac) veya C:\\Windows\\System32\\drivers\\etc\\hosts (Windows):
    127.0.0.1  dokuman.yargitay.gov.tr
    Sonra: http://dokuman.yargitay.gov.tr:8090
"""

import http.server
import os
import sys
import argparse

DEFAULT_PORT = 8090
DEFAULT_HOST = "127.0.0.1"


class UYAPHandler(http.server.SimpleHTTPRequestHandler):
    """
    SimpleHTTPRequestHandler'a ArkSigner için gerekli HTTP başlıkları ekler.

    - Access-Control-Allow-Private-Network: true
      Chrome 94+ Private Network Access politikası — sayfadan ws://127.0.0.1 bağlantısı için.

    - Access-Control-Allow-Origin: *
      CORS kısıtlamasını kaldırır.

    - Cross-Origin-Opener-Policy: same-origin-allow-popups
      SharedArrayBuffer ve bazı Web API'leri için.
    """

    def end_headers(self):
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        # Tarayıcı önbelleğini devre dışı bırak — geliştirme ortamı
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        path = args[0] if args else ""
        if "404" in str(args) or any(ext in str(path) for ext in [".html", ".js", ".css"]):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description="UYAP Web Editörü Sunucusu")
    parser.add_argument("--host", default=DEFAULT_HOST,
                        help=f"Bind adresi (varsayılan: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"Port (varsayılan: {DEFAULT_PORT})")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    server = http.server.ThreadingHTTPServer((args.host, args.port), UYAPHandler)

    print(f"""
  ┌─────────────────────────────────────────────────────┐
  │   UYAP Web Editörü — Geliştirme Sunucusu           │
  └─────────────────────────────────────────────────────┘

  Sunucu: http://{args.host}:{args.port}

  Tarayıcıda aç:
    http://127.0.0.1:{args.port}                  (lokal)""")

    if args.host == "0.0.0.0":
        import socket
        try:
            ip = socket.gethostbyname(socket.gethostname())
            print(f"    http://{ip}:{args.port}         (ağ)")
        except Exception:
            pass

    print(f"""
  Hosts dosyası ile test:
    1. /etc/hosts (veya C:\\Windows\\System32\\drivers\\etc\\hosts) dosyasına ekle:
       127.0.0.1  dokuman.yargitay.gov.tr
    2. Tarayıcıda: http://dokuman.yargitay.gov.tr:{args.port}

  ArkSigner notu:
    ✅ HTTP üzerinden ws://127.0.0.1:16356 bağlantısı çalışır
    ❌ HTTPS üzerinden ws:// bağlantısı Chrome'da mixed-content hatası verir
       → İmzalama için MUTLAKA http:// kullanın

  Durdurmak için: Ctrl+C
""")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Sunucu durduruldu.")
        sys.exit(0)


if __name__ == "__main__":
    main()

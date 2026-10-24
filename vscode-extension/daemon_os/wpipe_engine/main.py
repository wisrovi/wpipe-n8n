#!/usr/bin/env python3
"""WPipe Engine - Command Line Interface & Daemon Launcher
Author: William Rodriguez (wisrovi.dev)
"""

import argparse
import sys
from pathlib import Path

# Add package root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from wpipe_engine.core.licensing import LicenseManager, compute_machine_fingerprint
from wpipe_engine.ipc.server import (
    DEFAULT_HTTP_HOST,
    DEFAULT_HTTP_PORT,
    DEFAULT_SOCKET_PATH,
    start_ipc_server,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="wpipe-engine",
        description="WPipe Studio Local Native Engine & Licensing Daemon (wisrovi SUITE)",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Command: daemon (default)
    daemon_parser = subparsers.add_parser("daemon", help="Start the IPC daemon server")
    daemon_parser.add_argument("--socket", default=DEFAULT_SOCKET_PATH, help=f"Unix socket path (default: {DEFAULT_SOCKET_PATH})")
    daemon_parser.add_argument("--http", action="store_true", help="Use local HTTP transport instead of Unix socket")
    daemon_parser.add_argument("--host", default=DEFAULT_HTTP_HOST, help="Local HTTP host")
    daemon_parser.add_argument("--port", type=int, default=DEFAULT_HTTP_PORT, help=f"Local HTTP port (default: {DEFAULT_HTTP_PORT})")

    # Command: status
    subparsers.add_parser("status", help="Show current license status and block quotas")

    # Command: fingerprint
    subparsers.add_parser("fingerprint", help="Calculate and print hardware machine fingerprint")

    # Command: activate
    activate_parser = subparsers.add_parser("activate", help="Activate a WPipe Pro license key")
    activate_parser.add_argument("key", help="License key (e.g., WPIPE-PRO-XXXX-XXXX-XXXX)")

    args = parser.parse_args()

    mgr = LicenseManager()

    if args.command == "status":
        status = mgr.get_status()
        print("==================================================")
        print("           WPIPE STUDIO LICENSE STATUS            ")
        print("==================================================")
        print(f"Active Plan:          {status.get('tier', 'free').upper()}")
        print(f"Is Pro:               {'YES (Unlimited)' if status.get('is_pro') else 'NO (5 blocks limit)'}")
        print(f"Block Limit:          {status.get('max_blocks') or 'Unlimited'}")
        print(f"Machine Fingerprint:  {status.get('machine_fingerprint')}")
        if status.get("lease_expires_at"):
            print(f"Lease Expires:        {status.get('lease_expires_at')}")
        print(f"Details:              {status.get('message')}")
        print("==================================================")
        sys.exit(0)

    elif args.command == "fingerprint":
        fp = compute_machine_fingerprint()
        print(f"Hardware Machine Fingerprint: {fp}")
        sys.exit(0)

    elif args.command == "activate":
        print(f"Activating key {args.key} against Cloudflare Edge...")
        ok, msg = mgr.activate_with_key(args.key)
        if ok:
            print(f"✅ {msg}")
            sys.exit(0)
        else:
            print(f"❌ Activation failed: {msg}")
            sys.exit(1)

    else:
        # Default action: run daemon
        socket_path = getattr(args, "socket", DEFAULT_SOCKET_PATH)
        use_http = getattr(args, "http", False)
        http_host = getattr(args, "host", DEFAULT_HTTP_HOST)
        http_port = getattr(args, "port", DEFAULT_HTTP_PORT)
        start_ipc_server(
            socket_path=socket_path,
            http_host=http_host,
            http_port=http_port,
            use_http=use_http,
        )


if __name__ == "__main__":
    main()

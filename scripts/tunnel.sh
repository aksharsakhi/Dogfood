#!/usr/bin/env bash
set -euo pipefail

# Dogfood Quick Tunnel Launch Script
# Starts a secure Cloudflare Quick Tunnel for demo/evaluation previews without DNS setup

PORT="${1:-3000}"

if ! command -v cloudflared &> /dev/null; then
    echo "Error: cloudflared is not installed. Install with: brew install cloudflared or apt install cloudflared"
    exit 1
fi

echo "==> Starting Cloudflare Tunnel for localhost:${PORT}..."
echo "==> A public https://*.trycloudflare.com URL will be generated below:"
cloudflared tunnel --url "http://localhost:${PORT}"

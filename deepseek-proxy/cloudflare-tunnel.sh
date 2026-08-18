#!/bin/bash
# VYCODE DeepSeek Proxy - Cloudflare Tunnel Setup
# Exposes the local proxy to the internet via Cloudflare

set -e

# Load config
if [ -f .env ]; then
  source .env
fi

DOMAIN=${DOMAIN:-"vycode.vyluxtech.qzz.io"}
CF_TOKEN=${CF_TOKEN:-""}
PROXY_PORT=${PORT:-3002}

if [ -z "$CF_TOKEN" ]; then
  echo "Error: CF_TOKEN not set in .env"
  echo "Get your tunnel token from Cloudflare Zero Trust dashboard"
  exit 1
fi

echo "=== VYCODE Cloudflare Tunnel ==="
echo "Domain: $DOMAIN"
echo "Proxy port: $PROXY_PORT"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  if command -v apt &>/dev/null; then
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o /usr/local/bin/cloudflared
  elif command -v pkg &>/dev/null; then
    pkg install -y cloudflared 2>/dev/null || {
      curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 -o $PREFIX/bin/cloudflared
    }
  else
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  fi
  chmod +x /usr/local/bin/cloudflared 2>/dev/null || chmod +x $PREFIX/bin/cloudflared 2>/dev/null
fi

echo "Starting tunnel..."
cloudflared tunnel --url http://localhost:$PROXY_PORT --no-autoupdate 2>&1 | grep --line-buffered -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1 | while read url; do
  echo ""
  echo "  Tunnel URL: $url"
  echo "  Setup page: $url/setup"
  echo "  API endpoint: $url/v1/chat/completions"
  echo ""
  echo "  Update your VYCODE config:"
  echo "    \"baseURL\": \"$url/v1\""
  echo ""
done

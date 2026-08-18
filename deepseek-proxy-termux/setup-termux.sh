#!/bin/bash
# VYCODE DeepSeek Proxy - Termux Setup Script
# Run this on Termux (Android) to install everything

set -e

echo "=== VYCODE DeepSeek Proxy - Termux Setup ==="
echo ""

# Update packages
echo "[1/5] Updating Termux packages..."
pkg update -y

# Install Node.js and Chromium
echo "[2/5] Installing Node.js and Chromium..."
pkg install -y nodejs chromium

# Install npm dependencies
echo "[3/5] Installing proxy dependencies..."
cd "$(dirname "$0")"
npm install

# Set up storage access (needed for Chrome profile)
echo "[4/5] Setting up storage..."
termux-setup-storage 2>/dev/null || true

# Create config
echo "[5/5] Creating config..."
cat > .env << 'ENVEOF'
PORT=3002
CDP_URL=
HEADLESS=true
ENVEOF

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start the proxy:"
echo "  cd $(pwd)"
echo "  node server.js"
echo ""
echo "To use with VYCODE, set your config:"
echo '  "baseURL": "http://localhost:3002/v1"'
echo ""
echo "First time: You'll need to log in to DeepSeek."
echo "The proxy will open a browser - log in manually, then the proxy saves your token."
echo ""
echo "To run with visible browser (for login):"
echo "  HEADLESS=false node server.js"
echo ""

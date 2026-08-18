#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=${PORT:-3002}
CDP_PORT=${CDP_PORT:-9222}

# Kill existing proxy on this port
lsof -ti:$PORT | xargs kill -9 2>/dev/null
sleep 1

cd "$DIR"
PORT=$PORT CDP_PORT=$CDP_PORT setsid node server.js >> /tmp/proxy.log 2>&1 &
echo "DeepSeek proxy started on port $PORT (PID: $!)"

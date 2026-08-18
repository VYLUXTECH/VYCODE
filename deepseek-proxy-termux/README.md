# VYCODE DeepSeek Proxy (Termux)

Browser-based proxy that bridges OpenAI API format to DeepSeek chat via headless Chromium.

## Quick Start (Termux)

```bash
# One-time setup
./setup-termux.sh

# Start proxy
node server.js

# Login to DeepSeek (first time only, needs visible browser)
HEADLESS=false node server.js
```

## How It Works

1. Launches headless Chromium (or connects to existing Chrome via CDP)
2. Navigates to chat.deepseek.com
3. Types messages, clicks send, extracts responses
4. Returns responses in OpenAI API format

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | Proxy server port |
| `CDP_URL` | auto | Chrome DevTools Protocol URL (e.g. `http://127.0.0.1:9222`) |
| `HEADLESS` | `true` | Run browser headless (`false` for login) |

## Models

| Model ID | Mode |
|----------|------|
| `deepseek-chat` | Instant |
| `deepseek-chat-thinking` | Instant Thinking |
| `deepseek-chat-search` | Instant Search |
| `deepseek-chat-vision` | Vision |
| `deepseek-chat-vision-thinking` | Vision Thinking |
| `deepseek-reasoner` | Expert Thinking |
| `deepseek-reasoner-not` | Expert |

## API Usage

```bash
# Health check
curl http://localhost:3002/health

# List models
curl http://localhost:3002/v1/models

# Chat completion
curl http://localhost:3002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'
```

## VYCODE Config

```json
{
  "provider": {
    "deepseek": {
      "options": {
        "apiKey": "vycode-browser-proxy",
        "baseURL": "http://localhost:3002/v1"
      }
    }
  }
}
```

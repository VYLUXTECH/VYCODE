const http = require('http');
const PORT = parseInt(process.env.PORT || '3002', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);

const MODELS = {
  'deepseek-chat':                  { label: 'Instant' },
  'deepseek-chat-thinking':         { label: 'Instant Thinking' },
  'deepseek-chat-search':           { label: 'Instant Search' },
  'deepseek-chat-vision':           { label: 'Vision' },
  'deepseek-chat-vision-thinking':  { label: 'Vision Thinking' },
  'deepseek-reasoner':              { label: 'Expert Thinking' },
  'deepseek-reasoner-not':          { label: 'Expert' },
};

function log(m) { console.log(`[${new Date().toISOString()}] ${m}`); }

function httpGet(url) {
  return new Promise((ok, no) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => ok(d)); }).on('error', no);
  });
}

function readBody(req) {
  return new Promise(ok => { let b = ''; req.on('data', c => b += c); req.on('end', () => ok(b)); });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

let wsId = 0;
function cdp(ws, method, params = {}) {
  return new Promise((ok, no) => {
    const myId = ++wsId;
    const timer = setTimeout(() => { ws.removeListener('message', h); no(new Error('CDP timeout')); }, 120000);
    function h(raw) {
      const d = JSON.parse(raw);
      if (d.id === myId) { clearTimeout(timer); ws.removeListener('message', h); d.error ? no(new Error(d.error.message)) : ok(d.result); }
    }
    ws.on('message', h);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

function wsConnect(url) {
  return new Promise((ok, no) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    ws.on('open', () => ok(ws));
    ws.on('error', no);
    setTimeout(() => no(new Error('WS connect timeout')), 5000);
  });
}

async function evalJS(ws, expr) {
  const r = await cdp(ws, 'Runtime.evaluate', { expression: expr });
  return r.result?.value;
}

async function newChat(ws) {
  await evalJS(ws, `(function(){
    const el = document.querySelector('a[href="/"], [class*="new-chat"]');
    if(el) { el.click(); return 'ok'; }
    location.href = 'https://chat.deepseek.com/';
    return 'nav';
  })()`);

  // Wait for textarea to be ready
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const ready = await evalJS(ws, `(function(){
      const ta = document.querySelector('textarea');
      return ta ? 'ready' : 'waiting';
    })()`);
    if (ready === 'ready') {
      await new Promise(r => setTimeout(r, 500));
      return;
    }
  }
  throw new Error('Chat page did not load (no textarea after 15s)');
}

async function typeAndSend(ws, text) {
  const safe = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  await evalJS(ws, `(function(){
    const ta = document.querySelector('textarea');
    if(!ta) throw 'no textarea';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, \`${safe}\`);
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return 'typed';
  })()`);
  await new Promise(r => setTimeout(r, 400));

  await evalJS(ws, `(function(){
    const btns = document.querySelectorAll('[role=button], button');
    for(const b of btns) {
      if(b.className && b.className.includes('ds-button--primary') && b.className.includes('ds-button--filled')) {
        b.click();
        return 'clicked';
      }
    }
    const ta = document.querySelector('textarea');
    if(ta) { ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true})); return 'enter'; }
    throw 'no send button';
  })()`);
}

async function waitForResponse(ws, timeoutMs = 120000) {
  let lastText = '';
  let stableCount = 0;

  for (let i = 0; i < Math.ceil(timeoutMs / 1000); i++) {
    await new Promise(r => setTimeout(r, 1000));

    const raw = await evalJS(ws, `(function(){
      // Check if still generating (thinking indicator)
      const thinking = document.querySelector('[class*="thinking-loading"], [class*="generating"], [class*="stop-btn"]');
      const isGenerating = !!thinking;

      // Get only the TOP-LEVEL assistant message content (not nested)
      const msgs = document.querySelectorAll('.ds-message');
      let lastAssistant = '';
      msgs.forEach(m => {
        const md = m.querySelector('.ds-markdown.ds-assistant-message-main-content');
        if (md) lastAssistant = md.textContent?.trim() || '';
      });

      return JSON.stringify({text: lastAssistant, generating: isGenerating});
    })()`);

    const { text: current, generating } = JSON.parse(raw || '{"text":"","generating":false}');

    if (generating) {
      stableCount = 0;
      lastText = current;
      if (i % 10 === 0) log(`Generating... ${current.length} chars`);
      continue;
    }

    if (current && current.length > 0) {
      if (current === lastText) {
        stableCount++;
        if (stableCount >= 2) return current;
      } else {
        stableCount = 0;
        lastText = current;
      }
    }
  }
  throw new Error('Response timeout');
}

async function handleCompletion(req, res) {
  const body = await readBody(req);
  let parsed;
  try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }

  const messages = parsed.messages || [];
  const model = parsed.model || 'deepseek-chat';
  const stream = parsed.stream || false;
  const config = MODELS[model] || MODELS['deepseek-chat'];

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return json(res, 400, { error: 'No user message' });

  let userText = typeof lastUser.content === 'string'
    ? lastUser.content
    : Array.isArray(lastUser.content)
      ? lastUser.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : '';

  const sysMsgs = messages.filter(m => m.role === 'system');
  const ctxMsgs = messages.filter(m => m.role !== 'system' && m !== lastUser);

  let prompt = '';
  if (sysMsgs.length) prompt += '[System]\n' + sysMsgs.map(m => m.content).join('\n') + '\n\n';
  if (ctxMsgs.length) {
    prompt += ctxMsgs.map(m => `[${m.role}]\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n') + '\n\n';
  }
  prompt += '[User]\n' + userText;

  log(`${config.label} | ${prompt.substring(0, 120)}...`);

  const targetData = await httpGet(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const target = JSON.parse(targetData).find(p => p.type === 'page' && p.url.includes('chat.deepseek.com'));
  if (!target) return json(res, 500, { error: 'DeepSeek page not open in Chrome' });

  const ws = await wsConnect(target.webSocketDebuggerUrl);

  try {
    const url = await evalJS(ws, 'location.href');
    if (!url || url.includes('sign_in')) return json(res, 401, { error: 'DeepSeek not logged in' });

    await newChat(ws);
    await typeAndSend(ws, prompt);
    log('Sent, waiting for response...');

    const response = await waitForResponse(ws);
    log(`Response (${response.length} chars): ${response.substring(0, 100)}...`);

    ws.close();

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      const id = 'chatcmpl-vycode-' + Date.now();
      res.write(`data: ${JSON.stringify({id, object:'chat.completion.chunk', created: Math.floor(Date.now()/1000), model, choices: [{index:0, delta:{role:'assistant', content: response}, finish_reason: 'stop'}]})}\n\n`);
      res.write(`data: ${JSON.stringify({id, object:'chat.completion.chunk', choices: [{index:0, delta:{}, finish_reason: 'stop'}]})}\n\n`);
      res.end();
    } else {
      json(res, 200, {
        id: 'chatcmpl-vycode-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: response }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  } catch (err) {
    log(`Error: ${err.message}`);
    try { ws.close(); } catch {}
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const p = new URL(req.url, `http://localhost:${PORT}`).pathname;

  try {
    if (p === '/health') return json(res, 200, { status: 'ok', service: 'vycode-deepseek-proxy' });

    if (p === '/v1/models') {
      return json(res, 200, {
        object: 'list',
        data: Object.entries(MODELS).map(([id]) => ({ id, object: 'model', owned_by: 'deepseek' })),
      });
    }

    if ((p === '/v1/chat/completions' || p === '/chat/completions') && req.method === 'POST') {
      return await handleCompletion(req, res);
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    log(`Server error: ${err.message}`);
    if (!res.headersSent) json(res, 500, { error: err.message });
  }
});

process.on('uncaughtException', err => log(`uncaught: ${err.message}`));
process.on('unhandledRejection', err => log(`unhandled: ${err}`));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[VYCODE DeepSeek Proxy] http://localhost:${PORT}`);
  console.log(`[VYCODE DeepSeek Proxy] Models: ${Object.keys(MODELS).join(', ')}`);
});

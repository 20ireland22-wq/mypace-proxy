'use strict';

const express = require('express');
const https   = require('https');

const OPENAI_API_KEY   = process.env.OPENAI_API_KEY;
const APP_SECRET_TOKEN = process.env.APP_SECRET_TOKEN;
const PORT             = process.env.PORT || 3000;

if (!OPENAI_API_KEY)   console.warn('WARNING: OPENAI_API_KEY env var not set — proxy requests will fail');
if (!APP_SECRET_TOKEN) console.warn('WARNING: APP_SECRET_TOKEN env var not set — all requests will be rejected');

const app = express();

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkToken(req, res, next) {
  if (req.headers['x-app-token'] !== APP_SECRET_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ── Proxy helper ──────────────────────────────────────────────────────────────
// Pipes the raw request body straight to OpenAI — works for both multipart
// (Whisper) and JSON (chat) without needing a body-parsing middleware.

function proxyTo(openaiPath) {
  return (req, res) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY not set' });

    const headers = { ...req.headers };
    delete headers['x-app-token'];
    headers['host']          = 'api.openai.com';
    headers['authorization'] = `Bearer ${key}`;

    const proxyReq = https.request(
      { hostname: 'api.openai.com', path: openaiPath, method: 'POST', headers },
      (proxyRes) => {
        res.status(proxyRes.statusCode);
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          res.setHeader(k, v);
        }
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('Upstream error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Bad Gateway' });
    });

    req.pipe(proxyReq);
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.post('/api/whisper', checkToken, proxyTo('/v1/audio/transcriptions'));
app.post('/api/chat',    checkToken, proxyTo('/v1/chat/completions'));
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`mypace-proxy listening on port ${PORT}`);
});

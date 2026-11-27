require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

let firebaseCerts = null;
let firebaseCertExpires = 0;
function decodeBase64Url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
async function requireFirebaseUser(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(401).json({ error: 'Sign in to use AI generation.' });
    const header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
    const claims = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid || claims.aud !== 'agentcopilot-98817' ||
        claims.iss !== 'https://securetoken.google.com/agentcopilot-98817' ||
        !claims.sub || claims.sub.length > 128 || !claims.exp || claims.exp <= now ||
        claims.iat > now + 60 || !claims.auth_time) {
      return res.status(401).json({ error: 'Your sign-in session is invalid or expired.' });
    }
    if (!firebaseCerts || firebaseCertExpires < Date.now()) {
      const response = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
      if (!response.ok) return res.status(503).json({ error: 'Authentication service is temporarily unavailable.' });
      firebaseCerts = await response.json();
      firebaseCertExpires = Date.now() + 50 * 60 * 1000;
    }
    const certificate = firebaseCerts[header.kid];
    if (!certificate) return res.status(401).json({ error: 'Your sign-in token could not be verified.' });
    const key = new crypto.X509Certificate(certificate).publicKey;
    const valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, decodeBase64Url(parts[2]));
    if (!valid) return res.status(401).json({ error: 'Your sign-in token could not be verified.' });
    req.firebaseUser = { uid: claims.sub };
    next();
  } catch (error) {
    console.error('Firebase authentication failed:', error.message);
    return res.status(401).json({ error: 'Sign in to use AI generation.' });
  }
}
const generationLimits = new Map();
function limitGeneration(req, res, next) {
  const key = req.firebaseUser.uid;
  const now = Date.now();
  const entry = generationLimits.get(key);
  if (!entry || now - entry.startedAt >= 60_000) {
    generationLimits.set(key, { startedAt: now, count: 1 });
    return next();
  }
  if (entry.count >= 20) return res.status(429).json({ error: 'AI generation limit reached. Try again in one minute.' });
  entry.count += 1;
  next();
}

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((value) => value.trim())
    : ['https://etidoz1.github.io']
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AgentCopilot AI backend',
    configured: Boolean(API_KEY)
  });
});

app.post('/api/generate', requireFirebaseUser, limitGeneration, async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(503).json({ error: 'The backend is missing GEMINI_API_KEY.' });
    }

    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Please provide a prompt.' });
    }
    if (prompt.length > 12000) {
      return res.status(413).json({ error: 'Prompt is too long. Please shorten it.' });
    }

    const googleResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      }
    );

    const payload = await googleResponse.json();
    if (!googleResponse.ok) {
      console.error('Gemini API error:', payload?.error?.message || googleResponse.status);
      return res.status(502).json({
        error: payload?.error?.message || 'Gemini could not process the request.'
      });
    }

    const text = (payload.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      return res.status(502).json({ error: 'Gemini returned an empty response. Please try again.' });
    }

    return res.json({ result: text });
  } catch (error) {
    console.error('Generation failed:', error);
    return res.status(500).json({ error: 'The AI request failed. Please try again.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AgentCopilot AI backend listening on port ${PORT}`);
});

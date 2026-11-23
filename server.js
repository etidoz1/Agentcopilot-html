require('dotenv').config();

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((value) => value.trim())
    : true
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'AgentCopilot AI backend',
    configured: Boolean(API_KEY)
  });
});

app.post('/api/generate', async (req, res) => {
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

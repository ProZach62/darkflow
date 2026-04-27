const express = require('express');
const path = require('path');
const fs = require('fs');

// Load .env file if it exists (no dependency needed)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch(e) { /* no .env file, that's fine */ }

const app = express();
const PORT = process.env.PORT || 3000;

// Serve client configuration from environment variables
app.get('/config.json', (req, res) => {
  res.json({
    host: process.env.MUD_HOST || '',
    port: parseInt(process.env.MUD_PORT, 10) || 4242,
    wss: process.env.MUD_WSS !== '0',
    gameName: process.env.GAME_NAME || '',
  });
});

// Client version endpoint (no caching so stale tabs always get current version)
app.get('/api/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const versionFile = path.join(__dirname, 'public', 'version.json');
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    res.json(data);
  } catch(e) {
    res.json({ version: 'unknown' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Darkflow listening on port ${PORT}`);
});

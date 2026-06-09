// Minimal .env loader (no dependency), mirroring play.darkwind.ai/server.js.
// Loads mud-test-mcp/.env into process.env without overriding existing vars.
import fs from 'node:fs';

export function loadEnv() {
  const envPath = new URL('../.env', import.meta.url);
  let contents;
  try {
    contents = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env file is fine; rely on the real environment
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

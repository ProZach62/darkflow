// Loads the telnet/GMCP parser. It is CommonJS (module.exports); pull it into
// this ESM package via createRequire.
//
// This package lives inside the Darkflow web client, so it loads the web
// client's parser directly (../../lib/telnet-parser.js) — one source of truth,
// no vendored copy. That file is CommonJS (the web client is a CJS package), so
// require() loads it cleanly from here. Override with TELNET_PARSER_PATH.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const parserPath = process.env.TELNET_PARSER_PATH || '../../lib/telnet-parser.js';

let parser;
try {
  parser = require(parserPath);
} catch (err) {
  throw new Error(
    `Could not load the telnet parser from "${parserPath}": ${err.message}`,
  );
}

export const { makeTelnetParser, wrapGmcp, constants } = parser;

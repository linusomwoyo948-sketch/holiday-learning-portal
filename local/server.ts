// Runs the portal's server (backend/index.ts) on your own computer at http://localhost:8787.
// The website (npm run local) forwards every /api request here.

import { createServer } from 'node:http';
import { handler } from '../backend/index';

const PORT = Number(process.env.PORT) || 8787;

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', async () => {
    const url = new URL(req.url || '/', 'http://localhost');
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
    }
    const result = await handler({
      method: (req.method || 'GET').toUpperCase(),
      rawPath: url.pathname,
      headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    });
    res.writeHead(result.statusCode, result.headers);
    res.end(result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body);
    const tag = result.statusCode >= 400 ? '  <-- ' + result.statusCode : '';
    console.log(req.method + ' ' + url.pathname + tag);
  });
}).listen(PORT, () => {
  console.log('Holiday Learning Portal test server running at http://localhost:' + PORT);
  console.log('Data is saved in local-data.json and files in local-files/. Delete them to start again from empty.');
});

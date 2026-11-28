/**
 * Local helper for the art pipeline: the browser (dev server page) re-encodes generated images to compact WebP at game
 * size and PUTs them here; this writes them under public/art/. Listens on 127.0.0.1 only; refuses paths outside
 * public/art and anything but .webp. Run while converting: node scripts/art-sink.mjs   (Ctrl+C to stop)
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, normalize, resolve, sep } from 'node:path';

const ROOT = resolve('public/art');
const cors = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  const rel = normalize(decodeURIComponent(req.url ?? '').replace(/^\/+/, ''));
  const target = resolve(ROOT, rel);
  if (req.method !== 'PUT' || !target.startsWith(ROOT + sep) || !target.endsWith('.webp')) return res.writeHead(400, cors).end('bad request');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    mkdirSync(dirname(target), { recursive: true });
    const buf = Buffer.concat(chunks);
    writeFileSync(target, buf);
    console.log(`wrote ${rel} (${(buf.length / 1024).toFixed(0)} KB)`);
    res.writeHead(200, cors).end('ok');
  });
}).listen(5174, '127.0.0.1', () => console.log('art sink on http://127.0.0.1:5174 → public/art'));

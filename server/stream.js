import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { catalog } from './catalog.js';
import { redact, upstreamHeaders } from './util.js';

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s || '', 'base64url').toString();

// Some providers serve playlists as text/plain or octet-stream, so fall back to the URL
const isPlaylist = (url, type) =>
  /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(url) || (/^$|text\/plain|octet-stream/i.test(type) && /m3u/i.test(url));

// Point every URI in an HLS playlist back at our proxy. Relative, so sub-path deployments work:
// playlists are always served from /api/play?… or /api/proxy?…, which both resolve to /api/proxy.
function rewritePlaylist(text, base, itemId) {
  const proxied = (u) => {
    const abs = new URL(u, base);
    // Segments often live on a CDN host that never appears in the playlist itself
    catalog.hosts.add(abs.host);
    return `proxy?i=${encodeURIComponent(itemId)}&u=${b64(abs.href)}`;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxied(u)}"`);
      return proxied(t);
    })
    .join('\n');
}

const active = new Set();

async function pipeUpstream(req, res, url, item) {
  const ac = new AbortController();
  const abort = () => ac.abort();
  req.on('close', abort);
  res.on('close', abort);

  const headers = upstreamHeaders(item);
  if (req.headers.range) headers.range = req.headers.range;

  let up;
  try {
    up = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
  } catch (e) {
    if (!res.headersSent && !ac.signal.aborted) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Upstream error: ${e.message}`);
    }
    return;
  }
  try {
    catalog.hosts.add(new URL(up.url).host);
  } catch {}

  const type = up.headers.get('content-type') || '';
  if (up.ok && isPlaylist(up.url || url, type)) {
    const text = await up.text().catch(() => '');
    const body = rewritePlaylist(text, up.url || url, item?.id || '');
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-cache',
    });
    return res.end(body);
  }

  const out = { 'cache-control': 'no-cache', 'access-control-allow-origin': '*' };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h);
    if (v) out[h] = v;
  }
  if (!out['content-type'] || /octet-stream|text\/plain/i.test(out['content-type'])) {
    if (/\.ts(\?|$)/i.test(url) || item?.type === 'live') out['content-type'] = 'video/mp2t';
  }
  res.writeHead(up.status, out);
  if (!up.body || req.method === 'HEAD') return res.end();

  const conn = { item: item?.name, started: Date.now() };
  active.add(conn);
  const body = Readable.fromWeb(up.body);
  body.on('error', () => res.destroy());
  res.on('close', () => {
    active.delete(conn);
    body.destroy();
  });
  body.pipe(res);
}

export const activeStreams = () => active.size;

export function play(req, res, item) {
  return pipeUpstream(req, res, item.url, item);
}

export function proxy(req, res, params) {
  const url = unb64(params.get('u'));
  let host;
  try {
    host = new URL(url).host;
  } catch {
    res.writeHead(400);
    return res.end();
  }
  // Only proxy hosts that appear in the playlist (or that those hosts redirected us to)
  if (!catalog.hosts.has(host)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    return res.end('Host not allowed');
  }
  const item = catalog.items.get(params.get('i') || '');
  return pipeUpstream(req, res, url, item);
}

// Remux through ffmpeg: copies video, converts audio to AAC so browsers can play AC3/EAC3/MP2 streams
export function transcode(req, res, item, params) {
  const start = Number(params.get('t')) || 0;
  const args = ['-hide_banner', '-loglevel', 'error', '-user_agent', item.ua || config.userAgent];
  if (item.referrer) args.push('-headers', `Referer: ${item.referrer}\r\n`);
  if (/^https?:/i.test(item.url)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', item.url, '-map', '0:v:0?', '-map', '0:a:0?');
  if (config.transcodeVideo || params.get('v') === '1') {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '50');
  } else {
    args.push('-c:v', 'copy');
  }
  args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-sn', '-f', 'mpegts', 'pipe:1');

  let ff;
  try {
    ff = spawn(config.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end(`ffmpeg unavailable: ${e.message}`);
  }
  ff.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(`ffmpeg unavailable: ${e.message}`);
    }
  });
  ff.stderr.on('data', (d) => console.warn('[ffmpeg]', redact(String(d).trim())));
  res.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-cache' });
  const conn = { item: item.name, started: Date.now(), transcode: true };
  active.add(conn);
  ff.stdout.pipe(res);
  const kill = () => {
    active.delete(conn);
    ff.kill('SIGKILL');
  };
  req.on('close', kill);
  res.on('close', kill);
  ff.on('close', () => res.end());
}

// Logo / poster proxy with a disk cache: avoids mixed-content and hammering slow logo hosts
const imgDir = () => path.join(config.dataDir, 'cache', 'img');
const failed = new Map();
const inflight = new Map();

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  const head = buf.slice(0, 256).toString().trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  if (buf.slice(4, 12).toString().includes('ftypavif')) return 'image/avif';
  return null;
}

async function download(url, file) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!sniff(buf)) throw new Error('not an image');
  await fs.promises.writeFile(file, buf);
  return buf;
}

export async function image(req, res, url) {
  if (!url || !catalog.logos.has(url)) {
    res.writeHead(404);
    return res.end();
  }
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(imgDir(), key);
  let buf;
  try {
    buf = await fs.promises.readFile(file);
  } catch {
    if ((failed.get(key) || 0) > Date.now()) {
      res.writeHead(404, { 'cache-control': 'max-age=3600' });
      return res.end();
    }
    try {
      let p = inflight.get(key);
      if (!p) {
        p = download(url, file).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      buf = await p;
    } catch {
      failed.set(key, Date.now() + 3600e3);
      res.writeHead(404, { 'cache-control': 'max-age=3600' });
      return res.end();
    }
  }
  res.writeHead(200, {
    'content-type': sniff(buf) || 'application/octet-stream',
    'content-length': buf.length,
    'cache-control': 'public, max-age=604800',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(buf);
}

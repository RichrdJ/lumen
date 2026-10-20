import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { config } from './config.js';

export const hashId = (s, prefix = '') =>
  prefix + crypto.createHash('sha1').update(s).digest('base64url').slice(0, 10);

// Loose key for matching channel names across playlist and EPG ("NPO 1 HD" == "npo1")
export const normName = (s) =>
  (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(hd|fhd|uhd|4k|sd|hevc|h265|h264|backup|raw)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');

export const acceptsGzip = (req) => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

export function sendBody(req, res, body, type, status = 200, headers = {}) {
  const h = { 'content-type': type, ...headers };
  if (body.length > 1024 && acceptsGzip(req)) {
    h['content-encoding'] = 'gzip';
    h.vary = 'accept-encoding';
    body = zlib.gzipSync(body, { level: 6 });
  }
  h['content-length'] = body.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function sendJson(req, res, data, status = 200, headers = {}) {
  sendBody(req, res, Buffer.from(JSON.stringify(data)), 'application/json; charset=utf-8', status, {
    'cache-control': 'no-cache',
    ...headers,
  });
}

export function upstreamHeaders(item, extra = {}) {
  const h = { 'user-agent': item?.ua || config.userAgent, ...extra };
  if (item?.referrer) h.referer = item.referrer;
  return h;
}

export async function fetchText(url, timeoutMs = 120000) {
  const res = await fetch(url, {
    headers: upstreamHeaders(null),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redact(url)}`);
  return res.text();
}

export async function fetchJson(url, timeoutMs = 120000) {
  const text = await fetchText(url, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${redact(url)}`);
  }
}

// Never log credentials
export const redact = (url) =>
  String(url)
    .replace(/(username|password)=[^&]*/gi, '$1=***')
    .replace(/\/(live|movie|series)\/[^/]+\/[^/]+\//, '/$1/***/***/');

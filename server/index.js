import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { catalog, hasSources, loadCached, payload, refreshCatalog, registerItem } from './catalog.js';
import { epg, loadEpg, nowNext, range } from './epg.js';
import { activeStreams, image, play, proxy, transcode } from './stream.js';
import { xtreamSeriesInfo, xtreamVodInfo } from './xtream.js';
import { acceptsGzip, sendJson } from './util.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const vendor = {
  '/vendor/hls.js': path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js'),
  '/vendor/mpegts.js': path.join(root, 'node_modules', 'mpegts.js', 'dist', 'mpegts.js'),
};
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// ---------- helpers ----------

function playback(item) {
  const url = item.url;
  let kind = 'file';
  if (/\.m3u8(\?|$)/i.test(url)) kind = 'hls';
  else if (/\.ts(\?|$)/i.test(url)) kind = 'ts';
  else if (item.type === 'live' && !/\.(mp4|mkv|webm|mov|avi)(\?|$)/i.test(url)) kind = 'ts';
  const direct = config.proxy === 'never';
  return {
    kind,
    src: direct ? url : `api/play?id=${encodeURIComponent(item.id)}`,
    transcode: `api/transcode?id=${encodeURIComponent(item.id)}`,
  };
}

const publicItem = (i) => ({
  id: i.id,
  type: i.type,
  name: i.name,
  logo: i.logo || '',
  group: i.group,
  num: i.num,
  year: i.year,
  rating: i.rating,
  plot: i.plot,
  genre: i.genre,
  season: i.season,
  episode: i.episode,
  duration: i.duration,
  seriesId: i.seriesId,
});

const seriesCache = new Map();

async function seriesDetail(s) {
  if (s.source === 'xtream') {
    const cached = seriesCache.get(s.id);
    if (cached && cached.at > Date.now() - 3600e3) return cached.data;
    const info = await xtreamSeriesInfo(config.xtream, s.xtreamId);
    for (const ep of info.episodes) {
      ep.seriesId = s.id;
      registerItem(ep);
    }
    const data = { ...publicItem(s), ...info, plot: info.plot || s.plot, episodes: info.episodes.map(publicItem) };
    seriesCache.set(s.id, { at: Date.now(), data });
    return data;
  }
  const eps = catalog.episodesBySeries.get(s.id) || [];
  return { ...publicItem(s), episodes: eps.map(publicItem) };
}

let nowCache = { at: 0, data: null };
function epgNow() {
  if (nowCache.data && Date.now() - nowCache.at < 30000 && nowCache.epg === epg.updatedAt) return nowCache.data;
  const data = {};
  const t = Date.now();
  for (const item of catalog.live) {
    const nn = nowNext(item, t);
    if (nn) data[item.id] = nn;
  }
  nowCache = { at: Date.now(), epg: epg.updatedAt, data };
  return data;
}

// ---------- static ----------

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const staticCache = new Map();

function serveStatic(req, res, pathname) {
  let file = vendor[pathname];
  if (!file) {
    file = path.join(publicDir, path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, ''));
    if (!file.startsWith(publicDir)) {
      res.writeHead(403);
      return res.end();
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(publicDir, 'index.html');
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404);
    return res.end();
  }
  const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }
  const type = types[path.extname(file)] || 'application/octet-stream';
  let entry = staticCache.get(file);
  if (!entry || entry.etag !== etag) {
    const raw = fs.readFileSync(file);
    entry = { etag, raw, gz: /text|javascript|json|svg/.test(type) ? zlib.gzipSync(raw) : null };
    staticCache.set(file, entry);
  }
  const headers = { 'content-type': type, etag, 'cache-control': 'no-cache' };
  let body = entry.raw;
  if (entry.gz && acceptsGzip(req)) {
    body = entry.gz;
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------- api ----------

function notFound(req, res) {
  sendJson(req, res, { error: 'Not found' }, 404);
}

async function api(req, res, url) {
  const p = url.pathname.slice(4); // strip "/api"
  const q = url.searchParams;
  const item = () => catalog.items.get(q.get('id') || '');

  if (p === '/status') {
    return sendJson(req, res, {
      name: 'Lumen',
      version,
      configured: hasSources(),
      loading: catalog.loading,
      ready: catalog.updatedAt > 0,
      error: catalog.error,
      updatedAt: catalog.updatedAt,
      counts: { live: catalog.live.length, movie: catalog.movies.length, series: catalog.series.length },
      epg: { channels: epg.channels.size, loading: epg.loading, updatedAt: epg.updatedAt, error: epg.error },
      proxyImages: config.proxyImages,
      streams: activeStreams(),
    });
  }

  const cat = p.match(/^\/catalog\/(live|movie|series)$/);
  if (cat) {
    const pl = payload(cat[1]);
    if (req.headers['if-none-match'] === pl.etag) {
      res.writeHead(304, { etag: pl.etag });
      return res.end();
    }
    const gz = acceptsGzip(req);
    const body = gz ? pl.gz : pl.raw;
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      etag: pl.etag,
      vary: 'accept-encoding',
      'content-length': body.length,
      ...(gz ? { 'content-encoding': 'gzip' } : {}),
    });
    return res.end(body);
  }

  if (p === '/item') {
    const i = item();
    if (!i) return notFound(req, res);
    const out = { ...publicItem(i), ...playback(i) };
    if (i.type === 'movie' && i.source === 'xtream' && config.xtream) {
      if (!i.info) i.info = await xtreamVodInfo(config.xtream, i.xtreamId).catch(() => ({}));
      Object.assign(out, i.info, { year: i.year || i.info.year });
    }
    if (i.type === 'live') out.epg = nowNext(i);
    if (i.type === 'episode' && i.seriesId) {
      const list = (catalog.episodesBySeries.get(i.seriesId) || []).length
        ? catalog.episodesBySeries.get(i.seriesId)
        : (seriesCache.get(i.seriesId)?.data.episodes || []);
      const idx = list.findIndex((e) => e.id === i.id);
      if (idx >= 0 && list[idx + 1]) out.nextId = list[idx + 1].id;
      out.seriesName = catalog.items.get(i.seriesId)?.name;
    }
    return sendJson(req, res, out);
  }

  if (p === '/series') {
    const s = item();
    if (!s || s.type !== 'series') return notFound(req, res);
    try {
      return sendJson(req, res, await seriesDetail(s));
    } catch (e) {
      return sendJson(req, res, { error: e.message }, 502);
    }
  }

  if (p === '/epg/now') return sendJson(req, res, { updatedAt: epg.updatedAt, now: epgNow() });

  if (p === '/epg/range') {
    const from = Number(q.get('from')) || Date.now() - 3600e3;
    const to = Number(q.get('to')) || Date.now() + 6 * 3600e3;
    const out = {};
    for (const id of (q.get('ids') || '').split(',').slice(0, 300)) {
      const i = catalog.items.get(id);
      if (i) out[id] = range(i, from, to);
    }
    return sendJson(req, res, out);
  }

  if (p === '/epg/item') {
    const i = item();
    if (!i) return notFound(req, res);
    return sendJson(req, res, range(i, Date.now() - 2 * 3600e3, Date.now() + 24 * 3600e3, true));
  }

  if (p === '/play') {
    const i = item();
    if (!i) return notFound(req, res);
    if (q.get('fmt') === 'm3u8') {
      if (!/\.ts(\?|$)/i.test(i.url)) return notFound(req, res);
      return play(req, res, { ...i, url: i.url.replace(/\.ts(\?|$)/i, '.m3u8$1') });
    }
    return play(req, res, i);
  }
  if (p === '/proxy') return proxy(req, res, q);
  if (p === '/transcode') {
    const i = item();
    if (!i) return notFound(req, res);
    return transcode(req, res, i, q);
  }
  if (p === '/img') return image(req, res, q.get('u'));

  if (p === '/refresh' && req.method === 'POST') {
    refreshAll();
    return sendJson(req, res, { ok: true });
  }

  return notFound(req, res);
}

// ---------- server ----------

function authorized(req, res) {
  if (!config.auth) return true;
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && token) {
    const [user, ...rest] = Buffer.from(token, 'base64').toString().split(':');
    const a = Buffer.from(`${user}:${rest.join(':')}`);
    const b = Buffer.from(`${config.auth.user}:${config.auth.pass}`);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Lumen", charset="UTF-8"' });
  res.end('Authentication required');
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (!authorized(req, res)) return;
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) sendJson(req, res, { error: e.message }, 500);
    else res.destroy();
  }
});

async function refreshAll() {
  await refreshCatalog();
  await loadEpg(catalog.epgSources);
  nowCache = { at: 0, data: null };
}

server.listen(config.port, async () => {
  console.log(`[lumen] v${version} listening on http://0.0.0.0:${config.port}`);
  if (!hasSources()) {
    console.warn('[lumen] No sources configured. Set M3U_URL, M3U_FILE or XTREAM_URL, or drop a .m3u into the data folder.');
    return;
  }
  const cached = await loadCached();
  if (cached) {
    loadEpg(catalog.epgSources);
    refreshAll();
  } else await refreshAll();
  setInterval(refreshAll, config.refreshHours * 3600e3).unref();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));

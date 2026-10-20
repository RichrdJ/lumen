import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from './config.js';
import { parseM3U, buildSeries } from './m3u.js';
import { loadXtream, xtreamEpgUrl } from './xtream.js';
import { fetchText, redact } from './util.js';

export const catalog = {
  items: new Map(),
  live: [],
  movies: [],
  series: [],
  episodesBySeries: new Map(),
  hosts: new Set(),
  logos: new Set(),
  epgSources: [],
  updatedAt: 0,
  loading: false,
  error: null,
  payloads: new Map(),
};

const cacheFile = () => path.join(config.dataDir, 'catalog.json');

export const hasSources = () => !!(config.m3uUrls.length || config.m3uFiles.length || config.xtream);

function addHost(url) {
  try {
    catalog.hosts.add(new URL(url).host);
  } catch {}
}

export function registerItem(item) {
  catalog.items.set(item.id, item);
  addHost(item.url);
  if (item.logo) catalog.logos.add(item.logo);
}

function apply(data) {
  catalog.items = new Map();
  catalog.hosts = new Set();
  catalog.logos = new Set();
  catalog.episodesBySeries = new Map();
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  };
  catalog.live = dedupe(data.live);
  catalog.movies = dedupe(data.movies);
  catalog.series = dedupe(data.series);
  for (const i of [...catalog.live, ...catalog.movies, ...catalog.series]) registerItem(i);
  for (const ep of dedupe(data.episodes)) {
    registerItem(ep);
    let list = catalog.episodesBySeries.get(ep.seriesId);
    if (!list) catalog.episodesBySeries.set(ep.seriesId, (list = []));
    list.push(ep);
  }
  for (const list of catalog.episodesBySeries.values()) {
    list.sort((a, b) => a.season - b.season || a.episode - b.episode || a.name.localeCompare(b.name));
  }
  if (config.xtream) addHost(config.xtream.url);
  catalog.epgSources = data.epgSources;
  catalog.updatedAt = data.updatedAt;
  catalog.payloads = new Map();
}

async function fetchAll() {
  const live = [];
  const movies = [];
  const episodes = [];
  const series = [];
  const playlistEpg = [];
  const errors = [];

  const m3uTexts = await Promise.all([
    ...config.m3uUrls.map((u, i) =>
      fetchText(u, 180000).then(
        (t) => [`url${i}`, t],
        (e) => (errors.push(`${redact(u)}: ${e.message}`), null),
      ),
    ),
    ...config.m3uFiles.map((f, i) =>
      fs.readFile(f, 'utf8').then(
        (t) => [`file${i}`, t],
        (e) => (errors.push(`${f}: ${e.message}`), null),
      ),
    ),
  ]);
  for (const entry of m3uTexts) {
    if (!entry) continue;
    const { items, epgUrls } = parseM3U(entry[1], entry[0]);
    playlistEpg.push(...epgUrls);
    for (const it of items) {
      if (it.type === 'live') live.push(it);
      else if (it.type === 'movie') movies.push(it);
      else episodes.push(it);
    }
  }
  series.push(...buildSeries(episodes));

  if (config.xtream) {
    try {
      const x = await loadXtream(config.xtream);
      live.push(...x.live);
      movies.push(...x.movies);
      series.push(...x.series);
    } catch (e) {
      errors.push(`xtream: ${e.message}`);
    }
  }

  let epgSources = [...config.epgUrls, ...config.epgFiles];
  if (!epgSources.length) {
    epgSources = [...new Set(playlistEpg)];
    if (config.xtream) epgSources.push(xtreamEpgUrl(config.xtream));
  }

  return { live, movies, series, episodes, epgSources, errors, updatedAt: Date.now() };
}

export async function loadCached() {
  try {
    const data = JSON.parse(await fs.readFile(cacheFile(), 'utf8'));
    apply(data);
    console.log(`[catalog] restored ${catalog.live.length} live, ${catalog.movies.length} movies, ${catalog.series.length} series from cache`);
    return true;
  } catch {
    return false;
  }
}

export async function refreshCatalog() {
  if (catalog.loading) return;
  catalog.loading = true;
  const started = Date.now();
  try {
    const data = await fetchAll();
    const total = data.live.length + data.movies.length + data.series.length;
    catalog.error = data.errors.length ? data.errors.join('; ') : null;
    // Keep the previous catalog if every source failed
    if (total || !catalog.items.size) {
      apply(data);
      await fs.writeFile(cacheFile(), JSON.stringify({ ...data, errors: undefined })).catch(() => {});
    }
    console.log(
      `[catalog] ${data.live.length} live, ${data.movies.length} movies, ${data.series.length} series in ${((Date.now() - started) / 1000).toFixed(1)}s` +
        (catalog.error ? ` (errors: ${catalog.error})` : ''),
    );
  } catch (e) {
    catalog.error = e.message;
    console.error('[catalog]', e);
  } finally {
    catalog.loading = false;
  }
}

function groupsOf(list) {
  const map = new Map();
  for (const i of list) map.set(i.group, (map.get(i.group) || 0) + 1);
  return [...map].map(([name, count]) => ({ name, count }));
}

const strip = (o) => {
  for (const k in o) if (o[k] === undefined || o[k] === '' || o[k] === 0) delete o[k];
  return o;
};

// Compact, client-safe (no stream URLs) payload per section, cached as gzip
export function payload(type) {
  const key = type + catalog.updatedAt;
  let p = catalog.payloads.get(key);
  if (p) return p;
  let items;
  let list;
  if (type === 'live') {
    list = catalog.live;
    items = list.map((i) => strip({ id: i.id, name: i.name, logo: i.logo, group: i.group, num: i.num }));
  } else if (type === 'movie') {
    list = catalog.movies;
    items = list.map((i) =>
      strip({ id: i.id, name: i.name, logo: i.logo, group: i.group, year: i.year, rating: i.rating, added: i.added }),
    );
  } else {
    list = catalog.series;
    items = list.map((i) =>
      strip({
        id: i.id,
        name: i.name,
        logo: i.logo,
        group: i.group,
        year: i.year,
        rating: i.rating,
        added: i.added,
        count: i.episodes?.length,
      }),
    );
  }
  const raw = Buffer.from(JSON.stringify({ updatedAt: catalog.updatedAt, groups: groupsOf(list), items }));
  p = { raw, gz: zlib.gzipSync(raw, { level: 6 }), etag: `"${type}-${catalog.updatedAt}"` };
  catalog.payloads.set(key, p);
  return p;
}

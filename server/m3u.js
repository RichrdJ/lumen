import { hashId } from './util.js';

const ATTR = /([\w-]+)\s*=\s*"([^"]*)"/g;
const EPISODE = /^(.*?)[\s._\-|]*S(\d{1,2})[\s._-]*E(\d{1,3})\b/i;
const VOD_EXT = /\.(mp4|mkv|avi|mov|wmv|webm|m4v|flv|mpg|mpeg)(\?|$)/i;
const SERIES_GROUP = /\b(series|tv shows?|shows)\b/i;

// The title comma is the first comma that is not inside a quoted attribute
function titleComma(line) {
  let quoted = false;
  for (let i = 8; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) return i;
  }
  return -1;
}

function detectType(url, group) {
  if (/\/series\//i.test(url)) return 'episode';
  if (/\/movie\//i.test(url)) return 'movie';
  if (VOD_EXT.test(url)) return SERIES_GROUP.test(group) ? 'episode' : 'movie';
  return 'live';
}

export function parseM3U(text, source) {
  const items = [];
  const epgUrls = [];
  let cur = null;
  let opts = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const m = line.match(/(?:x-tvg-url|url-tvg)\s*=\s*"([^"]+)"/i);
      if (m) epgUrls.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const comma = titleComma(line);
      const head = comma < 0 ? line : line.slice(0, comma);
      const attrs = {};
      for (const m of head.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2].trim();
      const title = comma < 0 ? '' : line.slice(comma + 1).trim();
      cur = { name: title || attrs['tvg-name'] || 'Untitled', attrs };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) {
      if (cur && !cur.attrs['group-title']) cur.attrs['group-title'] = line.slice(8).trim();
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const [k, ...v] = line.slice(11).split('=');
      opts[k.trim().toLowerCase()] = v.join('=').trim();
      continue;
    }
    if (line.startsWith('#')) continue;

    const url = line;
    const a = cur?.attrs || {};
    const group = a['group-title'] || 'Uncategorized';
    const type = detectType(url, group);
    const item = {
      id: hashId(url, type === 'live' ? 'l' : type === 'movie' ? 'm' : 'e'),
      type,
      name: cur?.name || url.split('/').pop(),
      logo: a['tvg-logo'] || a.logo || '',
      group,
      url,
      tvgId: a['tvg-id'] || '',
      tvgName: a['tvg-name'] || '',
      tvgCountry: a['tvg-country'] || '',
      num: Number(a['tvg-chno'] || a['channel-number']) || 0,
      ua: opts['http-user-agent'] || a['user-agent'] || '',
      referrer: opts['http-referrer'] || opts['http-referer'] || '',
      source,
    };
    if (type === 'movie') {
      const y = item.name.match(/[([]((?:19|20)\d{2})[)\]]/);
      if (y) item.year = Number(y[1]);
    }
    if (type === 'episode') {
      const m = item.name.match(EPISODE);
      item.seriesName = (m ? m[1] : item.name).replace(/[\s._\-|]+$/, '').trim() || item.name;
      item.season = m ? Number(m[2]) : 1;
      item.episode = m ? Number(m[3]) : 0;
      if (m) item.name = item.name.slice(m[0].length).replace(/^[\s._\-|:]+/, '').trim() || `Episode ${item.episode}`;
    }
    items.push(item);
    cur = null;
    opts = {};
  }

  return { items, epgUrls };
}

// Group loose episodes from an M3U into series entries
export function buildSeries(episodes) {
  const map = new Map();
  for (const ep of episodes) {
    const key = ep.group + '\u0000' + ep.seriesName;
    let s = map.get(key);
    if (!s) {
      s = {
        id: hashId(key, 's'),
        type: 'series',
        name: ep.seriesName,
        logo: ep.logo,
        group: ep.group,
        episodes: [],
        source: ep.source,
      };
      map.set(key, s);
    }
    ep.seriesId = s.id;
    s.episodes.push(ep.id);
  }
  return [...map.values()];
}

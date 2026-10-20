import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import sax from 'sax';
import { config } from './config.js';
import { normName, redact, upstreamHeaders } from './util.js';

// Programmes are stored as compact tuples: [start, stop, title, subtitle, description]
export const epg = {
  channels: new Map(), // epg channel id -> programmes (sorted by start)
  ids: new Map(), // lowercased epg id -> epg id
  names: new Map(), // normalized display name -> epg id
  resolved: new Map(), // catalog item id -> epg id | null
  updatedAt: 0,
  loading: false,
  error: null,
};

const TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2}):?(\d{2}))?/;

function parseTime(s) {
  const m = TIME.exec(s || '');
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) return t;
  const off = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1);
  return t - off * 60000;
}

async function openSource(src) {
  let stream;
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { headers: upstreamHeaders(null), redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    stream = Readable.fromWeb(res.body);
  } else {
    stream = fs.createReadStream(src);
  }
  // Sniff gzip magic bytes so both .xml and .xml.gz (with or without proper headers) work
  const it = stream[Symbol.asyncIterator]();
  const first = await it.next();
  const head = first.value;
  const gz = head && head[0] === 0x1f && head[1] === 0x8b;
  const body = Readable.from(
    (async function* () {
      if (!first.done) yield head;
      for (;;) {
        const n = await it.next();
        if (n.done) return;
        yield n.value;
      }
    })(),
    { objectMode: false },
  );
  if (!gz) return body;
  const gunzip = zlib.createGunzip();
  body.on('error', (e) => gunzip.destroy(e));
  return body.pipe(gunzip);
}

function parseInto(stream, channels, names, from, to) {
  return new Promise((resolve, reject) => {
    const p = sax.createStream(false, { lowercase: true, trim: true });
    let prog = null;
    let chan = null;
    let field = null;
    let text = '';

    p.on('opentag', (n) => {
      const a = n.attributes;
      if (n.name === 'programme') {
        prog = { ch: a.channel, start: parseTime(a.start), stop: parseTime(a.stop), title: '', sub: '', desc: '' };
      } else if (n.name === 'channel') {
        chan = { id: a.id, names: [] };
      } else if (prog && (n.name === 'title' || n.name === 'sub-title' || n.name === 'desc')) {
        field = n.name;
        text = '';
      } else if (chan && n.name === 'display-name') {
        field = n.name;
        text = '';
      }
    });
    const onText = (t) => {
      if (field) text += t;
    };
    p.on('text', onText);
    p.on('cdata', onText);
    p.on('closetag', (name) => {
      if (field && name === field) {
        if (prog) {
          if (field === 'title' && !prog.title) prog.title = text;
          else if (field === 'sub-title' && !prog.sub) prog.sub = text;
          else if (field === 'desc' && !prog.desc) prog.desc = text.length > 600 ? text.slice(0, 597) + '…' : text;
        } else if (chan) chan.names.push(text);
        field = null;
      } else if (name === 'programme' && prog) {
        const { ch, start } = prog;
        let { stop } = prog;
        if (ch && !Number.isNaN(start)) {
          if (Number.isNaN(stop)) stop = start; // fixed up after sorting
          if ((stop === start || stop > from) && start < to) {
            let list = channels.get(ch);
            if (!list) channels.set(ch, (list = []));
            list.push([start, stop, prog.title, prog.sub, prog.desc]);
          }
        }
        prog = null;
      } else if (name === 'channel' && chan) {
        if (chan.id) {
          if (!channels.has(chan.id)) channels.set(chan.id, []);
          for (const n of chan.names) {
            const k = normName(n);
            if (k && !names.has(k)) names.set(k, chan.id);
          }
        }
        chan = null;
      }
    });
    p.on('error', function () {
      // Loose mode: skip malformed bits and keep going
      this._parser.error = null;
      this._parser.resume();
    });
    p.on('end', resolve);
    stream.on('error', reject);
    stream.pipe(p);
  });
}

export async function loadEpg(sources) {
  if (epg.loading) return;
  if (!sources.length) {
    epg.channels = new Map();
    epg.names = new Map();
    epg.ids = new Map();
    epg.resolved = new Map();
    epg.updatedAt = 0;
    return;
  }
  epg.loading = true;
  epg.error = null;
  const started = Date.now();
  const now = Date.now();
  const from = now - config.epgPastHours * 3600e3;
  const to = now + config.epgFutureHours * 3600e3;
  const channels = new Map();
  const names = new Map();
  const errors = [];

  for (const src of sources) {
    try {
      const stream = await openSource(src);
      await parseInto(stream, channels, names, from, to);
    } catch (e) {
      errors.push(`${redact(src)}: ${e.message}`);
    }
  }

  let programmes = 0;
  for (const [id, list] of channels) {
    list.sort((a, b) => a[0] - b[0]);
    const clean = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p[1] <= p[0]) p[1] = list[i + 1]?.[0] ?? p[0] + 3600e3;
      const prev = clean[clean.length - 1];
      if (prev && prev[0] === p[0]) continue; // duplicate from a second source
      if (p[1] > from) clean.push(p);
    }
    channels.set(id, clean);
    programmes += clean.length;
  }

  if (channels.size || !epg.channels.size) {
    epg.channels = channels;
    epg.names = names;
    epg.ids = new Map([...channels.keys()].map((k) => [k.toLowerCase(), k]));
    epg.resolved = new Map();
    epg.updatedAt = Date.now();
  }
  epg.error = errors.length ? errors.join('; ') : null;
  epg.loading = false;
  console.log(
    `[epg] ${channels.size} channels, ${programmes} programmes in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (errors.length ? ` (errors: ${epg.error})` : ''),
  );
}

export function epgIdFor(item) {
  if (epg.resolved.has(item.id)) return epg.resolved.get(item.id);
  let id = null;
  if (item.tvgId) id = epg.channels.has(item.tvgId) ? item.tvgId : epg.ids.get(item.tvgId.toLowerCase()) || null;
  if (!id) id = epg.names.get(normName(item.tvgName)) || epg.names.get(normName(item.name)) || null;
  epg.resolved.set(item.id, id);
  return id;
}

function firstEnding(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][1] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nowNext(item, t = Date.now()) {
  const id = epgIdFor(item);
  const list = id && epg.channels.get(id);
  if (!list?.length) return null;
  const i = firstEnding(list, t);
  const cur = list[i] && list[i][0] <= t ? list[i] : null;
  const next = cur ? list[i + 1] : list[i];
  if (!cur && !next) return null;
  return [cur ? cur.slice(0, 3) : null, next ? next.slice(0, 3) : null];
}

export function range(item, from, to, full = false) {
  const id = epgIdFor(item);
  const list = id && epg.channels.get(id);
  if (!list?.length) return [];
  const out = [];
  for (let i = firstEnding(list, from); i < list.length && list[i][0] < to; i++) {
    out.push(full ? list[i] : list[i].slice(0, 3));
  }
  return out;
}

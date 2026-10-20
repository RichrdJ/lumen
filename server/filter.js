// Country detection for playlist entries plus the user's visibility filter.

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const isRegion = (code) => {
  try {
    return regions.of(code) !== code;
  } catch {
    return false;
  }
};

// Codes providers use that aren't ISO, or that look like countries but usually aren't
const ALIASES = { UK: 'UK', GB: 'UK', EN: 'UK', ENG: 'UK', GBR: 'UK', USA: 'US', NLD: 'NL', HOL: 'NL', DEU: 'DE', GER: 'DE', FRA: 'FR', ESP: 'ES', ITA: 'IT', POR: 'PT', PRT: 'PT', BEL: 'BE', TUR: 'TR', POL: 'PL', SWE: 'SE', NOR: 'NO', DNK: 'DK', DEN: 'DK', FIN: 'FI', IRL: 'IE', CAN: 'CA', AUS: 'AU', BRA: 'BR', MEX: 'MX', ARG: 'AR', GRE: 'GR', GRC: 'GR', ROU: 'RO', ROM: 'RO', ALB: 'AL', IND: 'IN', PAK: 'PK', AUT: 'AT', SUI: 'CH', CHE: 'CH', RUS: 'RU', UKR: 'UA', CZE: 'CZ', SVK: 'SK', HUN: 'HU', BUL: 'BG', SRB: 'RS', CRO: 'HR', HRV: 'HR', SLO: 'SI', BIH: 'BA', MKD: 'MK', ISR: 'IL', IRN: 'IR', IRQ: 'IQ', KSA: 'SA', UAE: 'AE', EGY: 'EG', MAR: 'MA', TUN: 'TN', ALG: 'DZ', DZA: 'DZ', AFR: null, ARA: null, ARB: null, LAT: null, VIP: null, EXYU: null };
const NOT_COUNTRIES = new Set(['TV', 'FM', 'MY', 'TO', 'BY', 'IS', 'ON', 'OR', 'AM', 'PM', 'DO', 'GO', 'ME', 'SO']);
const NAMES = {
  'UNITED KINGDOM': 'UK', BRITAIN: 'UK', BRITISH: 'UK', ENGLAND: 'UK', SCOTLAND: 'UK',
  NETHERLANDS: 'NL', NEDERLAND: 'NL', HOLLAND: 'NL', DUTCH: 'NL',
  BELGIUM: 'BE', BELGIE: 'BE', 'BELGIË': 'BE', VLAANDEREN: 'BE',
  GERMANY: 'DE', DEUTSCHLAND: 'DE', GERMAN: 'DE', FRANCE: 'FR', FRENCH: 'FR', SPAIN: 'ES', ESPANA: 'ES', SPANISH: 'ES',
  ITALY: 'IT', ITALIA: 'IT', ITALIAN: 'IT', PORTUGAL: 'PT', TURKEY: 'TR', TURKIYE: 'TR', TURKISH: 'TR', POLAND: 'PL', POLSKA: 'PL',
  SWEDEN: 'SE', NORWAY: 'NO', DENMARK: 'DK', FINLAND: 'FI', IRELAND: 'IE', 'UNITED STATES': 'US', AMERICA: 'US',
  CANADA: 'CA', AUSTRALIA: 'AU', BRAZIL: 'BR', MEXICO: 'MX', GREECE: 'GR', ROMANIA: 'RO', ALBANIA: 'AL', INDIA: 'IN',
  AUSTRIA: 'AT', SWITZERLAND: 'CH', RUSSIA: 'RU', UKRAINE: 'UA', ARABIC: null,
};
const nameRe = (names) =>
  new RegExp(`(^|[^A-Z])(${Object.keys(names).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^A-Z]|$)`);
const NAME_RE = nameRe(NAMES);

// Every English country name ("Afghanistan", "South Korea", …) for matching group titles
const ALL_NAMES = { ...NAMES };
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b);
    if (!isRegion(c) || !/^[A-Z]{2}$/.test(c)) continue;
    const n = regions.of(c).toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (!(n in ALL_NAMES) && !/[^A-Z .&'-]/.test(n)) ALL_NAMES[n] = c === 'GB' ? 'UK' : c;
  }
}
delete ALL_NAMES.WORLD;
const ALL_NAME_RE = nameRe(ALL_NAMES);

function code(raw, strict) {
  const c = raw.toUpperCase();
  if (c in ALIASES) return ALIASES[c];
  if (c.length !== 2 || !isRegion(c)) return null;
  // Short words like "IT" or "US" only count when clearly used as a prefix tag
  if (strict && NOT_COUNTRIES.has(c)) return null;
  return c;
}

// "UK: BBC One", "NL | Sport", "[DE] ZDF", "|FR| TF1", "UK - Sports", "NL-Film"
const PREFIX = /^[\s​-‍⁠﻿]*[[(|｜│┃ǀ¦‖]?\s*([A-Za-z]{2,4})\s*(?:[\])|｜│┃ǀ¦‖:：]|\s[|｜│┃ǀ¦‖\-–—]\s|-(?=[A-Za-z]))/;

function fromText(text, allNames = false) {
  if (!text) return null;
  const m = PREFIX.exec(text);
  if (m) {
    const strictSep = /[:：|｜│┃ǀ¦‖\])]/.test(m[0]);
    const c = code(m[1], !strictSep);
    if (c) return c;
  }
  const upper = text.toUpperCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const n = (allNames ? ALL_NAME_RE : NAME_RE).exec(upper);
  return n ? (allNames ? ALL_NAMES : NAMES)[n[2]] : null;
}

// Leading country tags in titles: "| NL | ESPN 1", "NL: NPO 1", "[UK] BBC One", "DE - ZDF", "FR-TF1"
// Providers use look-alike bars (┃ ｜ │ ǀ ¦) and invisible characters, so match those too
const BARS = '|｜│┃ǀ¦‖';
const TAG = new RegExp(
  `^[\\s\\u200b-\\u200d\\u2060\\ufeff]*(?:[${BARS}[(]\\s*)?([A-Za-z]{2,4})(\\s*[${BARS}\\])]|\\s*[:：]|\\s+[${BARS}\\-–—]\\s+|-(?=\\s*\\S))[\\s\\u200b-\\u200d\\u2060\\ufeff]*`,
);
const LEAD = new RegExp(`^[\\s\\u200b-\\u200d\\u2060\\ufeff${BARS}:：\\-–—]+`);

export function cleanName(name) {
  let out = name;
  for (let i = 0; i < 3; i++) {
    const m = TAG.exec(out);
    // A dash separator is ambiguous ("TV - Live"), so only well-known codes count there
    if (!m || !code(m[1], /-|–/.test(m[2]))) break;
    out = out.slice(m[0].length).replace(LEAD, '');
  }
  return out.trim() || name;
}

export function countryOf(item) {
  const tc = (item.tvgCountry || '').split(/[,;|\s]/)[0];
  if (tc) {
    const c = code(tc, false);
    if (c) return c;
  }
  // The group ("UK | Sports", "Netherlands") is how the playlist author sorted things,
  // so it wins over tvg-id, which names the broadcaster's home country
  const g = fromText(item.group, true);
  if (g) return g;
  // tvg-id like "BBCOne.uk" or "NPO1.nl@SD"
  const id = /\.([a-z]{2})(?:@|$)/i.exec(item.tvgId || '');
  if (id) {
    const c = code(id[1], false);
    if (c) return c;
  }
  return fromText(item.name) || null;
}

const groupKey = (type, group) => `${type === 'episode' ? 'series' : type}:${group}`;
export { groupKey };

export function makeFilter(f) {
  const countries = new Set(f.countries || []);
  const hidden = new Set(f.hiddenGroups || []);
  const words = (f.excludeWords || []).map((w) => w.toLowerCase()).filter(Boolean);
  return (item) => {
    if (f.scope === 'live' && item.type !== 'live') return true;
    if (hidden.has(groupKey(item.type, item.group))) return false;
    if (words.length) {
      const text = `${item.name} ${item.group}`.toLowerCase();
      if (words.some((w) => text.includes(w))) return false;
    }
    if (countries.size && !countries.has(item.country)) return false;
    return true;
  };
}

// Applies the filter to a full catalog snapshot; episodes follow their series
export function applyFilter(data, f) {
  const keep = makeFilter(f);
  const series = data.series.filter(keep);
  const ids = new Set(series.map((s) => s.id));
  return {
    ...data,
    live: data.live.filter(keep),
    movies: data.movies.filter(keep),
    series,
    episodes: data.episodes.filter((e) => ids.has(e.seriesId)),
  };
}

// Countries and groups with counts, for the settings screen
export function facets(data) {
  const countries = new Map();
  const groups = new Map();
  const add = (type, item) => {
    const c = item.country || '';
    let e = countries.get(c);
    if (!e) countries.set(c, (e = { code: c, live: 0, movie: 0, series: 0 }));
    e[type]++;
    const k = groupKey(type, item.group);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { key: k, type, name: item.group, count: 0, countries: {} }));
    g.count++;
    g.countries[c] = (g.countries[c] || 0) + 1;
  };
  data.live.forEach((i) => add('live', i));
  data.movies.forEach((i) => add('movie', i));
  data.series.forEach((i) => add('series', i));
  return {
    countries: [...countries.values()]
      .map((c) => ({ ...c, name: c.code ? (c.code === 'UK' ? 'United Kingdom' : regions.of(c.code)) : 'No country detected' }))
      .sort((a, b) => b.live + b.movie + b.series - (a.live + a.movie + a.series)),
    groups: [...groups.values()].map((g) => {
      const top = Object.entries(g.countries).sort((a, b) => b[1] - a[1])[0];
      return { key: g.key, type: g.type, name: g.name, count: g.count, country: top?.[0] || '' };
    }),
  };
}

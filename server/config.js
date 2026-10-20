import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Settings come from /data/settings.json (edited in the app). Environment variables
// are only used as defaults, so existing compose files keep working.

const env = process.env;
const list = (v) => (Array.isArray(v) ? v : (v || '').split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean);
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() !== 'false');

const dataDir = path.resolve(env.DATA_DIR || 'data');
fs.mkdirSync(path.join(dataDir, 'cache', 'img'), { recursive: true });
const settingsFile = path.join(dataDir, 'settings.json');

const defaults = {
  m3uUrls: list(env.M3U_URL),
  m3uFiles: list(env.M3U_FILE),
  xtreamUrl: env.XTREAM_URL || '',
  xtreamUser: env.XTREAM_USER || '',
  xtreamPass: env.XTREAM_PASS || '',
  xtreamLiveFormat: env.XTREAM_LIVE_FORMAT || 'ts',
  epgUrls: list(env.EPG_URL),
  epgFiles: list(env.EPG_FILE),
  refreshHours: Number(env.REFRESH_HOURS) || 12,
  proxy: (env.PROXY || 'always').toLowerCase(),
  proxyImages: bool(env.PROXY_IMAGES, true),
  userAgent: env.USER_AGENT || 'VLC/3.0.21 LibVLC/3.0.21',
  transcodeVideo: bool(env.TRANSCODE_VIDEO, false),
  authUser: env.AUTH_USER || '',
  authPass: env.AUTH_PASS || '',
  authHash: '',
  filter: {
    countries: list(env.FILTER_COUNTRIES).map((c) => c.toUpperCase()),
    keepUnknown: bool(env.FILTER_KEEP_UNKNOWN, true),
    hiddenGroups: [],
    excludeWords: list(env.FILTER_EXCLUDE),
    scope: 'all', // all | live
  },
};

function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return {};
  }
}

let saved = readSaved();

export const config = {
  port: Number(env.PORT) || 8080,
  dataDir,
  ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
  epgPastHours: Number(env.EPG_PAST_HOURS) || 3,
  epgFutureHours: Number(env.EPG_FUTURE_HOURS) || 36,
};

function derive() {
  const s = { ...defaults, ...saved, filter: { ...defaults.filter, ...(saved.filter || {}) } };
  config.settings = s;
  config.m3uUrls = list(s.m3uUrls);
  config.epgUrls = list(s.epgUrls);
  config.xtream = s.xtreamUrl
    ? { url: s.xtreamUrl.replace(/\/+$/, ''), user: s.xtreamUser, pass: s.xtreamPass, liveFormat: s.xtreamLiveFormat || 'ts' }
    : null;
  config.refreshHours = Math.max(1, Number(s.refreshHours) || 12);
  config.proxy = s.proxy === 'never' ? 'never' : 'always';
  config.proxyImages = !!s.proxyImages;
  config.userAgent = s.userAgent || defaults.userAgent;
  config.transcodeVideo = !!s.transcodeVideo;
  config.auth = s.authUser && (s.authHash || s.authPass) ? { user: s.authUser, pass: s.authPass, hash: s.authHash } : null;
}
derive();

// Files dropped into the data dir are picked up automatically
function scan(re) {
  try {
    return fs.readdirSync(dataDir).filter((f) => re.test(f)).map((f) => path.join(dataDir, f));
  } catch {
    return [];
  }
}
export const m3uFiles = () => (config.settings.m3uFiles.length ? config.settings.m3uFiles : scan(/\.m3u8?$/i));
export const epgFiles = () => (config.settings.epgFiles.length ? config.settings.epgFiles : scan(/\.xml(\.gz)?$/i));

// ---------- auth ----------

const hashPass = (pass, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pass, salt, 32).toString('hex')}`;

export function checkPassword(user, pass) {
  const a = config.auth;
  if (!a || user !== a.user) return false;
  if (a.hash) {
    const [salt, h] = a.hash.split(':');
    const got = Buffer.from(hashPass(pass, salt).split(':')[1], 'hex');
    const want = Buffer.from(h, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  const got = Buffer.from(pass);
  const want = Buffer.from(a.pass);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------- settings api ----------

const SOURCE_KEYS = ['m3uUrls', 'm3uFiles', 'xtreamUrl', 'xtreamUser', 'xtreamPass', 'xtreamLiveFormat', 'epgUrls', 'epgFiles', 'userAgent'];
const PLAIN_KEYS = [...SOURCE_KEYS, 'refreshHours', 'proxy', 'proxyImages', 'transcodeVideo', 'authUser'];

// Secrets never leave the server; the UI only learns whether one is set
export function publicSettings() {
  const s = config.settings;
  const out = {};
  for (const k of PLAIN_KEYS) out[k] = s[k];
  delete out.xtreamPass;
  out.hasXtreamPass = !!s.xtreamPass;
  out.hasAuthPass = !!(s.authHash || s.authPass);
  out.filter = s.filter;
  out.detectedFiles = { m3u: m3uFiles().map((f) => path.basename(f)), epg: epgFiles().map((f) => path.basename(f)) };
  return out;
}

// Secret fields: undefined or '' keeps the current value, null clears it
export function saveSettings(patch) {
  const before = JSON.stringify(SOURCE_KEYS.map((k) => config.settings[k]));
  const beforeFilter = JSON.stringify(config.settings.filter);
  const next = { ...saved };
  for (const k of PLAIN_KEYS) {
    if (k === 'xtreamPass' || !(k in patch)) continue;
    next[k] = ['m3uUrls', 'm3uFiles', 'epgUrls', 'epgFiles'].includes(k) ? list(patch[k]) : patch[k];
  }
  if (patch.xtreamPass === null) next.xtreamPass = '';
  else if (patch.xtreamPass) next.xtreamPass = String(patch.xtreamPass);
  if (patch.authPass === null || patch.authUser === '') {
    next.authHash = '';
    next.authPass = '';
    next.authUser = '';
  } else if (patch.authPass) {
    next.authHash = hashPass(String(patch.authPass));
    next.authPass = '';
  }
  if (patch.filter) {
    const f = patch.filter;
    next.filter = {
      countries: list(f.countries).map((c) => c.toUpperCase()),
      keepUnknown: !!f.keepUnknown,
      hiddenGroups: Array.isArray(f.hiddenGroups) ? f.hiddenGroups.map(String) : [],
      excludeWords: list(f.excludeWords),
      scope: f.scope === 'live' ? 'live' : 'all',
    };
  }
  saved = next;
  fs.writeFileSync(settingsFile, JSON.stringify(saved, null, 2));
  derive();
  return {
    sourcesChanged: before !== JSON.stringify(SOURCE_KEYS.map((k) => config.settings[k])),
    filterChanged: beforeFilter !== JSON.stringify(config.settings.filter),
  };
}

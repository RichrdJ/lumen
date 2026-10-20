import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const list = (v) => (v || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

const dataDir = path.resolve(env.DATA_DIR || 'data');
fs.mkdirSync(path.join(dataDir, 'cache', 'img'), { recursive: true });

// Files dropped into the data dir are picked up automatically.
function scan(re) {
  try {
    return fs.readdirSync(dataDir).filter((f) => re.test(f)).map((f) => path.join(dataDir, f));
  } catch {
    return [];
  }
}

const m3uFiles = list(env.M3U_FILE);
const epgFiles = list(env.EPG_FILE);

export const config = {
  port: Number(env.PORT) || 8080,
  dataDir,
  m3uUrls: list(env.M3U_URL),
  m3uFiles: m3uFiles.length ? m3uFiles : scan(/\.m3u8?$/i),
  xtream: env.XTREAM_URL
    ? {
        url: env.XTREAM_URL.replace(/\/+$/, ''),
        user: env.XTREAM_USER || '',
        pass: env.XTREAM_PASS || '',
        liveFormat: env.XTREAM_LIVE_FORMAT || 'ts',
      }
    : null,
  epgUrls: list(env.EPG_URL),
  epgFiles: epgFiles.length ? epgFiles : scan(/\.xml(\.gz)?$/i),
  epgPastHours: Number(env.EPG_PAST_HOURS) || 3,
  epgFutureHours: Number(env.EPG_FUTURE_HOURS) || 36,
  refreshHours: Number(env.REFRESH_HOURS) || 12,
  // always: stream through the server (fixes CORS / mixed content); never: play upstream URLs directly
  proxy: (env.PROXY || 'always').toLowerCase(),
  proxyImages: (env.PROXY_IMAGES || 'true').toLowerCase() !== 'false',
  userAgent: env.USER_AGENT || 'VLC/3.0.21 LibVLC/3.0.21',
  ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
  transcodeVideo: (env.TRANSCODE_VIDEO || 'false').toLowerCase() === 'true',
  auth: env.AUTH_USER && env.AUTH_PASS ? { user: env.AUTH_USER, pass: env.AUTH_PASS } : null,
};

import { fetchJson } from './util.js';

const enc = encodeURIComponent;

function api(x, action, extra = '') {
  return fetchJson(
    `${x.url}/player_api.php?username=${enc(x.user)}&password=${enc(x.pass)}&action=${action}${extra}`,
  );
}

const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

export const xtreamEpgUrl = (x) => `${x.url}/xmltv.php?username=${enc(x.user)}&password=${enc(x.pass)}`;

export async function loadXtream(x) {
  const safe = (p) => p.catch((e) => (console.warn('[xtream]', e.message), []));
  const [lc, ls, vc, vs, sc, ss] = await Promise.all([
    safe(api(x, 'get_live_categories')),
    safe(api(x, 'get_live_streams')),
    safe(api(x, 'get_vod_categories')),
    safe(api(x, 'get_vod_streams')),
    safe(api(x, 'get_series_categories')),
    safe(api(x, 'get_series')),
  ]);
  const cats = (list) => new Map(arr(list).map((c) => [String(c.category_id), c.category_name]));
  const liveCats = cats(lc);
  const vodCats = cats(vc);
  const seriesCats = cats(sc);
  const u = enc(x.user);
  const p = enc(x.pass);

  const live = arr(ls).map((s) => ({
    id: 'xl' + s.stream_id,
    type: 'live',
    name: s.name || 'Channel',
    logo: s.stream_icon || '',
    group: liveCats.get(String(s.category_id)) || 'Uncategorized',
    url: `${x.url}/live/${u}/${p}/${s.stream_id}.${x.liveFormat}`,
    tvgId: s.epg_channel_id || '',
    tvgName: '',
    num: num(s.num),
    source: 'xtream',
  }));

  const movies = arr(vs).map((s) => ({
    id: 'xm' + s.stream_id,
    type: 'movie',
    name: s.name || 'Movie',
    logo: s.stream_icon || '',
    group: vodCats.get(String(s.category_id)) || 'Movies',
    url: `${x.url}/movie/${u}/${p}/${s.stream_id}.${s.container_extension || 'mp4'}`,
    rating: num(s.rating),
    year: num(s.year) || undefined,
    added: num(s.added),
    xtreamId: s.stream_id,
    source: 'xtream',
  }));

  const series = arr(ss).map((s) => ({
    id: 'xs' + s.series_id,
    type: 'series',
    name: s.name || 'Series',
    logo: s.cover || '',
    group: seriesCats.get(String(s.category_id)) || 'Series',
    plot: s.plot || '',
    genre: s.genre || '',
    year: num(String(s.releaseDate || s.release_date || '').slice(0, 4)) || undefined,
    rating: num(s.rating),
    backdrop: arr(s.backdrop_path)[0] || '',
    added: num(s.last_modified),
    xtreamId: s.series_id,
    source: 'xtream',
  }));

  return { live, movies, series };
}

export async function xtreamSeriesInfo(x, seriesId) {
  const data = await api(x, 'get_series_info', `&series_id=${enc(seriesId)}`);
  const u = enc(x.user);
  const p = enc(x.pass);
  const episodes = [];
  for (const [season, list] of Object.entries(data?.episodes || {})) {
    for (const e of arr(list)) {
      episodes.push({
        id: 'xe' + e.id,
        type: 'episode',
        name: e.title || `Episode ${e.episode_num}`,
        logo: e.info?.movie_image || '',
        season: num(e.season) || num(season),
        episode: num(e.episode_num),
        plot: e.info?.plot || '',
        duration: num(e.info?.duration_secs),
        url: `${x.url}/series/${u}/${p}/${e.id}.${e.container_extension || 'mp4'}`,
        source: 'xtream',
      });
    }
  }
  episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const info = data?.info || {};
  return {
    plot: info.plot || '',
    genre: info.genre || '',
    cast: info.cast || '',
    backdrop: arr(info.backdrop_path)[0] || '',
    episodes,
  };
}

export async function xtreamVodInfo(x, vodId) {
  const data = await api(x, 'get_vod_info', `&vod_id=${enc(vodId)}`);
  const info = data?.info || {};
  return {
    plot: info.plot || info.description || '',
    genre: info.genre || '',
    cast: info.cast || info.actors || '',
    director: info.director || '',
    duration: num(info.duration_secs),
    year: num(String(info.releasedate || info.release_date || '').slice(0, 4)) || undefined,
    backdrop: arr(info.backdrop_path)[0] || '',
    trailer: info.youtube_trailer || '',
  };
}

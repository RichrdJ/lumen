import { $, $$, api, clock, debounce, el, esc, hue, icon, initials, minutes, spatialMove, store, toast, VirtualGrid } from './lib.js';
import { Player } from './player.js';
import { viewSettings } from './settings.js';

const state = {
  status: null,
  sections: {},
  loaded: {},
  byId: new Map(),
  epgNow: {},
  cleanup: [],
  onEpg: null,
  zapContext: null,
  routeToken: 0,
};

const img = (u) => (!u ? '' : state.status?.proxyImages ? `api/img?u=${encodeURIComponent(u)}` : u);
const epgFor = (id) => state.epgNow[id];
const TYPE_LABEL = { live: 'Live TV', movie: 'Movies', series: 'Series' };

// ---------- data ----------

function section(type) {
  state.sections[type] ||= api(`api/catalog/${type}`).then((data) => {
    data.byGroup = new Map();
    for (const i of data.items) {
      i.type = type;
      i.key = i.name.toLowerCase();
      state.byId.set(i.id, i);
      let list = data.byGroup.get(i.group);
      if (!list) data.byGroup.set(i.group, (list = []));
      list.push(i);
    }
    state.loaded[type] = data;
    return data;
  });
  return state.sections[type].catch((e) => {
    delete state.sections[type];
    throw e;
  });
}

async function refreshEpg() {
  if (!state.status?.counts.live) return;
  try {
    const r = await api('api/epg/now');
    state.epgNow = r.now || {};
    state.onEpg?.();
  } catch {}
}

// ---------- building blocks ----------

function art(item, cls = '') {
  const pic = item.logo ? `<img src="${esc(img(item.logo))}" alt="" loading="lazy" decoding="async">` : '';
  return `<span class="art ${cls}" style="--h:${hue(item.name)}">${pic}<span class="initials">${esc(initials(item.name))}</span></span>`;
}

function liveProgress(id) {
  const cur = epgFor(id)?.[0];
  if (!cur) return { cur: null, pct: 0 };
  return { cur, pct: Math.max(0, Math.min(100, ((Date.now() - cur[0]) / (cur[1] - cur[0])) * 100)) };
}

function favBadge(id) {
  return store.isFav(id) ? `<span class="fav-badge">${icon.heart}</span>` : '';
}

function channelCard(c) {
  const { cur, pct } = liveProgress(c.id);
  return `<button class="card card-ch focusable" data-play="${esc(c.id)}" title="${esc(c.name)}">
    <span class="card-frame">${art(c, 'art-logo')}${favBadge(c.id)}
      ${cur ? `<span class="card-progress"><i style="width:${pct}%"></i></span>` : ''}</span>
    <span class="card-meta"><span class="card-title">${c.num ? `<em>${c.num}</em>` : ''}${esc(c.name)}</span>
    <span class="card-sub">${cur ? esc(cur[2]) : '&nbsp;'}</span></span></button>`;
}

function posterCard(m) {
  const p = store.progress[m.id];
  const sub = [m.year, m.rating ? `★ ${Number(m.rating).toFixed(1)}` : '', m.count ? `${m.count} episodes` : '']
    .filter(Boolean)
    .join(' · ');
  return `<button class="card card-poster focusable" data-open="${esc(m.id)}" title="${esc(m.name)}">
    <span class="card-frame">${art(m, 'art-cover')}${favBadge(m.id)}
      ${p ? `<span class="card-progress"><i style="width:${(p.pos / p.dur) * 100}%"></i></span>` : ''}</span>
    <span class="card-meta"><span class="card-title">${esc(m.name)}</span><span class="card-sub">${esc(sub) || '&nbsp;'}</span></span></button>`;
}

function recentCard(r) {
  const p = store.progress[r.id];
  const live = r.type === 'live';
  const now = live ? liveProgress(r.id) : null;
  const pct = live ? now.pct : p ? (p.pos / p.dur) * 100 : 0;
  const sub = live ? now.cur?.[2] || r.sub : r.sub;
  return `<button class="card card-wide focusable" data-play="${esc(r.id)}" title="${esc(r.name)}">
    <span class="card-frame">${art(r, live ? 'art-logo' : 'art-cover art-blur')}
      ${live ? '<span class="live-pill live-pill-sm">LIVE</span>' : ''}
      ${pct ? `<span class="card-progress"><i style="width:${pct}%"></i></span>` : ''}</span>
    <span class="card-meta"><span class="card-title">${esc(r.name)}</span><span class="card-sub">${esc(sub || '')}&nbsp;</span></span></button>`;
}

function row(title, cards, more) {
  if (!cards.length) return '';
  return `<section class="row">
    <header class="row-head"><h2>${esc(title)}</h2>${more ? `<a class="row-more focusable" href="${more}">See all ${icon.chevronR}</a>` : ''}</header>
    <div class="row-wrap">
      <button class="row-nav row-prev" data-scroll="-1" tabindex="-1" aria-label="Scroll left">${icon.chevronL}</button>
      <div class="row-scroll">${cards.join('')}</div>
      <button class="row-nav row-next" data-scroll="1" tabindex="-1" aria-label="Scroll right">${icon.chevronR}</button>
    </div></section>`;
}

function emptyState(title, body, action = '') {
  return `<div class="empty"><div class="empty-mark"></div><h1>${title}</h1><p>${body}</p>${action}</div>`;
}

// ---------- home ----------

async function viewHome(v, _args, token) {
  const s = state.status;
  if (!s.configured) {
    v.innerHTML = emptyState(
      'Welcome to Lumen',
      'Add your M3U playlist or Xtream account to get started.',
      '<a class="btn btn-primary focusable" href="#/settings">Open Settings</a>',
    );
    return;
  }
  if (s.ready && !s.counts.live && !s.counts.movie && !s.counts.series) {
    v.innerHTML = emptyState(
      'Nothing to show',
      s.error ? `Your sources couldn't be loaded: ${esc(s.error)}` : 'Your filter hides everything, or the playlist is empty.',
      '<a class="btn btn-primary focusable" href="#/settings">Open Settings</a>',
    );
    return;
  }
  const live = s.counts.live ? await section('live') : null;
  if (token !== state.routeToken) return;

  v.innerHTML = `<div class="hero" id="hero"></div>
    <div class="rows"><div id="row-continue"></div><div id="rows-live"></div><div id="rows-vod"></div></div>`;

  // Rows are rendered once; later updates touch only what changed so scroll positions and focus survive
  const renderContinue = () => {
    $('#row-continue', v).innerHTML = row('Continue Watching', store.recents.slice(0, 20).map(recentCard));
  };
  const renderLive = () => {
    if (!live) return;
    const parts = [];
    const favs = live.items.filter((c) => store.isFav(c.id));
    parts.push(row('Favorite Channels', favs.slice(0, 40).map(channelCard), '#/live/__fav'));
    const onNow = live.items.filter((c) => epgFor(c.id)?.[0]).slice(0, 30);
    parts.push(row('On Now', onNow.map(channelCard), '#/guide'));
    let n = 0;
    for (const [group, list] of live.byGroup) {
      if (n++ >= 12) break;
      parts.push(row(group, list.slice(0, 30).map(channelCard), `#/live/${encodeURIComponent(group)}`));
    }
    $('#rows-live', v).innerHTML = parts.join('');
  };
  const renderVod = () => {
    const parts = [];
    for (const type of ['movie', 'series']) {
      const data = state.loaded[type];
      if (!data) continue;
      const recent = [...data.items].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 30);
      parts.push(row(`New ${TYPE_LABEL[type]}`, recent.map(posterCard), type === 'movie' ? '#/movies' : '#/series'));
      const favs = data.items.filter((m) => store.isFav(m.id));
      parts.push(row(`Favorite ${TYPE_LABEL[type]}`, favs.slice(0, 30).map(posterCard)));
    }
    $('#rows-vod', v).innerHTML = parts.join('');
  };
  renderContinue();
  renderLive();
  renderVod();
  hero($('#hero', v), live);
  let hadEpg = Object.keys(state.epgNow).length > 0;
  state.onEpg = () => {
    // The first guide data adds an "On Now" row; after that only progress and titles change
    const has = Object.keys(state.epgNow).length > 0;
    if (has && !hadEpg) renderLive();
    else updateLiveCards(v);
    hadEpg = has;
  };
  state.onReturn = () => {
    renderContinue();
    updateLiveCards(v);
  };

  // VOD sections load after the first paint so home stays instant
  for (const type of ['movie', 'series']) {
    if (!s.counts[type] || state.loaded[type]) continue;
    section(type).then(() => token === state.routeToken && renderVod());
  }
}

// Refresh "now playing" text and progress bars of live cards without re-rendering them
function updateLiveCards(root) {
  for (const c of $$('.card[data-play]', root)) {
    const item = state.byId.get(c.dataset.play);
    if (item?.type !== 'live') continue;
    const { cur, pct } = liveProgress(item.id);
    const sub = c.querySelector('.card-sub');
    if (sub && c.classList.contains('card-ch')) sub.textContent = cur ? cur[2] : '\u00a0';
    let bar = c.querySelector('.card-progress');
    if (cur && !bar) {
      c.querySelector('.card-frame').insertAdjacentHTML('beforeend', '<span class="card-progress"><i></i></span>');
      bar = c.querySelector('.card-progress');
    }
    if (cur) bar.firstElementChild.style.width = `${pct}%`;
    else bar?.remove();
  }
}
function hero(host, live) {
  if (!live) {
    host.innerHTML = '';
    host.classList.add('hero-empty');
    return;
  }
  const pick = [];
  const add = (c) => c && !pick.includes(c) && pick.push(c);
  store.recents.filter((r) => r.type === 'live').forEach((r) => add(state.byId.get(r.id)));
  live.items.filter((c) => store.isFav(c.id)).forEach(add);
  live.items.filter((c) => epgFor(c.id)?.[0] && c.logo).slice(0, 8).forEach(add);
  if (!pick.length) live.items.slice(0, 5).forEach(add);
  const slides = pick.slice(0, 6);
  let idx = 0;

  const show = () => {
    const c = slides[idx];
    const { cur, pct } = liveProgress(c.id);
    const next = epgFor(c.id)?.[1];
    host.innerHTML = `
      <div class="hero-bg" style="--h:${hue(c.name)}">${c.logo ? `<img src="${esc(img(c.logo))}" alt="">` : ''}</div>
      <div class="hero-shade"></div>
      <div class="hero-content">
        <div class="hero-kicker"><span class="live-pill">LIVE</span><span>${esc(c.name)}</span></div>
        <h1 class="hero-title">${esc(cur ? cur[2] : c.name)}</h1>
        <p class="hero-sub">${cur ? `${clock(cur[0])} – ${clock(cur[1])}` : esc(c.group)}${next ? ` · Up next: ${esc(next[2])}` : ''}</p>
        ${cur ? `<div class="hero-progress"><i style="width:${pct}%"></i></div>` : ''}
        <div class="hero-actions">
          <button class="btn btn-primary focusable" data-play="${esc(c.id)}">${icon.play}<span>Watch Live</span></button>
          <button class="btn btn-glass btn-icon focusable ${store.isFav(c.id) ? 'on' : ''}" data-fav="${esc(c.id)}" aria-label="Favorite">${store.isFav(c.id) ? icon.heart : icon.heartLine}</button>
        </div>
      </div>
      <div class="hero-art">${art(c, 'art-logo')}</div>
      ${slides.length > 1 ? `<div class="hero-dots">${slides.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : ''}`;
    requestAnimationFrame(() => host.classList.add('in'));
  };
  show();
  if (slides.length < 2) return;
  const timer = setInterval(() => {
    if (host.contains(document.activeElement) || !host.isConnected || document.hidden) return;
    host.classList.remove('in');
    setTimeout(() => {
      idx = (idx + 1) % slides.length;
      show();
    }, 450);
  }, 9000);
  state.cleanup.push(() => clearInterval(timer));
}

// ---------- live tv ----------

async function viewLive(v, [groupArg], token) {
  const live = await section('live');
  if (token !== state.routeToken) return;
  if (!live.items.length) return (v.innerHTML = emptyState('No channels', 'Your playlist has no live channels.'));

  let group = groupArg || '__all';
  let filter = '';
  const groupBtn = (id, name, count) =>
    `<button class="group-btn focusable" data-group="${esc(id)}"><span>${esc(name)}</span><small>${count}</small></button>`;
  v.innerHTML = `<div class="live-layout">
    <aside class="groups">
      <input class="field focusable" type="search" placeholder="Filter channels" aria-label="Filter channels">
      <div class="groups-list">
        ${groupBtn('__all', 'All Channels', live.items.length)}
        ${groupBtn('__fav', 'Favorites', store.favorites.size ? live.items.filter((c) => store.isFav(c.id)).length : 0)}
        ${[...live.byGroup].map(([g, l]) => groupBtn(g, g, l.length)).join('')}
      </div>
    </aside>
    <section class="live-main">
      <header class="page-head"><h1></h1><span class="count"></span></header>
      <div class="grid"></div>
    </section></div>`;

  const grid = new VirtualGrid($('.grid', v), {
    minWidth: 200,
    aspect: 9 / 16,
    extra: 58,
    gap: 20,
    render: (c) => el(channelCard(c)),
  });
  state.cleanup.push(() => grid.destroy());

  const list = () => {
    let items = group === '__all' ? live.items : group === '__fav' ? live.items.filter((c) => store.isFav(c.id)) : live.byGroup.get(group) || [];
    if (filter) items = items.filter((c) => c.key.includes(filter));
    return items;
  };
  const apply = () => {
    const items = list();
    state.zapContext = items;
    $('.page-head h1', v).textContent = group === '__all' ? 'All Channels' : group === '__fav' ? 'Favorites' : group;
    $('.page-head .count', v).textContent = `${items.length} channels`;
    $$('.group-btn', v).forEach((b) => b.classList.toggle('active', b.dataset.group === group));
    grid.setItems(items);
  };
  apply();
  $(`.group-btn.active`, v)?.scrollIntoView({ block: 'nearest' });

  $('.groups-list', v).addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    group = b.dataset.group;
    history.replaceState(null, '', `#/live/${encodeURIComponent(group)}`);
    window.scrollTo({ top: 0 });
    apply();
  });
  $('.groups input', v).addEventListener(
    'input',
    debounce((e) => {
      filter = e.target.value.trim().toLowerCase();
      apply();
    }, 120),
  );
  state.onEpg = () => updateLiveCards(v);
}

// ---------- guide ----------

async function viewGuide(v, [groupArg], token) {
  const live = await section('live');
  if (token !== state.routeToken) return;
  const narrow = innerWidth < 700;
  const PX = narrow ? 4 : 6; // pixels per minute
  const CH = narrow ? 112 : 230;
  const ROW = narrow ? 64 : 76;
  const HEAD = 44;
  const HOURS = 14;
  const t0 = Math.floor(Date.now() / 1800e3) * 1800e3 - 1800e3;
  const t1 = t0 + HOURS * 3600e3;
  const width = CH + ((t1 - t0) / 60000) * PX;
  const x = (t) => CH + ((t - t0) / 60000) * PX;

  let group = groupArg || (store.favorites.size ? '__fav' : '__all');
  const opt = (val, label) => `<option value="${esc(val)}" ${val === group ? 'selected' : ''}>${esc(label)}</option>`;
  const ticks = [];
  for (let t = t0; t < t1; t += 1800e3) ticks.push(`<span class="g-tick" style="left:${x(t)}px">${clock(t)}</span>`);

  v.innerHTML = `<div class="guide">
    <div class="guide-bar">
      <h1>Guide</h1>
      <select class="field guide-group focusable" aria-label="Group">${opt('__all', 'All Channels')}${opt('__fav', 'Favorites')}${[...live.byGroup.keys()].map((g) => opt(g, g)).join('')}</select>
      <button class="btn btn-glass focusable" data-now>Now</button>
    </div>
    <div class="guide-scroll">
      <div class="guide-inner" style="width:${width}px;--ch:${CH}px">
        <div class="g-ruler" style="height:${HEAD}px;width:${width}px"><div class="g-corner" style="width:${CH}px"></div>${ticks.join('')}</div>
        <div class="g-rows"></div>
        <div class="g-nowline"></div>
      </div>
    </div></div>`;

  const scroller = $('.guide-scroll', v);
  const rowsEl = $('.g-rows', v);
  const nowLine = $('.g-nowline', v);
  const cache = new Map();
  const mounted = new Map();
  let channels = [];
  let frame = 0;

  const programmes = (c) => {
    const list = cache.get(c.id);
    if (!list) return `<div class="g-empty" style="left:${CH}px;width:${width - CH}px"></div>`;
    if (!list.length)
      return `<button class="g-prog g-none focusable" data-play="${esc(c.id)}" style="left:${CH}px;width:${width - CH}px"><b>${esc(c.name)}</b><small>No programme information</small></button>`;
    const now = Date.now();
    return list
      .map(([s, e, title]) => {
        const left = x(Math.max(s, t0));
        const w = x(Math.min(e, t1)) - left;
        if (w < 2) return '';
        const isNow = s <= now && e > now;
        const past = e <= now;
        return `<button class="g-prog focusable${isNow ? ' now' : ''}${past ? ' past' : ''}" style="left:${left}px;width:${w - 4}px"
          data-ch="${esc(c.id)}" data-s="${s}" data-e="${e}" data-t="${esc(title)}"><b>${esc(title)}</b><small>${clock(s)} – ${clock(e)}</small></button>`;
      })
      .join('');
  };

  const rowHtml = (c, i) =>
    `<div class="g-row" data-i="${i}" style="top:${i * ROW}px;height:${ROW}px;width:${width}px">
      <button class="g-ch focusable" data-play="${esc(c.id)}" style="width:${CH}px">${art(c, 'art-logo')}<span>${c.num ? `<em>${c.num}</em>` : ''}${esc(c.name)}</span></button>
      ${programmes(c)}</div>`;

  const pending = new Set();
  const load = debounce(async () => {
    const ids = [...pending].filter((id) => !cache.has(id));
    pending.clear();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const r = await api(`api/epg/range?ids=${chunk.map(encodeURIComponent).join(',')}&from=${t0}&to=${t1}`);
        for (const id of chunk) cache.set(id, r[id] || []);
      } catch {
        for (const id of chunk) cache.set(id, []);
      }
    }
    for (const [i, node] of mounted) {
      const c = channels[i];
      if (c && ids.includes(c.id) && !node.contains(document.activeElement)) {
        const n = el(rowHtml(c, i));
        node.replaceWith(n);
        mounted.set(i, n);
      }
    }
  }, 50);

  const update = () => {
    frame = 0;
    const top = scroller.scrollTop - HEAD;
    const first = Math.max(0, Math.floor(top / ROW) - 4);
    const last = Math.min(channels.length, Math.ceil((top + scroller.clientHeight) / ROW) + 4);
    for (const [i, n] of mounted) {
      if ((i < first || i >= last) && !n.contains(document.activeElement)) {
        n.remove();
        mounted.delete(i);
      }
    }
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      if (mounted.has(i)) continue;
      const c = channels[i];
      if (!cache.has(c.id)) pending.add(c.id);
      const n = el(rowHtml(c, i));
      mounted.set(i, n);
      frag.appendChild(n);
    }
    rowsEl.appendChild(frag);
    if (pending.size) load();
  };
  const schedule = () => (frame ||= requestAnimationFrame(update));

  const apply = () => {
    channels = group === '__all' ? live.items : group === '__fav' ? live.items.filter((c) => store.isFav(c.id)) : live.byGroup.get(group) || [];
    if (group === '__fav' && !channels.length) channels = live.items;
    state.zapContext = channels;
    for (const n of mounted.values()) n.remove();
    mounted.clear();
    rowsEl.style.height = `${channels.length * ROW}px`;
    scroller.scrollTop = 0;
    update();
  };
  const placeNow = () => {
    nowLine.style.left = `${x(Date.now())}px`;
    nowLine.style.height = `${HEAD + channels.length * ROW}px`;
  };
  const scrollToNow = (smooth) =>
    scroller.scrollTo({ left: Math.max(0, x(Date.now()) - CH - 90), behavior: smooth ? 'smooth' : 'auto' });

  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  $('.guide-group', v).addEventListener('change', (e) => {
    group = e.target.value;
    history.replaceState(null, '', `#/guide/${encodeURIComponent(group)}`);
    apply();
    placeNow();
  });
  $('[data-now]', v).addEventListener('click', () => scrollToNow(true));
  rowsEl.addEventListener('click', (e) => {
    const p = e.target.closest('.g-prog[data-ch]');
    if (!p) return;
    const s = Number(p.dataset.s);
    const end = Number(p.dataset.e);
    const now = Date.now();
    if (s <= now && end > now) return player.open(p.dataset.ch);
    const ch = state.byId.get(p.dataset.ch);
    toast(`${ch?.name || ''} · ${clock(s)} – ${clock(end)} · ${p.dataset.t}`, { label: 'Watch channel', run: () => player.open(p.dataset.ch) });
  });

  apply();
  placeNow();
  scrollToNow(false);
  const timer = setInterval(placeNow, 30000);
  state.cleanup.push(() => {
    clearInterval(timer);
    window.removeEventListener('resize', schedule);
    cancelAnimationFrame(frame);
  });
}

// ---------- movies & series ----------

async function viewVod(v, type, [groupArg], token) {
  const data = await section(type);
  if (token !== state.routeToken) return;
  const label = TYPE_LABEL[type];
  if (!data.items.length) return (v.innerHTML = emptyState(`No ${label.toLowerCase()}`, 'Nothing here in your playlist.'));

  let group = groupArg || '__all';
  let sort = 'default';
  const chip = (id, name) => `<button class="chip focusable" data-group="${esc(id)}">${esc(name)}</button>`;
  v.innerHTML = `
    <header class="page-head">
      <h1>${label}</h1><span class="count"></span>
      <select class="field sort focusable" aria-label="Sort">
        <option value="default">Featured</option><option value="added">Recently added</option>
        <option value="name">A–Z</option><option value="rating">Top rated</option><option value="year">Newest</option>
      </select>
    </header>
    <div class="chips">${chip('__all', 'All')}${chip('__fav', 'Favorites')}${chip('__continue', 'Continue')}${data.groups.map((g) => chip(g.name, g.name)).join('')}</div>
    <div class="grid"></div>`;

  const grid = new VirtualGrid($('.grid', v), {
    minWidth: 168,
    aspect: 1.5,
    extra: 56,
    gap: 20,
    render: (m) => el(posterCard(m)),
  });
  state.cleanup.push(() => grid.destroy());

  const sorters = {
    added: (a, b) => (b.added || 0) - (a.added || 0),
    name: (a, b) => a.name.localeCompare(b.name),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    year: (a, b) => (b.year || 0) - (a.year || 0),
  };
  const apply = () => {
    let items =
      group === '__all'
        ? data.items
        : group === '__fav'
          ? data.items.filter((m) => store.isFav(m.id))
          : group === '__continue'
            ? data.items.filter((m) => store.progress[m.id] || store.recents.some((r) => r.seriesId === m.id))
            : data.byGroup.get(group) || [];
    if (sort !== 'default') items = [...items].sort(sorters[sort]);
    $('.count', v).textContent = `${items.length} titles`;
    $$('.chip', v).forEach((b) => b.classList.toggle('active', b.dataset.group === group));
    grid.setItems(items);
  };
  apply();
  $('.chip.active', v)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  $('.chips', v).addEventListener('click', (e) => {
    const b = e.target.closest('[data-group]');
    if (!b) return;
    group = b.dataset.group;
    history.replaceState(null, '', `#/${type === 'movie' ? 'movies' : 'series'}/${encodeURIComponent(group)}`);
    apply();
  });
  $('.sort', v).addEventListener('change', (e) => {
    sort = e.target.value;
    apply();
  });
}

// ---------- detail sheet ----------

const sheet = $('#sheet');

async function openDetail(id) {
  const base = state.byId.get(id);
  if (!base) return;
  sheet.hidden = false;
  document.body.classList.add('modal');
  sheet.innerHTML = `<div class="sheet-backdrop" data-close></div><div class="sheet-panel"><div class="sheet-loading"><div class="spinner"></div></div></div>`;
  requestAnimationFrame(() => sheet.classList.add('open'));
  let d;
  try {
    d = await api(`api/${base.type === 'series' ? 'series' : 'item'}?id=${encodeURIComponent(id)}`);
  } catch (e) {
    $('.sheet-panel', sheet).innerHTML = `<div class="sheet-loading"><p>Couldn't load details (${esc(e.message)})</p></div>`;
    return;
  }
  if (sheet.hidden) return;
  const isSeries = base.type === 'series';
  const meta = [
    d.year,
    d.rating ? `★ ${Number(d.rating).toFixed(1)}` : '',
    d.genre,
    d.duration ? minutes(d.duration) : '',
    isSeries && d.episodes?.length ? `${d.episodes.length} episodes` : '',
  ].filter(Boolean);
  const backdrop = img(d.backdrop || base.logo);

  let primary = '';
  if (isSeries) {
    const last = store.recents.find((r) => r.seriesId === id);
    const firstEp = d.episodes?.[0];
    if (last) primary = `<button class="btn btn-primary focusable" data-play="${esc(last.id)}">${icon.play}<span>Continue</span></button>`;
    else if (firstEp) primary = `<button class="btn btn-primary focusable" data-play="${esc(firstEp.id)}">${icon.play}<span>Play S${firstEp.season} E${firstEp.episode}</span></button>`;
  } else {
    const p = store.progress[id];
    primary = `<button class="btn btn-primary focusable" data-play="${esc(id)}">${icon.play}<span>${p ? 'Resume' : 'Play'}</span></button>`;
  }

  const seasons = isSeries ? [...new Set((d.episodes || []).map((e) => e.season))] : [];
  $('.sheet-panel', sheet).innerHTML = `
    <div class="sheet-hero">
      <div class="sheet-bg">${backdrop ? `<img src="${esc(backdrop)}" alt="">` : ''}</div>
      <button class="sheet-close btn btn-glass btn-icon focusable" data-close aria-label="Close">${icon.close}</button>
      <div class="sheet-head">
        <div class="sheet-poster">${art(base, 'art-cover')}</div>
        <div class="sheet-info">
          <div class="sheet-kicker">${esc(base.group || '')}</div>
          <h1>${esc(d.name)}</h1>
          <div class="sheet-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
          ${d.plot ? `<p class="sheet-plot">${esc(d.plot)}</p>` : ''}
          ${d.cast ? `<p class="sheet-cast"><b>Cast</b> ${esc(d.cast)}</p>` : ''}
          <div class="sheet-actions">${primary}
            <button class="btn btn-glass btn-icon focusable ${store.isFav(id) ? 'on' : ''}" data-fav="${esc(id)}" aria-label="Favorite">${store.isFav(id) ? icon.heart : icon.heartLine}</button>
          </div>
        </div>
      </div>
    </div>
    ${
      isSeries
        ? `<div class="sheet-body">
      ${seasons.length > 1 ? `<div class="chips seasons">${seasons.map((s, i) => `<button class="chip focusable${i === 0 ? ' active' : ''}" data-season="${s}">Season ${s}</button>`).join('')}</div>` : ''}
      <div class="episodes"></div></div>`
        : ''
    }`;

  if (isSeries) {
    const epsEl = $('.episodes', sheet);
    const showSeason = (s) => {
      epsEl.innerHTML = d.episodes
        .filter((e) => e.season === s)
        .map((e) => {
          const p = store.progress[e.id];
          const thumb = e.logo ? `<img src="${esc(img(e.logo))}" alt="" loading="lazy">` : art(base, 'art-cover art-blur');
          return `<button class="episode focusable" data-play="${esc(e.id)}">
            <span class="episode-thumb">${thumb}${p ? `<span class="card-progress"><i style="width:${(p.pos / p.dur) * 100}%"></i></span>` : ''}<span class="episode-play">${icon.play}</span></span>
            <span class="episode-text"><small>Episode ${e.episode}${e.duration ? ` · ${minutes(e.duration)}` : ''}</small><b>${esc(e.name)}</b>
            ${e.plot ? `<span>${esc(e.plot)}</span>` : ''}</span></button>`;
        })
        .join('');
    };
    if (seasons.length) showSeason(seasons[0]);
    else epsEl.innerHTML = '<p class="muted">No episodes found.</p>';
    $('.seasons', sheet)?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-season]');
      if (!b) return;
      $$('.seasons .chip', sheet).forEach((c) => c.classList.toggle('active', c === b));
      showSeason(Number(b.dataset.season));
    });
  }
  $('.sheet-actions .btn-primary', sheet)?.focus({ preventScroll: true });
}

function closeSheet() {
  sheet.classList.remove('open');
  document.body.classList.remove('modal');
  setTimeout(() => {
    if (!sheet.classList.contains('open')) {
      sheet.hidden = true;
      sheet.innerHTML = '';
    }
  }, 250);
}
sheet.addEventListener('click', (e) => e.target.closest('[data-close]') && closeSheet());

// ---------- search ----------

const search = $('#search');
const searchInput = $('.search-input', search);
const searchResults = $('.search-results', search);

async function openSearch() {
  search.hidden = false;
  document.body.classList.add('modal');
  requestAnimationFrame(() => search.classList.add('open'));
  searchInput.focus();
  searchInput.select();
  const counts = state.status.counts;
  await Promise.all(['live', 'movie', 'series'].filter((t) => counts[t]).map((t) => section(t).catch(() => null)));
  runSearch();
}
function closeSearch() {
  search.classList.remove('open');
  if (sheet.hidden) document.body.classList.remove('modal');
  setTimeout(() => !search.classList.contains('open') && (search.hidden = true), 250);
}

function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.innerHTML = store.recents.length
      ? `<div class="search-section"><h2>Recently watched</h2><div class="search-grid wide">${store.recents.slice(0, 12).map(recentCard).join('')}</div></div>`
      : `<p class="search-hint">Search across channels, movies and series.</p>`;
    return;
  }
  const terms = q.split(/\s+/);
  const match = (i) => terms.every((t) => i.key.includes(t));
  const out = [];
  const add = (type, title, cardFn, cls) => {
    const data = state.sections[type] && state.loaded?.[type];
    if (!data) return;
    const hits = [];
    for (const i of data.items) {
      if (match(i)) hits.push(i);
      if (hits.length >= 48) break;
    }
    // Prefix matches first
    hits.sort((a, b) => b.key.startsWith(terms[0]) - a.key.startsWith(terms[0]));
    if (hits.length) out.push(`<div class="search-section"><h2>${title}</h2><div class="search-grid ${cls}">${hits.map(cardFn).join('')}</div></div>`);
  };
  add('live', 'Channels', channelCard, 'channels');
  add('movie', 'Movies', posterCard, 'posters');
  add('series', 'Series', posterCard, 'posters');
  searchResults.innerHTML = out.join('') || `<p class="search-hint">No results for “${esc(searchInput.value)}”.</p>`;
}
searchInput.addEventListener('input', debounce(runSearch, 90));
$('[data-close-search]', search).addEventListener('click', closeSearch);

// ---------- player ----------

const player = new Player($('#player'), {
  img,
  epgFor,
  channelList: (item) => {
    const ctx = state.zapContext;
    if (ctx?.some((c) => c.id === item.id)) return ctx;
    const live = state.loaded?.live;
    return live?.byGroup.get(item.group) || [item];
  },
  onClose: () => {
    const focus = state.lastFocus;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    state.onReturn?.();
  },
});

window.addEventListener('popstate', () => {
  if (player.isOpen() && !history.state?.player) player.close(true);
});

// ---------- router ----------

const routes = {
  home: viewHome,
  live: viewLive,
  guide: viewGuide,
  movies: (v, a, t) => viewVod(v, 'movie', a, t),
  series: (v, a, t) => viewVod(v, 'series', a, t),
  settings: (v, a, token) =>
    viewSettings(v, {
      token,
      isCurrent: (t) => t === state.routeToken,
      onSaved: (r) => reloadData({ wait: !!r.reloading }),
    }),
};

async function route() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const r = routes[name] ? name : 'home';
  state.cleanup.forEach((f) => f());
  state.cleanup = [];
  state.onEpg = null;
  state.onReturn = null;
  const token = ++state.routeToken;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r));
  const v = $('#view');
  v.className = `view view-${r}`;
  v.innerHTML = '<div class="view-loading"><div class="spinner"></div></div>';
  window.scrollTo(0, 0);
  try {
    await routes[r](
      v,
      rest.map((s) => decodeURIComponent(s)),
      token,
    );
  } catch (e) {
    if (token === state.routeToken) v.innerHTML = emptyState('Something went wrong', esc(e.message));
  }
}

// ---------- global input ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-play],[data-open],[data-fav],[data-scroll]');
  if (!t || t.closest('#player')) return;
  if (t.dataset.fav) {
    const on = store.toggleFav(t.dataset.fav);
    t.classList.toggle('on', on);
    t.innerHTML = on ? icon.heart : icon.heartLine;
    toast(on ? 'Added to Favorites' : 'Removed from Favorites');
  } else if (t.dataset.scroll) {
    const s = t.parentElement.querySelector('.row-scroll');
    s.scrollBy({ left: Number(t.dataset.scroll) * s.clientWidth * 0.85, behavior: 'smooth' });
  } else if (t.dataset.play) {
    state.lastFocus = t;
    if (!t.closest('.view-live, .view-guide')) state.zapContext = null;
    player.open(t.dataset.play);
  } else if (t.dataset.open) {
    state.lastFocus = t;
    openDetail(t.dataset.open);
  }
});

// Long-press / right-click / "f" toggles favorite on a card
document.addEventListener('contextmenu', (e) => {
  const c = e.target.closest('.card[data-play], .card[data-open]');
  if (!c) return;
  e.preventDefault();
  const id = c.dataset.play || c.dataset.open;
  const on = store.toggleFav(id);
  toast(on ? 'Added to Favorites' : 'Removed from Favorites');
  const frame = c.querySelector('.card-frame');
  frame.querySelector('.fav-badge')?.remove();
  if (on) frame.insertAdjacentHTML('beforeend', `<span class="fav-badge">${icon.heart}</span>`);
});

document.addEventListener('keydown', (e) => {
  if (player.isOpen()) {
    if (player.key(e)) return e.preventDefault();
    if (e.key.startsWith('Arrow') && spatialMove(e.key, player.root)) e.preventDefault();
    return;
  }
  const inField = e.target.matches?.('input, textarea, select');
  const back = e.key === 'Escape' || e.key === 'BrowserBack' || e.key === 'GoBack' || (e.key === 'Backspace' && !inField);
  if (back) {
    if (!sheet.hidden) closeSheet();
    else if (!search.hidden) closeSearch();
    else return;
    return e.preventDefault();
  }
  if (!inField && (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'k'))) {
    e.preventDefault();
    return openSearch();
  }
  if (!inField && e.key === 'f') {
    const c = document.activeElement?.closest?.('.card');
    if (c) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    return;
  }
  if (e.key.startsWith('Arrow')) {
    if (inField && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    if (e.target.matches?.('select') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    const scope = !sheet.hidden ? sheet : !search.hidden ? search : document;
    if (spatialMove(e.key, scope)) e.preventDefault();
  }
});

// Broken logos fall back to the initials tile underneath
document.addEventListener(
  'error',
  (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && !t.closest('video')) t.remove();
  },
  true,
);

// Subtle header background once the page scrolls
const topbar = $('#topbar');
window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', scrollY > 8), { passive: true });

$('#searchBtn').addEventListener('click', openSearch);
$('#refreshBtn').addEventListener('click', async () => {
  await api('api/refresh', { method: 'POST' }).catch(() => {});
  toast('Refreshing playlist and guide…');
  await reloadData({ wait: true });
  toast('Playlist updated');
});

// Drop cached sections and re-render; optionally wait for a server-side reload first
async function reloadData({ wait = false } = {}) {
  if (wait) {
    const until = Date.now() + 10 * 60e3;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const s = await api('api/status').catch(() => null);
      if ((s && !s.loading) || Date.now() > until) break;
    }
  }
  state.status = await api('api/status');
  state.sections = {};
  state.loaded = {};
  state.byId.clear();
  state.zapContext = null;
  try {
    await preload();
  } catch {}
  applyTabs();
  route();
}
// ---------- boot ----------

async function preload() {
  state.loaded ||= {};
  const counts = state.status.counts;
  if (counts.live) state.loaded.live = await section('live');
  await refreshEpg();
}

function applyTabs() {
  const c = state.status.counts;
  $('[data-tab=live]').hidden = !c.live;
  $('[data-tab=guide]').hidden = !c.live || !state.status.epg.channels;
  $('[data-tab=movies]').hidden = !c.movie;
  $('[data-tab=series]').hidden = !c.series;
}

async function boot() {
  const splash = $('#splash');
  for (;;) {
    try {
      state.status = await api('api/status');
      if (state.status.ready || !state.status.configured) break;
      $('.splash-text', splash).textContent = 'Loading your playlist…';
    } catch {
      $('.splash-text', splash).textContent = 'Connecting…';
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    await preload();
  } catch {}
  applyTabs();
  window.addEventListener('hashchange', route);
  await route();
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 600);
  if (state.status.error) toast(`Some sources failed to load`);

  setInterval(refreshEpg, 60000);
  // The guide tab appears once a slow EPG finishes loading
  const epgPoll = setInterval(async () => {
    const s = await api('api/status').catch(() => null);
    if (!s) return;
    state.status = { ...state.status, epg: s.epg };
    applyTabs();
    if (s.epg.channels && !s.epg.loading) {
      clearInterval(epgPoll);
      refreshEpg();
    }
  }, 5000);
}

boot();

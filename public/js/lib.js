// ---------- dom & formatting ----------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] ?? '' : ''), '');
}

export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export function hue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function initials(name) {
  const words = String(name)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '•';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function duration(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function minutes(sec) {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

// ---------- api ----------

export async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ---------- persistent per-device state ----------

function read(key, fallback) {
  try {
    const v = localStorage.getItem('lumen.' + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem('lumen.' + key, JSON.stringify(value));
  } catch {}
}

const putFavorites = () =>
  fetch('api/favorites', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([...store.favorites]),
  }).catch(() => {});
const pushFavorites = debounce(putFavorites, 400);
pushFavorites.now = putFavorites;

export const store = {
  favorites: new Set(read('favorites', [])),
  recents: read('recents', []), // [{ id, type, name, logo, sub, t }]
  progress: read('progress', {}), // id -> { pos, dur, t }
  prefs: read('prefs', { volume: 1, muted: false }),

  isFav: (id) => store.favorites.has(id),
  toggleFav(id) {
    store.favorites.has(id) ? store.favorites.delete(id) : store.favorites.add(id);
    write('favorites', [...store.favorites]);
    pushFavorites();
    store.onFavChange?.(id);
    return store.favorites.has(id);
  },
  // Puts `ids` in the given order; favorites not in `ids` keep their relative order after them
  reorderFavorites(ids) {
    const rest = [...store.favorites].filter((id) => !ids.includes(id));
    store.favorites = new Set([...ids.filter((id) => store.favorites.has(id)), ...rest]);
    write('favorites', [...store.favorites]);
    pushFavorites();
  },
  // Favorites live on the server so every device sees the same list; the local copy is a fallback
  async syncFavorites() {
    try {
      const remote = await api('api/favorites');
      if (!remote.length && store.favorites.size) await pushFavorites.now();
      else {
        store.favorites = new Set(remote);
        write('favorites', remote);
      }
    } catch {}
  },
  addRecent(entry) {
    store.recents = [{ ...entry, t: Date.now() }, ...store.recents.filter((r) => r.id !== entry.id)].slice(0, 40);
    write('recents', store.recents);
  },
  setProgress(id, pos, dur) {
    if (!dur || !isFinite(dur)) return;
    if (pos < 15 || pos > dur * 0.95) delete store.progress[id];
    else store.progress[id] = { pos, dur, t: Date.now() };
    write('progress', store.progress);
  },
  savePrefs() {
    write('prefs', store.prefs);
  },
};

// ---------- icons ----------

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}><path d="${d}"/></svg>`;

export const icon = {
  // Optically centred: the triangle's box spans x 7-19 so it sits in the middle of round buttons
  play: svg('M7 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L8.53 4.65A1 1 0 0 0 7 5.5z'),
  pause: svg('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'),
  search: svg('M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z'),
  close: svg('M6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z'),
  back: svg('M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z'),
  heart: svg('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'),
  heartLine: svg('M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'),
  volume: svg('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'),
  mute: svg('M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z'),  fullscreen: svg('M5 5h5V3H3v7h2zm5 14H5v-5H3v7h7zm9-14v5h2V3h-7v2zm0 14h-5v2h7v-7h-2z'),
  exitFullscreen: svg('M8 3v5H3v2h7V3zm8 5V3h-2v7h7V8zM3 16h5v5h2v-7H3zm13 5v-5h5v-2h-7v7z'),
  pip: svg('M19 11h-8v6h8zm4 8V5a2 2 0 0 0-2-2H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2zm-2 0H3V5h18z'),
  list: svg('M3 5h2v2H3zm4 0h14v2H7zm-4 6h2v2H3zm4 0h14v2H7zm-4 6h2v2H3zm4 0h14v2H7z'),
  rewind: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15.4" font-size="6.5" font-weight="700" text-anchor="middle">10</text></svg>`,
  forward: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="15.4" font-size="6.5" font-weight="700" text-anchor="middle">10</text></svg>`,  next: svg('M6 18l8.5-6L6 6v12zM16 6h2v12h-2z'),
  refresh: svg('M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z'),
  chevronL: svg('M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z'),
  chevronR: svg('M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z'),
  star: svg('M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z'),
};

// ---------- virtual grid (window scrolling) ----------

export class VirtualGrid {
  constructor(host, { minWidth, aspect, extra = 0, gap = 18, render }) {
    this.host = host;
    this.opts = { minWidth, aspect, extra, gap, render };
    this.items = [];
    this.nodes = new Map();
    this.frame = 0;
    host.classList.add('vgrid');
    this.onScroll = () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => ((this.frame = 0), this.update()));
    };
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll, { passive: true });
  }

  setItems(items) {
    this.items = items;
    for (const n of this.nodes.values()) n.remove();
    this.nodes.clear();
    this.layout();
  }

  refresh() {
    for (const n of this.nodes.values()) n.remove();
    this.nodes.clear();
    this.update();
  }

  layout() {
    const { minWidth, aspect, extra, gap } = this.opts;
    const w = this.host.clientWidth;
    if (!w) return;
    const minW = window.innerWidth < 600 ? minWidth * 0.72 : minWidth;
    const cols = Math.max(1, Math.floor((w + gap) / (minW + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    const changed = cols !== this.cols || Math.abs(cw - (this.cw || 0)) > 0.5;
    this.cols = cols;
    this.cw = cw;
    this.rh = cw * aspect + extra + gap;
    this.host.style.height = `${Math.ceil(this.items.length / cols) * this.rh}px`;
    // Only rebuild when the geometry really changed, so focus and hover survive
    if (changed) {
      for (const n of this.nodes.values()) n.remove();
      this.nodes.clear();
    }
    this.update();
  }

  update() {
    if (!this.cols || !this.host.isConnected) return;
    const top = this.host.getBoundingClientRect().top;
    const vh = window.innerHeight;
    const first = Math.max(0, Math.floor(-top / this.rh) - 2);
    const last = Math.min(Math.ceil(this.items.length / this.cols), Math.ceil((vh - top) / this.rh) + 2);
    const from = first * this.cols;
    const to = Math.min(this.items.length, last * this.cols);
    for (const [i, n] of this.nodes) {
      if (i < from || i >= to) {
        if (n.contains(document.activeElement)) continue;
        n.remove();
        this.nodes.delete(i);
      }
    }
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) {
      if (this.nodes.has(i)) continue;
      const n = this.opts.render(this.items[i], i);
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      n.style.cssText += `;position:absolute;width:${this.cw}px;transform:translate(${col * (this.cw + this.opts.gap)}px,${row * this.rh}px)`;
      this.nodes.set(i, n);
      frag.appendChild(n);
    }
    this.host.appendChild(frag);
  }

  destroy() {
    this.ro.disconnect();
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    cancelAnimationFrame(this.frame);
  }
}

// ---------- spatial navigation for keyboards & TV remotes ----------

const DIRS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function visible(r) {
  return r.width > 0 && r.height > 0 && r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
}

export function spatialMove(key, scope = document) {
  const dir = DIRS[key];
  if (!dir) return false;
  const all = $$('.focusable, [data-nav]', scope).filter((e) => !e.closest('[hidden]') && !e.disabled);
  const cur = document.activeElement;
  if (!cur || !all.includes(cur)) {
    const first = all.find((e) => visible(e.getBoundingClientRect()));
    first?.focus();
    return !!first;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const e of all) {
    if (e === cur) continue;
    const b = e.getBoundingClientRect();
    if (!visible(b)) continue;
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const along = dir[0] ? dx * dir[0] : dy * dir[1];
    if (along <= 4) continue;
    // Edges must actually be past the current element in the travel direction
    if (dir[0] > 0 && b.left < a.right - 8) continue;
    if (dir[0] < 0 && b.right > a.left + 8) continue;
    if (dir[1] > 0 && b.top < a.bottom - 8) continue;
    if (dir[1] < 0 && b.bottom > a.top + 8) continue;
    const across = dir[0] ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

// ---------- toast ----------

let toastTimer;
export function toast(message, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => (action.run(), t.classList.remove('show'));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 3000);
}

// ---------- drag-to-reorder grid ----------

// Mouse can always drag; touch and remotes only while the grid has the "editing" class.
// Keyboard: Enter/Space picks a tile up, arrows move it, Enter/Space/Escape drops it.
export function sortable(grid, { onSort }) {
  const cards = () => $$(':scope > .card', grid);
  const ids = () => cards().map((c) => c.dataset.play || c.dataset.open);
  let drag = null;
  let suppressClick = false;

  // Animate tiles from their old to their new position after a DOM move
  const flip = (move) => {
    const before = new Map(cards().map((c) => [c, c.getBoundingClientRect()]));
    move();
    for (const c of cards()) {
      const a = before.get(c);
      const b = c.getBoundingClientRect();
      if (!a || c.classList.contains('drag-placeholder')) continue;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) continue;
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    }
  };

  const columns = () => {
    const list = cards();
    const top = list[0]?.offsetTop;
    return Math.max(1, list.filter((c) => c.offsetTop === top).length);
  };

  function start(e) {
    const r = drag.card.getBoundingClientRect();
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px`;
    document.body.appendChild(ghost);
    drag.card.classList.add('drag-placeholder');
    Object.assign(drag, { ghost, ox: e.clientX - r.left, oy: e.clientY - r.top, started: true });
    grid.classList.add('dragging');
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 8) return;
      start(e);
    }
    e.preventDefault();
    drag.ghost.style.left = `${e.clientX - drag.ox}px`;
    drag.ghost.style.top = `${e.clientY - drag.oy}px`;
    // Keep scrolling while dragging near the top or bottom edge
    if (e.clientY < 90) window.scrollBy(0, -14);
    else if (e.clientY > innerHeight - 90) window.scrollBy(0, 14);
    const over = cards().find((c) => {
      if (c === drag.card) return false;
      const b = c.getBoundingClientRect();
      return e.clientX > b.left && e.clientX < b.right && e.clientY > b.top && e.clientY < b.bottom;
    });
    if (!over) return;
    const list = cards();
    const after = list.indexOf(over) > list.indexOf(drag.card);
    flip(() => over.insertAdjacentElement(after ? 'afterend' : 'beforebegin', drag.card));
  }

  function end(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    const d = drag;
    drag = null;
    if (!d.started) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 50);
    const to = d.card.getBoundingClientRect();
    const anim = d.ghost.animate(
      [{ left: d.ghost.style.left, top: d.ghost.style.top }, { left: `${to.left}px`, top: `${to.top}px` }],
      { duration: 180, easing: 'ease-out' },
    );
    anim.onfinish = () => {
      d.ghost.remove();
      d.card.classList.remove('drag-placeholder');
      grid.classList.remove('dragging');
    };
    onSort(ids());
  }

  grid.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.card');
    if (!card || card.parentElement !== grid || e.button !== 0 || e.target.closest('.card-fav')) return;
    if (e.pointerType !== 'mouse' && !grid.classList.contains('editing')) return;
    drag = { card, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, started: false };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  // Native image dragging would hijack the gesture
  grid.addEventListener('dragstart', (e) => e.preventDefault());
  grid.addEventListener(
    'click',
    (e) => {
      if (suppressClick || (grid.classList.contains('editing') && !e.target.closest('.card-fav'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  grid.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.card');
    if (!card || card.parentElement !== grid || !grid.classList.contains('editing')) return;
    const lifted = card.classList.contains('lifted');
    if (e.key === 'Enter' || e.key === ' ' || (lifted && e.key === 'Escape')) {
      e.preventDefault();
      e.stopPropagation();
      card.classList.toggle('lifted');
      if (lifted) onSort(ids());
      return;
    }
    if (!lifted || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    e.stopPropagation();
    const list = cards();
    const i = list.indexOf(card);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() }[e.key];
    const j = Math.max(0, Math.min(list.length - 1, i + step));
    if (j === i) return;
    flip(() => list[j].insertAdjacentElement(j > i ? 'afterend' : 'beforebegin', card));
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

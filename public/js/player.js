import { $, api, clock, duration, esc, hue, icon, initials, store, toast } from './lib.js';

const scripts = {};
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  scripts[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[global]);
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  return scripts[src];
}

const STALL_TIMEOUT = 15000;

export class Player {
  constructor(root, { img, epgFor, channelList, onClose }) {
    this.root = root;
    this.img = img;
    this.epgFor = epgFor;
    this.channelList = channelList;
    this.onClose = onClose;
    this.engine = null;
    this.item = null;
    this.session = 0;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = `
      <video playsinline webkit-playsinline preload="auto"></video>
      <div class="p-loading"><div class="p-loading-art"></div><div class="spinner"></div></div>
      <div class="p-error" hidden><div class="p-error-box"><h3>Can't play this stream</h3><p></p>
        <div class="p-error-actions"><button class="btn btn-primary focusable" data-act="retry">Try again</button>
        <button class="btn focusable" data-act="close">Close</button></div></div></div>
      <div class="p-ui">
        <div class="p-top">
          <button class="p-btn focusable" data-act="close" aria-label="Back">${icon.back}</button>
          <div class="p-titles"><div class="p-kicker"></div><div class="p-title"></div></div>
          <div class="p-clock"></div>
        </div>
        <div class="p-bottom">
          <div class="p-now">
            <div class="p-now-art"></div>
            <div class="p-now-text"><div class="p-now-title"></div><div class="p-now-sub"></div></div>
          </div>
          <div class="p-seek">
            <span class="p-time p-cur"></span>
            <div class="p-track"><div class="p-buffered"></div><div class="p-played"></div><div class="p-thumb"></div></div>
            <span class="p-time p-dur"></span>
          </div>
          <div class="p-controls">
            <div class="p-group">
              <button class="p-btn p-btn-lg focusable" data-act="toggle" aria-label="Play/Pause">${icon.pause}</button>
              <button class="p-btn focusable vod-only" data-act="back10" aria-label="Back 10 seconds">${icon.rewind}</button>
              <button class="p-btn focusable vod-only" data-act="fwd10" aria-label="Forward 10 seconds">${icon.forward}</button>
              <button class="p-btn focusable" data-act="mute" aria-label="Mute">${icon.volume}</button>
              <input class="p-volume" type="range" min="0" max="1" step="0.02" aria-label="Volume">
            </div>
            <div class="p-group">
              <button class="p-btn focusable" data-act="next" aria-label="Next episode" hidden>${icon.next}</button>
              <button class="p-btn focusable live-only" data-act="channels" aria-label="Channels">${icon.list}</button>
              <button class="p-btn focusable" data-act="pip" aria-label="Picture in picture">${icon.pip}</button>
              <button class="p-btn focusable" data-act="fullscreen" aria-label="Fullscreen">${icon.fullscreen}</button>
            </div>
          </div>
        </div>
      </div>
      <aside class="p-drawer" aria-label="Channels"><div class="p-drawer-head"></div><div class="p-drawer-list"></div></aside>
      <div class="p-osd"></div>`;

    this.video = $('video', r);
    this.ui = {
      loading: $('.p-loading', r),
      loadingArt: $('.p-loading-art', r),
      error: $('.p-error', r),
      errorText: $('.p-error p', r),
      kicker: $('.p-kicker', r),
      title: $('.p-title', r),
      clock: $('.p-clock', r),
      nowArt: $('.p-now-art', r),
      nowTitle: $('.p-now-title', r),
      nowSub: $('.p-now-sub', r),
      seek: $('.p-seek', r),
      track: $('.p-track', r),
      buffered: $('.p-buffered', r),
      played: $('.p-played', r),
      thumb: $('.p-thumb', r),
      cur: $('.p-cur', r),
      dur: $('.p-dur', r),
      toggle: $('[data-act=toggle]', r),
      mute: $('[data-act=mute]', r),
      volume: $('.p-volume', r),
      next: $('[data-act=next]', r),
      fullscreen: $('[data-act=fullscreen]', r),
      drawer: $('.p-drawer', r),
      drawerHead: $('.p-drawer-head', r),
      drawerList: $('.p-drawer-list', r),
      osd: $('.p-osd', r),
    };

    const v = this.video;
    v.volume = store.prefs.volume ?? 1;
    v.muted = !!store.prefs.muted;
    this.ui.volume.value = v.volume;
    if (!document.pictureInPictureEnabled) $('[data-act=pip]', r).hidden = true;

    r.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) return this.action(b.dataset.act);
      const ch = e.target.closest('[data-zap]');
      if (ch) return this.open(ch.dataset.zap);
      if (e.target === v || e.target.closest('.p-ui') === e.target) {
        if (this.root.classList.contains('idle')) this.wake();
        else if (matchMedia('(pointer: fine)').matches) this.action('toggle');
        else this.hideUi();
      }
    });
    v.addEventListener('dblclick', () => this.action('fullscreen'));
    r.addEventListener('pointermove', () => this.wake());
    this.ui.volume.addEventListener('input', () => {
      v.volume = Number(this.ui.volume.value);
      v.muted = v.volume === 0;
    });
    v.addEventListener('volumechange', () => {
      this.ui.mute.innerHTML = v.muted || v.volume === 0 ? icon.mute : icon.volume;
      this.ui.volume.value = v.muted ? 0 : v.volume;
      store.prefs.volume = v.volume;
      store.prefs.muted = v.muted;
      store.savePrefs();
    });
    v.addEventListener('play', () => (this.ui.toggle.innerHTML = icon.pause));
    v.addEventListener('pause', () => {
      this.ui.toggle.innerHTML = icon.play;
      this.wake(true);
    });
    v.addEventListener('playing', () => this.onPlaying());
    v.addEventListener('waiting', () => {
      this.setLoading(true);
      // A live stream that stays stuck gets reconnected with the same engine
      clearTimeout(this.stallTimer);
      const session = this.session;
      this.stallTimer = setTimeout(() => {
        if (session === this.session && this.started && this.isLive() && this.video.readyState < 3) this.start(session);
      }, 12000);
    });
    v.addEventListener('canplay', () => this.setLoading(false));
    v.addEventListener('timeupdate', () => this.onTime());
    v.addEventListener('progress', () => this.onTime());
    v.addEventListener('ended', () => this.onEnded());
    v.addEventListener('error', () => this.engine?.type === 'native' && this.next(`Media error ${v.error?.code || ''}`.trim()));
    document.addEventListener('fullscreenchange', () => {
      this.ui.fullscreen.innerHTML = document.fullscreenElement ? icon.exitFullscreen : icon.fullscreen;
    });

    // Seeking (VOD)
    const seekTo = (e) => {
      const rect = this.ui.track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.seek(f * this.duration());
    };
    this.ui.track.addEventListener('pointerdown', (e) => {
      if (this.isLive()) return;
      this.ui.track.setPointerCapture(e.pointerId);
      this.scrubbing = true;
      seekTo(e);
    });
    this.ui.track.addEventListener('pointermove', (e) => this.scrubbing && seekTo(e));
    this.ui.track.addEventListener('pointerup', () => (this.scrubbing = false));

    // Swipe up/down to zap on touch devices
    let ty = null;
    r.addEventListener('touchstart', (e) => (ty = e.target === v || e.target.classList.contains('p-ui') ? e.touches[0].clientY : null), { passive: true });
    r.addEventListener('touchend', (e) => {
      if (ty === null || !this.isLive()) return;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dy) > 80) this.zap(dy < 0 ? 1 : -1);
      ty = null;
    });

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const set = (a, fn) => {
        try {
          ms.setActionHandler(a, fn);
        } catch {}
      };
      set('nexttrack', () => (this.isLive() ? this.zap(1) : this.item?.nextId && this.open(this.item.nextId)));
      set('previoustrack', () => this.isLive() && this.zap(-1));
      set('seekbackward', () => this.seek(this.video.currentTime - 10));
      set('seekforward', () => this.seek(this.video.currentTime + 10));
    }

    setInterval(() => {
      if (!this.root.hidden) {
        this.ui.clock.textContent = clock(Date.now());
        if (this.isLive()) this.renderLiveInfo();
      }
    }, 15000);
  }

  isOpen() {
    return !this.root.hidden;
  }
  isLive() {
    return this.item?.type === 'live';
  }

  // ---------- open / close ----------

  async open(id, opts = {}) {
    const session = ++this.session;
    // Give the player its own history entry so the browser/phone back button closes it
    if (this.root.hidden && !history.state?.player) history.pushState({ player: true }, '');
    this.root.hidden = false;
    document.body.classList.add('playing');
    this.ui.error.hidden = true;
    this.setLoading(true);
    this.wake();
    let item;
    try {
      item = await api(`api/item?id=${encodeURIComponent(id)}`);
    } catch (e) {
      if (session === this.session) this.fail(e.message);
      return;
    }
    if (session !== this.session) return;
    this.item = item;
    this.root.classList.toggle('is-live', this.isLive());
    this.root.classList.toggle('is-vod', !this.isLive());
    this.ui.next.hidden = !item.nextId;
    this.renderMeta();
    if (this.isLive()) this.renderDrawer();

    const chain =
      item.kind === 'hls' ? ['hls', 'ts', 'transcode'] : item.kind === 'ts' ? ['ts', 'hls', 'transcode'] : ['native', 'transcode'];
    this.chain = chain;
    this.attempt = 0;
    this.resumeAt = opts.start ?? (!this.isLive() ? store.progress[item.id]?.pos || 0 : 0);
    this.offset = 0;
    const resume = this.resumeAt;
    await this.start(session);
    if (resume > 0 && session === this.session) {
      toast(`Resuming at ${duration(resume)}`, { label: 'Start over', run: () => this.seek(0) });
    }
  }

  async start(session) {
    const mode = this.chain[this.attempt];
    const item = this.item;
    this.destroyEngine();
    this.setLoading(true);
    this.ui.error.hidden = true;
    this.armWatchdog(session);
    try {
      if (mode === 'hls') await this.startHls(item.kind === 'hls' ? item.src : altHls(item));
      else if (mode === 'ts') await this.startTs(item.kind === 'ts' ? item.src : null);
      else if (mode === 'native') this.startNative(item.src);
      else if (mode === 'transcode') await this.startTs(this.transcodeUrl(this.resumeAt), true);
      if (session !== this.session) return;
      if (mode !== 'transcode' && this.resumeAt > 0) {
        const at = this.resumeAt;
        this.video.addEventListener('loadedmetadata', () => (this.video.currentTime = at), { once: true });
      }
      this.video.play().catch(() => {
        // Autoplay with sound can be blocked; retry muted
        this.video.muted = true;
        this.video.play().catch(() => {});
      });
    } catch (e) {
      if (session === this.session) this.next(e.message);
    }
  }

  transcodeUrl(at = 0) {
    this.offset = at;
    return this.item.transcode + (at > 0 ? `&t=${Math.floor(at)}` : '');
  }

  next(reason) {
    console.warn(`[player] ${this.chain[this.attempt]} failed: ${reason}`);
    this.attempt++;
    if (this.attempt < this.chain.length) this.start(this.session);
    else this.fail(reason);
  }

  async startHls(src) {
    if (!src) throw new Error('No HLS source');
    const v = this.video;
    const Hls = await loadScript('vendor/hls.js', 'Hls').catch(() => null);
    if (Hls?.isSupported()) {
      const live = this.isLive();
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: live ? 30 : 90,
        maxBufferLength: live ? 20 : 45,
        liveSyncDurationCount: 3,
        startFragPrefetch: true,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 4,
        startPosition: this.resumeAt > 0 ? this.resumeAt : -1,
      });
      this.engine = { type: 'hls', hls };
      this.resumeAt = 0;
      let recovered = 0;
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) return hls.recoverMediaError();
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 2 && d.details !== 'manifestLoadError')
          return hls.startLoad();
        this.next(`${d.type}: ${d.details}`);
      });
      hls.loadSource(src);
      hls.attachMedia(v);
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      this.startNative(src);
    } else {
      throw new Error('HLS not supported');
    }
  }

  async startTs(src, transcoded = false) {
    if (!src) throw new Error('No TS source');
    const mpegts = await loadScript('vendor/mpegts.js', 'mpegts').catch(() => null);
    if (!mpegts?.isSupported()) throw new Error('MPEG-TS playback not supported in this browser');
    const live = this.isLive() || transcoded;
    const p = mpegts.createPlayer(
      { type: 'mpegts', isLive: live, url: new URL(src, location.href).href },
      {
        enableWorker: true,
        enableStashBuffer: !live,
        stashInitialSize: 384 * 1024,
        liveBufferLatencyChasing: live,
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1.5,
        lazyLoad: !live,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 60,
        autoCleanupMinBackwardDuration: 30,
      },
    );
    this.engine = { type: transcoded ? 'transcode' : 'ts', player: p };
    p.on(mpegts.Events.ERROR, (type, detail) => this.next(`${type}: ${detail}`));
    p.attachMediaElement(this.video);
    p.load();
  }

  startNative(src) {
    this.engine = { type: 'native' };
    this.video.src = src;
  }

  destroyEngine() {
    clearTimeout(this.watchdog);
    const e = this.engine;
    this.engine = null;
    try {
      if (e?.hls) e.hls.destroy();
      if (e?.player) {
        e.player.pause();
        e.player.unload();
        e.player.detachMediaElement();
        e.player.destroy();
      }
    } catch {}
    this.video.removeAttribute('src');
    this.video.load();
  }

  close(fromHistory = false) {
    if (this.root.hidden) return;
    if (!fromHistory && history.state?.player) history.back();
    this.saveProgress();
    this.session++;
    this.destroyEngine();
    clearTimeout(this.zapTimer);
    this.root.hidden = true;
    this.root.classList.remove('drawer-open');
    document.body.classList.remove('playing');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    const item = this.item;
    this.item = null;
    this.onClose?.(item);
  }

  // ---------- state ----------

  armWatchdog(session) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (session === this.session && !this.started) this.next('Timed out while starting');
    }, STALL_TIMEOUT);
    this.started = false;
  }

  onPlaying() {
    clearTimeout(this.watchdog);
    clearTimeout(this.stallTimer);
    this.started = true;
    this.setLoading(false);
    this.wake();
    const i = this.item;
    if (!i) return;
    store.addRecent({
      id: i.id,
      type: i.type,
      name: i.type === 'episode' && i.seriesName ? i.seriesName : i.name,
      sub: i.type === 'episode' ? `S${i.season} · E${i.episode} — ${i.name}` : i.group,
      logo: i.logo,
      seriesId: i.seriesId,
    });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: i.name,
        artist: i.type === 'live' ? this.epgFor(i.id)?.[0]?.[2] || i.group : i.seriesName || i.group,
        artwork: i.logo ? [{ src: new URL(this.img(i.logo), location.href).href }] : [],
      });
    }
  }

  fail(msg) {
    clearTimeout(this.watchdog);
    this.setLoading(false);
    this.ui.errorText.textContent =
      msg && /not supported|timed out|network|404|403|502/i.test(msg)
        ? `${msg}. The provider may be offline, or the stream uses a format your browser can't decode.`
        : msg || 'Unknown error';
    this.ui.error.hidden = false;
    $('[data-act=retry]', this.ui.error).focus();
  }

  setLoading(on) {
    this.root.classList.toggle('loading', on);
  }

  wake(stay = false) {
    this.root.classList.remove('idle');
    clearTimeout(this.idleTimer);
    if (!stay)
      this.idleTimer = setTimeout(() => {
        if (!this.video.paused && !this.root.classList.contains('drawer-open')) this.hideUi();
      }, 3200);
  }

  hideUi() {
    this.root.classList.add('idle');
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  duration() {
    const d = this.video.duration;
    if (isFinite(d) && d > 0) return d + this.offset;
    return this.item?.duration || store.progress[this.item?.id]?.dur || 0;
  }

  onTime() {
    if (!this.item || this.isLive()) return;
    const v = this.video;
    const cur = v.currentTime + this.offset;
    const dur = this.duration();
    const f = dur ? cur / dur : 0;
    this.ui.played.style.transform = `scaleX(${f})`;
    this.ui.thumb.style.left = `${f * 100}%`;
    if (v.buffered.length && dur) {
      this.ui.buffered.style.transform = `scaleX(${(v.buffered.end(v.buffered.length - 1) + this.offset) / dur})`;
    }
    this.ui.cur.textContent = duration(cur);
    this.ui.dur.textContent = dur ? `-${duration(dur - cur)}` : '';
    if (Math.abs(cur - (this.lastSave || 0)) > 5) {
      this.lastSave = cur;
      this.saveProgress();
    }
  }

  saveProgress() {
    if (!this.item || this.isLive()) return;
    store.setProgress(this.item.id, this.video.currentTime + this.offset, this.duration());
  }

  onEnded() {
    if (this.isLive()) return this.next('Stream ended');
    store.setProgress(this.item.id, 0, 0);
    if (this.item.nextId) {
      toast('Up next…');
      this.open(this.item.nextId, { start: 0 });
    } else this.close();
  }

  seek(t) {
    if (!this.item || this.isLive()) return;
    const dur = this.duration();
    t = Math.max(0, dur ? Math.min(t, dur - 1) : t);
    if (this.engine?.type === 'transcode') {
      // ffmpeg output isn't seekable: restart the pipe at the new position
      clearTimeout(this.seekTimer);
      this.ui.cur.textContent = duration(t);
      this.seekTimer = setTimeout(() => {
        this.resumeAt = t;
        this.start(this.session);
      }, 350);
      return;
    }
    this.video.currentTime = t;
    this.wake();
  }

  // ---------- rendering ----------

  art(i) {
    const pic = i.logo ? `<img src="${esc(this.img(i.logo))}" alt="" loading="lazy">` : '';
    return `<span class="art art-logo" style="--h:${hue(i.name)}">${pic}<span class="initials">${esc(initials(i.name))}</span></span>`;
  }

  renderMeta() {
    const i = this.item;
    this.ui.clock.textContent = clock(Date.now());
    const art = this.art(i);
    this.ui.loadingArt.innerHTML = art;
    this.ui.nowArt.innerHTML = art;
    if (this.isLive()) {
      this.ui.kicker.innerHTML = `<span class="live-pill">LIVE</span> ${esc(i.group || '')}`;
      this.ui.title.textContent = i.name;
      this.renderLiveInfo();
    } else {
      this.ui.kicker.textContent =
        i.type === 'episode' ? `${i.seriesName || ''} · Season ${i.season} · Episode ${i.episode}` : [i.year, i.group].filter(Boolean).join(' · ');
      this.ui.title.textContent = i.name;
      this.ui.nowTitle.textContent = i.name;
      this.ui.nowSub.textContent = i.plot ? i.plot.slice(0, 160) : '';
      this.ui.cur.textContent = '0:00';
      this.ui.dur.textContent = '';
      this.ui.played.style.transform = 'scaleX(0)';
      this.ui.buffered.style.transform = 'scaleX(0)';
    }
  }

  renderLiveInfo() {
    const nn = this.epgFor(this.item.id) || this.item.epg;
    const [cur, next] = nn || [];
    if (cur) {
      const f = Math.min(1, (Date.now() - cur[0]) / (cur[1] - cur[0]));
      this.ui.nowTitle.textContent = cur[2];
      this.ui.nowSub.textContent = next ? `Up next ${clock(next[0])} · ${next[2]}` : '';
      this.ui.cur.textContent = clock(cur[0]);
      this.ui.dur.textContent = clock(cur[1]);
      this.ui.played.style.transform = `scaleX(${f})`;
      this.ui.thumb.style.left = `${f * 100}%`;
      this.ui.seek.hidden = false;
    } else {
      this.ui.nowTitle.textContent = this.item.name;
      this.ui.nowSub.textContent = next ? `Up next ${clock(next[0])} · ${next[2]}` : 'No programme information';
      this.ui.seek.hidden = true;
    }
    this.ui.buffered.style.transform = 'scaleX(0)';
  }

  renderDrawer() {
    const list = this.channelList(this.item);
    this.zapList = list;
    this.zapIndex = list.findIndex((c) => c.id === this.item.id);
    this.ui.drawerHead.textContent = this.item.group || 'Channels';
    const rows = list
      .slice(0, 800)
      .map((c) => {
        const now = this.epgFor(c.id)?.[0];
        return `<button class="p-ch focusable${c.id === this.item.id ? ' active' : ''}" data-zap="${esc(c.id)}">
          <span class="p-ch-logo">${this.art(c)}</span>
          <span class="p-ch-text"><b>${esc(c.name)}</b><small>${esc(now?.[2] || '')}</small></span></button>`;
      })
      .join('');
    this.ui.drawerList.innerHTML = rows;
  }

  zap(dir) {
    if (!this.zapList?.length) return;
    this.zapIndex = (this.zapIndex + dir + this.zapList.length) % this.zapList.length;
    const ch = this.zapList[this.zapIndex];
    const now = this.epgFor(ch.id)?.[0];
    this.ui.osd.innerHTML = `<span class="p-osd-logo">${this.art(ch)}</span><span><b>${esc(ch.name)}</b><small>${esc(now?.[2] || '')}</small></span>`;
    this.ui.osd.classList.add('show');
    clearTimeout(this.zapTimer);
    clearTimeout(this.osdTimer);
    // Wait until the user stops pressing before tuning, so fast zapping stays snappy
    this.zapTimer = setTimeout(() => this.open(ch.id), 450);
    this.osdTimer = setTimeout(() => this.ui.osd.classList.remove('show'), 2200);
  }

  // ---------- input ----------

  action(act) {
    const v = this.video;
    this.wake();
    switch (act) {
      case 'toggle':
        v.paused ? v.play().catch(() => {}) : v.pause();
        break;
      case 'mute':
        v.muted = !v.muted;
        if (!v.muted && v.volume === 0) v.volume = 0.5;
        break;
      case 'back10':
        this.seek(v.currentTime + this.offset - 10);
        break;
      case 'fwd10':
        this.seek(v.currentTime + this.offset + 10);
        break;
      case 'next':
        if (this.item?.nextId) this.open(this.item.nextId, { start: 0 });
        break;
      case 'channels': {
        const open = this.root.classList.toggle('drawer-open');
        if (open) {
          const active = $('.p-ch.active', this.ui.drawerList) || $('.p-ch', this.ui.drawerList);
          active?.scrollIntoView({ block: 'center' });
          active?.focus({ preventScroll: true });
        }
        break;
      }
      case 'pip':
        if (document.pictureInPictureElement) document.exitPictureInPicture();
        else v.requestPictureInPicture?.().catch(() => {});
        break;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else if (this.root.requestFullscreen) this.root.requestFullscreen().catch(() => {});
        else v.webkitEnterFullscreen?.();
        break;
      case 'retry':
        this.attempt = 0;
        this.ui.error.hidden = true;
        this.start(this.session);
        break;
      case 'close':
        this.close();
        break;
    }
  }

  // Returns true if the key was handled
  key(e) {
    const k = e.key;
    const drawer = this.root.classList.contains('drawer-open');
    if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') {
      if (drawer) this.root.classList.remove('drawer-open');
      else this.close();
      return true;
    }
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause') return this.action('toggle'), true;
    if (k === 'f') return this.action('fullscreen'), true;
    if (k === 'm') return this.action('mute'), true;
    if (k === 'c' && this.isLive()) return this.action('channels'), true;
    if (k === 'p') return this.action('pip'), true;
    if (k === 'ChannelUp' || k === 'PageUp') return this.zap(-1), true;
    if (k === 'ChannelDown' || k === 'PageDown') return this.zap(1), true;

    // While controls are hidden, arrows act directly on playback
    if (this.root.classList.contains('idle') && !drawer) {
      if (this.isLive() && (k === 'ArrowUp' || k === 'ArrowDown')) return this.zap(k === 'ArrowUp' ? -1 : 1), true;
      if (!this.isLive() && (k === 'ArrowLeft' || k === 'ArrowRight')) {
        this.action(k === 'ArrowLeft' ? 'back10' : 'fwd10');
        return true;
      }
      if (k === 'Enter' || k.startsWith('Arrow')) {
        this.wake();
        $('[data-act=toggle]', this.root).focus();
        return true;
      }
    }
    this.wake();
    return false;
  }
}

// Xtream live streams are usually also available as HLS
function altHls(item) {
  if (item.kind !== 'ts') return null;
  if (item.src.startsWith('api/play?')) return `${item.src}&fmt=m3u8`;
  return /\.ts(\?|$)/i.test(item.src) ? item.src.replace(/\.ts(\?|$)/i, '.m3u8$1') : null;
}

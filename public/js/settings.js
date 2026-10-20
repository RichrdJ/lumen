import { $, $$, api, debounce, esc, toast } from './lib.js';

const TYPE_LABEL = { live: 'Live TV', movie: 'Movies', series: 'Series' };
const lines = (v) => (Array.isArray(v) ? v.join('\n') : '');
const toList = (text) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function toggle(id, label, hint, on) {
  return `<label class="set-row set-toggle" for="${id}">
    <span><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="switch focusable" id="${id}" ${on ? 'checked' : ''}></label>`;
}

function field(id, label, value, { type = 'text', placeholder = '', hint = '' } = {}) {
  return `<label class="set-field" for="${id}"><span>${label}</span>
    <input class="field focusable" id="${id}" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
    ${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function area(id, label, value, { placeholder = '', hint = '' } = {}) {
  return `<label class="set-field" for="${id}"><span>${label}</span>
    <textarea class="field focusable" id="${id}" rows="3" placeholder="${esc(placeholder)}" spellcheck="false">${esc(value)}</textarea>
    ${hint ? `<small>${hint}</small>` : ''}</label>`;
}

export async function viewSettings(v, { token, isCurrent, onSaved }) {
  const [s, facets] = await Promise.all([api('api/settings'), api('api/settings/facets').catch(() => ({ countries: [], groups: [] }))]);
  if (!isCurrent(token)) return;

  // Working copy of the filter; everything else is read straight from the inputs on save
  const filter = structuredClone(s.filter);
  delete filter.keepUnknown;
  let groupType = 'live';
  let groupQuery = '';
  let countryQuery = '';

  const detected = (files) => (files.length ? files.map((f) => `<code>${esc(f)}</code>`).join(' ') : '<span class="muted">none</span>');

  v.innerHTML = `
  <div class="settings">
    <header class="page-head"><h1>Settings</h1><span class="count">Saved in /data/settings.json</span></header>

    <section class="set-card" id="sources">
      <h2>Sources</h2>
      <p class="set-intro">Add one or more playlists. Everything you add here is combined.</p>
      ${area('m3uUrls', 'M3U playlist URLs', lines(s.m3uUrls), { placeholder: 'http://provider.example/get.php?username=…&password=…&type=m3u_plus', hint: 'One URL per line.' })}
      <div class="set-detected">Local playlists in <code>/data</code>: ${detected(s.detectedFiles.m3u)}</div>
      <div class="set-subhead">Xtream Codes</div>
      <div class="set-grid">
        ${field('xtreamUrl', 'Server URL', s.xtreamUrl, { placeholder: 'http://provider.example:8080' })}
        ${field('xtreamUser', 'Username', s.xtreamUser)}
        ${field('xtreamPass', 'Password', '', { type: 'password', placeholder: s.hasXtreamPass ? '•••••••• (unchanged)' : '' })}
        <label class="set-field" for="xtreamLiveFormat"><span>Live stream format</span>
          <select class="field focusable" id="xtreamLiveFormat">
            <option value="ts" ${s.xtreamLiveFormat !== 'm3u8' ? 'selected' : ''}>MPEG-TS (lowest delay)</option>
            <option value="m3u8" ${s.xtreamLiveFormat === 'm3u8' ? 'selected' : ''}>HLS (best for iPhone/iPad)</option>
          </select></label>
      </div>
      <div class="set-subhead">TV guide</div>
      ${area('epgUrls', 'XMLTV guide URLs', lines(s.epgUrls), { placeholder: 'https://example.com/guide.xml.gz', hint: 'Leave empty to use the guide from your playlist or Xtream account.' })}
      <div class="set-detected">Local guides in <code>/data</code>: ${detected(s.detectedFiles.epg)}</div>
      <div class="set-grid">
        ${field('refreshHours', 'Refresh every (hours)', s.refreshHours, { type: 'number' })}
        ${field('userAgent', 'User agent', s.userAgent, { hint: 'Some providers only accept VLC-like players.' })}
      </div>
    </section>

    <section class="set-card" id="filter">
      <h2>Filter</h2>
      <p class="set-intro">Choose what shows up in Lumen. Your playlist itself is never changed.</p>
      <div class="set-preview" id="preview">&nbsp;</div>

      <div class="set-subhead">Apply to</div>
      <div class="segmented" id="scope">
        <button class="focusable" data-scope="all">Everything</button>
        <button class="focusable" data-scope="live">Live TV only</button>
      </div>

      <div class="set-subhead">Countries <small>Pick the countries you want to see. Nothing selected shows everything.</small></div>
      ${facets.countries.length > 14 ? `<input class="field focusable set-search" id="countrySearch" type="search" placeholder="Find a country">` : ''}
      <div class="country-grid" id="countries"></div>
      <p class="set-note">Countries are recognised from names like “UK: BBC One”, groups like “NL | Sport” or “Netherlands”, and the playlist’s tvg-country / tvg-id.</p>

      <div class="set-subhead">Hide by keyword</div>
      ${field('excludeWords', 'Words to hide', (filter.excludeWords || []).join(', '), { placeholder: 'adult, xxx, 24/7, ppv', hint: 'Comma separated, matched against channel and group names.' })}

      <div class="set-subhead">Display</div>
      ${toggle('cleanNames', 'Hide country codes in channel names', 'Shows “| NL | ESPN 1 HD” as “ESPN 1 HD”. Groups keep their names.', filter.cleanNames !== false)}

      <div class="set-subhead">Groups</div>
      <div class="group-tools">
        <div class="segmented" id="groupType">
          ${['live', 'movie', 'series']
            .filter((t) => facets.groups.some((g) => g.type === t))
            .map((t) => `<button class="focusable" data-type="${t}">${TYPE_LABEL[t]}</button>`)
            .join('')}
        </div>
        <input class="field focusable" id="groupSearch" type="search" placeholder="Find a group">
        <button class="btn btn-glass focusable" data-bulk="show">Show all</button>
        <button class="btn btn-glass focusable" data-bulk="hide">Hide all</button>
      </div>
      <div class="group-list" id="groups"></div>
    </section>

    <section class="set-card" id="playback">
      <h2>Playback</h2>
      ${toggle('proxy', 'Stream through Lumen', 'Fixes most CORS and mixed-content problems. Turn off only if your provider blocks server traffic.', s.proxy !== 'never')}
      ${toggle('proxyImages', 'Cache logos and posters', 'Loads artwork through Lumen and keeps it on disk.', s.proxyImages)}
      ${toggle('transcodeVideo', 'Re-encode video when the browser can’t play it', 'Uses ffmpeg to convert video to H.264. Heavy on CPU.', s.transcodeVideo)}
    </section>

    <section class="set-card" id="security">
      <h2>Login</h2>
      <p class="set-intro">Protect Lumen with a username and password${s.hasAuthPass ? ' (currently <b>on</b>)' : ' (currently off)'}.</p>
      <div class="set-grid">
        ${field('authUser', 'Username', s.authUser)}
        ${field('authPass', 'Password', '', { type: 'password', placeholder: s.hasAuthPass ? '•••••••• (unchanged)' : '' })}
      </div>
      ${s.hasAuthPass ? '<button class="btn btn-glass focusable" id="removeAuth">Remove login</button>' : ''}
    </section>

    <p class="set-version" id="setVersion"></p>

    <div class="save-bar" id="saveBar">
      <span id="saveState">No changes</span>
      <button class="btn btn-glass focusable" id="refreshNow">Reload playlist</button>
      <button class="btn btn-primary focusable" id="saveBtn" disabled>Save</button>
    </div>
  </div>`;

  api('api/status')
    .then((st) => {
      $('#setVersion', v).textContent = `Lumen v${st.version}${st.commit && st.commit !== 'dev' ? ` · build ${st.commit}` : ''}`;
    })
    .catch(() => {});

  const saveBtn = $('#saveBtn', v);
  const markDirty = () => {
    saveBtn.disabled = false;
    $('#saveState', v).textContent = 'Unsaved changes';
    $('#saveBar', v).classList.add('dirty');
  };
  v.addEventListener('input', (e) => e.target.closest('.settings') && markDirty());
  v.addEventListener('change', (e) => e.target.closest('.settings') && markDirty());

  // ---- filter widgets ----

  const preview = debounce(async () => {
    try {
      const r = await api('api/settings/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filter) });
      const part = (k, label) => (r.total[k] ? `<b>${r[k]}</b> of ${r.total[k]} ${label}` : '');
      $('#preview', v).innerHTML = [part('live', 'channels'), part('movie', 'movies'), part('series', 'series')].filter(Boolean).join(' · ') || 'Add a source to see what the filter keeps.';
    } catch {}
  }, 150);

  const countriesEl = $('#countries', v);
  const renderCountries = () => {
    const sel = new Set(filter.countries);
    const q = countryQuery.toLowerCase();
    countriesEl.innerHTML =
      facets.countries
        .filter((c) => c.code && (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q))
        // Selected countries first; clicking doesn't re-sort, so tiles don't jump around
        .sort((a, b) => sel.has(b.code) - sel.has(a.code))
        .map((c) => {
          const n = c.live + c.movie + c.series;
          return `<button class="country focusable${sel.has(c.code) ? ' on' : ''}" data-code="${esc(c.code)}">
            <span class="country-code">${esc(c.code)}</span><span class="country-name">${esc(c.name)}</span><small>${n}</small></button>`;
        })
        .join('') || '<p class="muted">No countries detected yet. Load a playlist first.</p>';
  };
  countriesEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-code]');
    if (!b) return;
    const c = b.dataset.code;
    filter.countries = filter.countries.includes(c) ? filter.countries.filter((x) => x !== c) : [...filter.countries, c];
    b.classList.toggle('on');
    markDirty();
    renderGroups();
    preview();
  });
  $('#countrySearch', v)?.addEventListener('input', (e) => {
    e.stopPropagation();
    countryQuery = e.target.value.trim();
    renderCountries();
  });

  const groupsEl = $('#groups', v);
  const listedGroups = () => {
    const sel = new Set(filter.countries);
    const q = groupQuery.toLowerCase();
    return facets.groups.filter(
      (g) =>
        g.type === groupType &&
        (!q || g.name.toLowerCase().includes(q)) &&
        // With a country selection, only show groups that can still appear
        (!sel.size || sel.has(g.country)),
    );
  };
  const renderGroups = () => {
    const hidden = new Set(filter.hiddenGroups);
    const all = listedGroups();
    const shown = all.slice(0, 400);
    groupsEl.innerHTML =
      shown
        .map(
          (g) => `<label class="group-row focusable" tabindex="-1">
          <input type="checkbox" class="focusable" data-key="${esc(g.key)}" ${hidden.has(g.key) ? '' : 'checked'}>
          <span class="group-name">${esc(g.name)}</span>
          ${g.country ? `<span class="country-code">${esc(g.country)}</span>` : ''}
          <small>${g.count}</small></label>`,
        )
        .join('') +
      (all.length > shown.length ? `<p class="muted">${all.length - shown.length} more — refine your search.</p>` : '') +
      (!all.length ? '<p class="muted">No groups match.</p>' : '');
  };
  groupsEl.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    filter.hiddenGroups = e.target.checked ? filter.hiddenGroups.filter((k) => k !== key) : [...new Set([...filter.hiddenGroups, key])];
    preview();
  });
  $('#groupSearch', v).addEventListener('input', (e) => {
    e.stopPropagation();
    groupQuery = e.target.value.trim();
    renderGroups();
  });
  $$('[data-bulk]', v).forEach((b) =>
    b.addEventListener('click', () => {
      const keys = new Set(listedGroups().map((g) => g.key));
      filter.hiddenGroups =
        b.dataset.bulk === 'show' ? filter.hiddenGroups.filter((k) => !keys.has(k)) : [...new Set([...filter.hiddenGroups, ...keys])];
      markDirty();
      renderGroups();
      preview();
    }),
  );
  const typeBtns = $$('#groupType button', v);
  if (typeBtns.length) groupType = typeBtns[0].dataset.type;
  const setType = (t) => {
    groupType = t;
    typeBtns.forEach((b) => b.classList.toggle('active', b.dataset.type === t));
    renderGroups();
  };
  typeBtns.forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));

  const scopeBtns = $$('#scope button', v);
  const setScope = (sc) => {
    filter.scope = sc;
    scopeBtns.forEach((b) => b.classList.toggle('active', b.dataset.scope === sc));
  };
  scopeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      setScope(b.dataset.scope);
      markDirty();
      preview();
    }),
  );

  $('#cleanNames', v).addEventListener('change', (e) => {
    filter.cleanNames = e.target.checked;
  });
  $('#excludeWords', v).addEventListener('input', (e) => {
    filter.excludeWords = toList(e.target.value);
    preview();
  });

  setScope(filter.scope || 'all');
  setType(groupType);
  renderCountries();
  preview();

  // ---- save ----

  let removeAuth = false;
  $('#removeAuth', v)?.addEventListener('click', (e) => {
    removeAuth = true;
    e.target.textContent = 'Login will be removed';
    e.target.disabled = true;
    markDirty();
  });

  $('#refreshNow', v).addEventListener('click', async () => {
    await api('api/refresh', { method: 'POST' }).catch(() => {});
    toast('Reloading playlist and guide…');
    onSaved({ reloading: true });
  });

  saveBtn.addEventListener('click', async () => {
    const val = (id) => $(`#${id}`, v).value.trim();
    const body = {
      m3uUrls: toList(val('m3uUrls')),
      xtreamUrl: val('xtreamUrl'),
      xtreamUser: val('xtreamUser'),
      xtreamLiveFormat: val('xtreamLiveFormat'),
      epgUrls: toList(val('epgUrls')),
      refreshHours: Number(val('refreshHours')) || 12,
      userAgent: val('userAgent'),
      proxy: $('#proxy', v).checked ? 'always' : 'never',
      proxyImages: $('#proxyImages', v).checked,
      transcodeVideo: $('#transcodeVideo', v).checked,
      authUser: removeAuth ? '' : val('authUser'),
      filter,
    };
    if (val('xtreamPass')) body.xtreamPass = val('xtreamPass');
    if (!body.xtreamUrl) body.xtreamPass = null;
    if (!removeAuth && val('authPass')) body.authPass = val('authPass');
    if (body.authUser && !val('authPass') && !s.hasAuthPass) {
      toast('Enter a password to turn on the login');
      return;
    }
    saveBtn.disabled = true;
    $('#saveState', v).textContent = 'Saving…';
    try {
      const r = await api('api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      $('#saveState', v).textContent = 'Saved';
      $('#saveBar', v).classList.remove('dirty');
      toast(r.reloading ? 'Saved — loading your playlist…' : 'Saved');
      onSaved(r);
    } catch (e) {
      saveBtn.disabled = false;
      $('#saveState', v).textContent = `Couldn't save (${e.message})`;
    }
  });
}

# Lumen

A smooth, Apple TV–style web player for your IPTV playlist. Point it at an M3U file, an M3U URL or an Xtream Codes account and get a living-room-grade interface in any browser — with a TV guide, movies, series, favorites and resume.

- **Feels native** – frosted-glass UI, cards that lift on focus, smooth horizontal rows.
- **Fast with huge playlists** – the playlist is parsed and cached server-side; grids and the guide are virtualized, so 20,000+ channels scroll like 20.
- **Plays (almost) everything** – HLS via hls.js, raw MPEG-TS via mpegts.js, MP4/MKV natively, with an automatic ffmpeg fallback that converts AC3/EAC3 audio for browsers that can't decode it.
- **No CORS or mixed-content headaches** – streams, playlists and logos are proxied (logos cached on disk).
- **TV guide** – XMLTV (`.xml` / `.xml.gz`) with a timeline grid, now/next on every card and programme progress in the player.
- **Remote-friendly** – full arrow-key / D-pad navigation, channel up/down zapping with an on-screen display, media keys, swipe-to-zap on phones.
- **Movies & series** – posters, details, seasons/episodes, "continue watching" with resume, auto-play next episode.
- **Settings in the app** – sources, country/group filter, playback and login, no compose editing needed.
- **Favorites-first Home** – heart any channel, movie or series, drag them into your own order, and see what's on them in a compact 3-hour mini guide. Favorites are stored on the server and shared by all your devices.
- **Per-device history**, multi-arch Docker image (amd64 / arm64), compose and Swarm stack files.

## Quick start

### Docker Compose

```yaml
services:
  lumen:
    image: ghcr.io/richrdj/lumen:latest
    restart: unless-stopped
    ports:
      - "4242:4242"
    volumes:
      - ./data:/data
    environment:
      TZ: "Europe/Amsterdam"
```

```bash
docker compose up -d
```

### Docker Swarm / Portainer stack

```bash
docker stack deploy -c docker-stack.yml --with-registry-auth lumen
```

In Portainer: *Stacks → Add stack*, paste [`docker-stack.yml`](docker-stack.yml) and deploy.

Then open `http://<host>:4242` and go to **Settings** (gear icon) to add your playlist.

> The image is private while the repository is private: run `docker login ghcr.io` with a GitHub token that has `read:packages` first (or add the registry in Portainer).

## Settings

Everything is configured in the app and stored in `/data/settings.json`:

- **Sources** – M3U URLs, Xtream Codes account, XMLTV guide URLs, refresh interval, user agent. Files dropped into `/data` (`*.m3u`, `*.xml`, `*.xml.gz`) are picked up automatically.
- **Filter** – pick countries (e.g. just UK and NL) and only those are shown, hide groups, hide by keyword, and choose whether the filter applies to everything or only live TV. A live preview shows how many channels remain. Countries are detected from `tvg-country`, `tvg-id` suffixes (`BBCOne.uk`) and prefixes like `UK:`, `NL |`, `[DE]`, `FR -`.
- **Display** – hide country codes in channel names ("| NL | ESPN 1" becomes "ESPN 1"), on by default.
- **Playback** – stream proxy, artwork cache, ffmpeg video re-encoding.
- **Login** – optional username and password (stored hashed).

### Environment variables (optional)

Environment variables still work as defaults for anything not yet saved in Settings — handy for automated deployments.

| Variable | Description |
| --- | --- |
| `M3U_URL`, `M3U_FILE` | Playlist URLs / files (comma separated). |
| `XTREAM_URL`, `XTREAM_USER`, `XTREAM_PASS`, `XTREAM_LIVE_FORMAT` | Xtream Codes account. |
| `EPG_URL`, `EPG_FILE` | XMLTV guides. |
| `FILTER_COUNTRIES` | e.g. `UK,NL`. |
| `FILTER_EXCLUDE` | Keywords to hide, comma separated. |
| `CLEAN_NAMES` | `false` keeps country codes in channel names. |
| `REFRESH_HOURS`, `PROXY`, `PROXY_IMAGES`, `USER_AGENT`, `TRANSCODE_VIDEO` | Same as in Settings. |
| `AUTH_USER`, `AUTH_PASS` | Login. |
| `PORT`, `DATA_DIR`, `TZ` | Container basics. |
## Keyboard & remote

| Key | Browse | Player |
| --- | --- | --- |
| Arrows | Move focus | ↑/↓ zap channels, ←/→ seek 10 s (when controls are hidden) |
| Enter | Open / play | Show controls |
| Esc / Backspace | Close dialog | Close player |
| `/` or Ctrl+K | Search | |
| `f` | Toggle favorite on focused card | Fullscreen |
| Space / `k` | | Play / pause |
| `m` / `c` / `p` | | Mute / channel list / picture-in-picture |
| PageUp / PageDown | | Previous / next channel |

Tap the heart on a card (or right-click / long-press it, or press `f`) to toggle a favorite. Home shows only your favorites.

## Development

```bash
npm install
npm run dev   # then open http://localhost:4242/#/settings
```

No build step: the frontend is plain ES modules in `public/`, the server is dependency-light Node in `server/`.

## License

MIT

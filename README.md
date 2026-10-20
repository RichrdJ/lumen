# Lumen

A smooth, Apple TV–style web player for your IPTV playlist. Point it at an M3U file, an M3U URL or an Xtream Codes account and get a living-room-grade interface in any browser — with a TV guide, movies, series, favorites and resume.

- **Feels native** – frosted-glass UI, cards that lift on focus, hero banner with what's on now, smooth horizontal rows.
- **Fast with huge playlists** – the playlist is parsed and cached server-side; grids and the guide are virtualized, so 20,000+ channels scroll like 20.
- **Plays (almost) everything** – HLS via hls.js, raw MPEG-TS via mpegts.js, MP4/MKV natively, with an automatic ffmpeg fallback that converts AC3/EAC3 audio for browsers that can't decode it.
- **No CORS or mixed-content headaches** – streams, playlists and logos are proxied (logos cached on disk).
- **TV guide** – XMLTV (`.xml` / `.xml.gz`) with a timeline grid, now/next on every card and programme progress in the player.
- **Remote-friendly** – full arrow-key / D-pad navigation, channel up/down zapping with an on-screen display, media keys, swipe-to-zap on phones.
- **Movies & series** – posters, details, seasons/episodes, "continue watching" with resume, auto-play next episode.
- **Per-device favorites & history**, optional basic auth, multi-arch Docker image (amd64 / arm64).

## Quick start

```yaml
# docker-compose.yml
services:
  lumen:
    image: ghcr.io/richrdj/lumen:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      M3U_URL: "http://provider.example/get.php?username=USER&password=PASS&type=m3u_plus"
      # EPG_URL: "https://example.com/guide.xml.gz"
      TZ: "Europe/Amsterdam"
```

```bash
docker compose up -d
```

Open `http://<host>:8080`.

Prefer a local file? Put `playlist.m3u` (and optionally `guide.xml` / `guide.xml.gz`) in `./data` and leave the URLs out — Lumen picks them up automatically.

> The image is private while the repository is private: run `docker login ghcr.io` with a GitHub token that has `read:packages` first.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `M3U_URL` | – | One or more playlist URLs (comma separated). |
| `M3U_FILE` | `*.m3u` / `*.m3u8` in `/data` | One or more playlist files. |
| `XTREAM_URL` | – | Xtream Codes server, e.g. `http://host:8080`. Loads live, movies and series. |
| `XTREAM_USER` / `XTREAM_PASS` | – | Xtream credentials. |
| `XTREAM_LIVE_FORMAT` | `ts` | `ts` or `m3u8` for Xtream live streams. |
| `EPG_URL` | from playlist / Xtream | One or more XMLTV URLs (plain or gzipped). |
| `EPG_FILE` | `*.xml` / `*.xml.gz` in `/data` | Local XMLTV files. |
| `REFRESH_HOURS` | `12` | How often playlists and the guide are reloaded. |
| `PROXY` | `always` | `always` streams through Lumen (fixes CORS/mixed content); `never` lets the browser connect directly. |
| `PROXY_IMAGES` | `true` | Proxy and cache channel logos and posters. |
| `USER_AGENT` | VLC | User agent sent to providers. Per-channel `#EXTVLCOPT:http-user-agent` overrides it. |
| `TRANSCODE_VIDEO` | `false` | Let the ffmpeg fallback re-encode video to H.264 too (CPU heavy). |
| `AUTH_USER` / `AUTH_PASS` | – | Enable HTTP basic auth. |
| `PORT` | `8080` | Listen port. |

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

Right-click (or long-press) a card to toggle it as a favorite.

## Development

```bash
npm install
M3U_FILE=./my.m3u npm run dev
```

No build step: the frontend is plain ES modules in `public/`, the server is dependency-light Node in `server/`.

## License

MIT

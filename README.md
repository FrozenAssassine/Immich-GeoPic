# Immich GeoPic 📍📸

Immich GeoPic is a modern georeferencing and location management studio for your self-hosted [Immich](https://immich.app/) photo library. It automatically interpolates coordinates for non-geotagged photos based on capture timestamps between geotagged photos, and allows single or batch location assignment directly on an interactive map.

---

## Key Features

- **Direct Immich Integration**: Fetches assets and thumbnails directly from your Immich server, writing updated coordinates straight to Immich's database (which triggers automatic reverse geocoding).
- **Secure Server-Side Proxy**:
  - The browser client never touches Immich directly.
  - Immich session tokens are kept strictly server-side in an in-memory session registry; the browser receives an opaque HTTP-only cookie.
- **Two Flexible Authentication Modes**:
  1. **Zero-Auth Direct Mode** (`IMMICH_API_KEY` set in `.env`): Instant access without user login, ideal for home servers and private intranets.
  2. **Interactive Immich Login** (when `IMMICH_API_KEY` is not set): Users log in with their Immich account (email & password). Supports user profile avatar, username display, and secure logout.
- **Timespan Selector & Interactive Statistics**:
  - Top bar with quick filters ("1M", "3M", "6M" default, "1Y", "All", and "Custom" date range).
  - Interactive status badges: Click on **Total Photos**, **GPS Verified**, or **No GPS Position (Estimated)** to smoothly zoom and pan the map directly to those photos.
- **Multiple Base-Maps**:
  - OpenStreetMap is the built-in default.
  - Easily switch between base maps or add custom tile providers (with one-click presets like Esri Satellite / World Imagery, OpenTopoMap, and CartoDB).
  - Settings, custom maps, and your active base-map selection are saved to persistent storage and restored across logins.
- **Intelligent Route & Georeferencing**:
  - **Green Markers**: Confirmed GPS coordinates stored in Immich.
  - **Orange Markers**: Estimated coordinates calculated by linear interpolation between chronological GPS anchors.
  - **Route Line**: Polyline visualizing your path chronologically.
- **Interactive Tools**:
  - **Relocate Marker**: Move any photo's position simply by clicking on the map.
  - **Fix Single Marker**: Accept the estimated position for a photo.
  - **Remove Coordinates**: Clear GPS coordinates for a photo in Immich.
  - **Box Select (Shift + Drag)**: Select multiple photos within a bounding box and fix all estimated markers at once.

---

## Quick Start (Docker Compose)

Simply add the `immich-geopic` service to your existing Immich `docker-compose.yml`:

```yaml
services:
  immich-geopic:
    container_name: immich_geopic
    image: ghcr.io/finn-freitag/immich-geopic:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # Persistent volume to store user settings, custom base-maps, and active selections
      - ./geopic-data:/app/data
    environment:
      # URL to your Immich instance (include protocol and port if custom)
      - IMMICH_URL=http://immich-server:2283

      # (Optional) Immich API Key.
      # If set, no user login is needed. If omitted, users sign in via email/password.
      - IMMICH_API_KEY=
```

> [!NOTE]
> The `./geopic-data:/app/data` volume ensures custom base-maps and user settings persist across container updates, restarts, and re-logins.

Then run:
```bash
docker compose up -d
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Local Development

### Requirements
- Node.js 20+
- npm or yarn

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` to specify your `IMMICH_URL` (and optional `IMMICH_API_KEY`).

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Building for Production

```bash
npm run build
npm start
```

Or build the Docker container:
```bash
docker build -t immich-geopic .
```

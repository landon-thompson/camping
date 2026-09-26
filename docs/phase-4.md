# Phase 4 — Trails & routes

Owned files only: `src/features/trails/**`, the `workbox` section (plus the two small
constants that feed it) of `vite.config.ts`. `src/model/trails.ts` already had the
`route`/`pin` schemas wired into `recordSchemas` from the Phase 0 foundation commit, so
nothing needed to change there.

## What's built

- **Import** (`ImportPanel.tsx`, `gpxKml.ts`, `import.ts`): pick one or more `.gpx`/`.kml`
  files. Each file is read as text, parsed with the browser's `DOMParser`, and converted
  to GeoJSON with `@tmcw/togeojson` (`gpxKml.ts` — a thin adapter). Track/route geometries
  (`LineString`/`MultiLineString`) become **route drafts**; points become **pin drafts**
  (`import.ts` — pure, unit tested). You review/rename/uncheck items, pick a source
  (onX/Gaia/other) and an average forest-road speed, then save. Bad or empty files, or
  unsupported geometry (e.g. polygons), produce a readable issue instead of throwing.
- **Simplification** (`geo.ts`): our own iterative Douglas–Peucker (no recursion, so long
  tracks can't blow the stack), on a local equirectangular projection scaled by
  `cos(latitude)`. Each route is simplified until its JSON size is under **140 KB**
  (comfortably inside the 256 KB sync-record limit), growing the tolerance geometrically.
  Distance is our own haversine sum over the (simplified) points; drive time is
  `distance / avgMph`, always labeled as an estimate, default **15 mph**.
- **Route editing** (`RoutesPanel.tsx`): name, flags (no trailer, 4WD/high clearance,
  seasonal mud), difficulty 1–5, notes, delete. (Trip is set at import time; there's no
  trip-reassignment UI yet — see requests below.)
- **Pins** (`PinsPanel.tsx`, tap-to-drop in `TripTrailsSection.tsx`): kind (dispersed-site
  candidate / boat launch / water source / turnaround point / other), name, notes, and
  `PhotoAttach` (renders, does nothing until Phase 5 implements it). Tapping the embedded
  map opens a small inline form (position pre-filled) — no `window.prompt`.
- **Export** (`ExportPanel.tsx`, `gpxExport.ts`): checkbox-select any mix of routes/pins,
  builds one GPX 1.1 file (pure XML string, unit tested) and triggers a download via
  `Blob` + `<a download>`, for re-import into onX or Gaia.
- **Map layers** (`mapLayers.ts` → `attachTrailLayers`): routes styled by flags (dashed =
  seasonal mud, red = no trailer), pins colored by kind, an MVUM toggle `IControl`
  (persisted in `localStorage`), attribution, and live updates via Dexie `liveQuery`.
  Every `map.*`/`localStorage` call is wrapped in `try/catch` so it never throws —
  offline, mid-style-reload, or if layers already exist from a prior attach.
- **`TripTrailsSection`** embeds its own small MapLibre map (`TrailsMap.tsx`) and calls
  `attachTrailLayers` itself, so routes/pins/MVUM are visible today even though Phase 2's
  trip page doesn't exist yet. `/trails` (`TrailsLibraryPage.tsx`, wired in `routes.tsx`)
  is the same set of panels with `tripId: null` — every route/pin, across all trips.
- **Offline** (`OfflinePanel.tsx`, `tiles.ts`, `offline.ts`, `offlineRegions.ts`) — see the
  tile-policy section below for *why* it works this way.

### onX ↔ here

**onX → here (import):**
1. In onX Offroad, export the track/waypoints you want as a `.gpx` (app) or `.gpx`/`.kml`
   (web map) file, and get it onto the phone (AirDrop, Files app, email to self, etc.).
2. Open the trip's Trails section (or `/trails`) → **Import GPX/KML** → pick the source →
   choose the file(s).
3. Review the routes/pins found, rename anything you want, uncheck anything you don't,
   then **Save**.

**here → onX (export):**
1. In **Export to onX**, uncheck anything you don't want in the file.
2. Tap **Export … as GPX** — it downloads one `.gpx` file (Files app on iPhone).
3. In onX (app: GPX only; web map: GPX or KML), import that file the way onX documents.

onX's own limits (roughly 3,000 markups / 4 MB per file, per the planning brief) —
**verify current numbers on onX's own help pages**, since we don't have API/scraped
access to check them here. Nothing in this app talks to onX or Gaia directly; it's only
file exchange, per the contract.

## MVUM source, license, attribution — and what could NOT be verified here

- **Source (found, not fetched):** the Forest Service's public ArcGIS REST Map Service on
  the FS Geodata Clearinghouse / Enterprise Data Warehouse (EDW):
  `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer` (there's also an
  `EDW_MVUM_01` with the same layers, differently labeled). Sub-layers used: **4 = "Motor
  Vehicle Use Map: Roads"**, **2 = "Motor Vehicle Use Map: Trails"**. Both are national in
  scope, so Superior and Chippewa National Forests (and every other NF) are included by
  the service itself — there's no separate MN-only endpoint.
- **License/attribution:** Forest Service EDW geospatial data is a U.S. Government work
  released as open data ("What Open Data means for the Forest Service", fs.usda.gov),
  distributed under the Forest Service's standard geodata disclaimer (no warranty as to
  accuracy/completeness/currency) rather than a restrictive license. We attribute it as
  **"USDA Forest Service"** on the raster layer.
- **NOT independently verified from this build environment:** this sandbox's egress proxy
  blocks `apps.fs.usda.gov` and `data.fs.usda.gov` outright (`WebFetch`/`curl` both
  refused with `EGRESS_BLOCKED`/`403`), so the exact service JSON, field names, and CORS
  headers could not be fetched or curl-tested here. Everything above about the URL and
  layer IDs comes from the Forest Service's own public ArcGIS REST directory listing,
  found via web search snippets — not fetched and read directly.
  - **The UI always shows: "The printed/official MVUM is the legal reference."**
    (`MVUM_LEGAL_NOTE` in `mvum.ts`, shown in `TripTrailsSection` and `/trails`.)
  - The layer is added defensively (try/catch, never throws) and toggled off by default,
    so a bad/unreachable URL just means a blank overlay, not a broken map.
  - **Before relying on this in the field:** open
    `https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer?f=json` in a
    browser (should render Esri's standard REST-directory JSON) and, from a normal
    network, run:
    ```
    curl -sI "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer/export?bbox=-92,46,-91,47&bboxSR=4326&f=image"
    ```
    A `200` plus (checked from a browser devtools Network tab) an
    `Access-Control-Allow-Origin` header means the raster overlay will work as built. If
    it 404s, or the layer IDs have changed, update `MVUM_SERVICE_URL`/`MVUM_LAYER_IDS` in
    `src/features/trails/mvum.ts` — everything else (styling, toggle, attribution) stays
    the same.

## Tile policy — findings and decision

**Findings.** This sandbox's egress proxy blocks `openfreemap.org` directly, so I
couldn't read OpenFreeMap's own terms page. Via web search, I could read the project's
GitHub README (hyperknot/openfreemap): the hosted public instance is described as "free:
there are no limits on the number of map views or requests," but for heavy/bulk use the
project explicitly points people at its own **weekly full-planet MBTiles/Btrfs downloads**
for self-hosting, rather than at scripted bulk downloading from the live tile server. I
found no statement anywhere that the live `tiles.openfreemap.org` endpoint may be
scripted for bulk/offline region prefetching, and the general norm for shared
OSM-vector-tile servers (the OSMF-style tile usage policy that inspired this project) is
that "download city/country for offline use" features are explicitly **not** allowed
against a shared free server.

**Decision: option (a).** We do not build a bulk region tile downloader. Instead:

1. **Workbox `CacheFirst` runtime caching** (`vite.config.ts`) caches whatever tiles,
   style JSON, sprites and glyphs the app actually requests — normal viewing — with sane
   caps (map tiles: 6,000 entries / 30 days; MVUM: 2,000 entries / 14 days, since it's a
   convenience overlay, not the legal reference). This is the same mechanism regardless of
   whether the request came from a person panning the map or from "prepare offline" below
   — there's nothing scripted hitting the tile server outside of real map view requests.
2. **"Prepare offline"** (`OfflinePanel.tsx` → `offline.ts#prepareOfflineByViewing`) pans
   and zooms the *live* MapLibre map across the trip's bounding box (trip location +
   imported routes/pins, padded) at a few capped zoom levels
   (`OFFLINE_ZOOM_LEVELS = [11, 13, 14]`, hard-capped to **1,500 tiles total**,
   `tiles.ts#clampZoomsToBudget` drops the highest zoom first if a trip area is large) —
   waiting for the map to go idle at each stop before moving on. This is the same tile
   traffic a person would generate by actually looking around the area; it's just done
   for them, once, before they lose signal. The tile-count/byte estimate shown before
   starting is a labeled **estimate** — real per-tile size varies.
3. **If OpenFreeMap's terms turn out to prohibit even this** (I could not confirm either
   way from this sandbox — see Requests below), option (b) is a one-line config change:
   set `VITE_MAP_STYLE_URL` to a provider whose terms explicitly allow offline caching,
   and the `workbox` runtime-caching rule already reads that same env var at build time
   (`MAP_STYLE_HOST_PATTERN` in `vite.config.ts`) — nothing else in Phase 4 changes.

**Known limitation, by design:** "prepare offline" tracks the trip **area and zooms**
per saved region, but MapLibre itself decides exactly which tiles a given camera stop
requests — we don't track individual tile URLs per region. So "Delete" on one saved
region just removes it from the list (bookkeeping); there's a separate "**free up tile
storage**" action that clears the *entire* map/MVUM tile cache via the Cache API
(`clearMapTileCache()`), naming the cache(s) it clears. This is called out in the UI
rather than pretending to be more precise than it is.

## iPhone storage notes

- The owner decision (per `docs/PROGRESS.md`) is Home Screen install for durable
  offline storage; this phase doesn't change that, it just uses whatever quota the
  installed PWA already gets.
- `OfflinePanel` shows `navigator.storage.estimate()` (usage/quota) next to the "prepare
  offline" controls, wrapped defensively (`offline.ts#storageEstimate`) since Safari can
  return `null`/throw in some contexts (private mode, or if the API is simply
  unsupported) — the panel just omits the line rather than breaking.
- iOS Safari (including installed PWAs) can evict Cache Storage under storage pressure,
  and unlike a native app there's no guarantee cached tiles survive indefinitely. The
  copy in `OfflinePanel` doesn't promise "downloaded forever" — it's framed as "cached on
  this phone," and a saved region can always be re-prepared.
- Route/pin records themselves are Dexie/IndexedDB (regular synced records), not Cache
  Storage, so they're unaffected by the tile-cache eviction concerns above.

## Tests

`npx tsc -b`, `npm test`, `npm run build` all pass. **69 tests** across the trails
feature (see file list below) plus every pre-existing test in the repo, all still
passing. Tests run in the repo's Node environment (no jsdom) per `vite.config.ts`, so:

- `geo.ts`, `tiles.ts`, `mvum.ts` (pure math/config) and `import.ts` (pure GeoJSON→draft
  conversion) are tested directly with hand-built fixtures — for `import.ts`, the
  fixtures are GeoJSON `FeatureCollection`s shaped exactly like what
  `@tmcw/togeojson`'s `gpx()`/`kml()` produce for a small real GPX/KML file (named
  track + named waypoint), so the conversion logic is exercised the same way it would be
  from a real import.
- `gpxExport.ts`'s pure `buildGpxDocument`/`gpxFileName` are tested directly (including
  XML-escaping and MultiLineString → multiple `<trkseg>`s); `downloadGpx` (Blob + `<a
  download>`) is not — it's a two-line browser-only wrapper.
- `offlineRegions.ts` is tested against a real Dexie instance via `fake-indexeddb/auto`
  (the same pattern `src/sync/sync.test.ts` already uses).
- **Not unit tested, by necessity** (no `DOMParser`, no WebGL, in this Node env):
  `gpxKml.ts`'s `xmlTextToFeatureCollection` (real XML parsing — thin adapter over
  `DOMParser` + `@tmcw/togeojson`, by design; see `import.ts` above for what IS tested),
  `mapLayers.ts` (needs a live MapLibre `Map`), `offline.ts`'s `prepareOfflineByViewing`
  (needs a live map to pan), and every `.tsx` component. These were smoke-tested by
  `npm run build` (type-checks the whole tree, including JSX) but not run in a browser
  from this sandbox — flagging that honestly rather than claiming browser coverage I
  don't have.

New test files: `geo.test.ts`, `import.test.ts`, `gpxExport.test.ts`, `mvum.test.ts`,
`tiles.test.ts`, `offlineRegions.test.ts`.

## Requests for coordinator

1. **Nav access to `/trails`.** The bottom nav (`components/Layout.tsx`, coordinator-owned)
   has 5 fixed tabs (Home/Trips/Book/Gear/Tools) with no room for a 6th. Right now
   `/trails` is only reachable by typing the URL. Once Phase 2's trip page exists, its
   `TripTrailsSection` covers the common case (trails scoped to one trip), but the "all
   trips" library page has no link anywhere. Worth a link from Settings, the Trips list,
   or swapping one nav icon for a "More" menu — your call.
2. **Verify MVUM CORS/URL from a real network.** This sandbox can't reach
   `apps.fs.usda.gov` at all (proxy-blocked), so I could not confirm the service is
   actually reachable with CORS enabled for browser `fetch`/tile requests, or that the
   layer IDs I found via search are current. See the `curl` command above — if it fails,
   the fix is a one-line constant change in `mvum.ts`.
3. **Verify OpenFreeMap's terms directly** (also proxy-blocked here). If bulk/offline
   caching-by-viewing turns out not to be acceptable even at our capped scale, switch
   `VITE_MAP_STYLE_URL` to a provider that allows it — the Workbox runtime-cache rule
   already follows that env var, so nothing else in this phase needs to change.
4. **Trip reassignment for routes/pins.** Right now a route/pin's `tripId` is set once at
   import time (or `null` from the `/trails` library page) and there's no "move to a
   different trip" control. Small addition if it turns out to matter once Phase 2 trip
   pages exist and people start moving things around.
5. **`src/model/trails.ts` was not changed** — Phase 0's foundation commit already added
   `route`/`pin` to `recordSchemas`, so there was nothing to extend for this phase.

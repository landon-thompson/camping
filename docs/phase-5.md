# Phase 5 — weather, journal, photos

Built on branch `dev` (this worktree), from `2dddc6d`. Owns `src/features/journal/**`,
`src/model/journal.ts`, `api/src/functions/files.ts`, `api/src/lib/files*.ts`. No other files
touched; no new dependencies added.

## What's built

- **`TripWeatherSection({ tripId })`** — reads `trip.location`, fetches the NWS forecast, shows
  the next several periods (name, temp, wind, short forecast, precip % when NWS reports one),
  caches the result in `db.meta` (`weather:<tripId>`), and shows "as of …" plus an offline note
  when using the cache. Manual **Refresh** button. Clear messages for: no location set, outside
  NWS coverage (non-US point), offline with no cache yet, and a generic fetch failure. Notes that
  NWS forecasts cover about 7 days.
- **`TripDebriefSection({ tripId })`** — one `debrief:<tripId>` record per trip: "What we forgot"
  (free-text list, with an explanation that each item is added to the *next* trip's checklist —
  Phase 2's `generateChecklist` already reads `debrief.forgot`), "Never used" (checkboxes over
  `trip.gearIds` gear, plus free-text entries), "went well" / "improve" / "notes" text areas, and
  photos via `PhotoAttach`. All fields autosave ~800ms after the last keystroke, and flush
  immediately on unmount so navigating away doesn't drop the last edit.
- **`PhotoAttach({ value, onChange, tripId })`** — file picker (`accept="image/*" multiple`),
  resizes each image to ≤1600px JPEG at ~0.8 quality on-device (`createImageBitmap` + canvas),
  stores the `Blob` in `db.blobs` and a `photo:*` record (`blobPath: null` until uploaded).
  Thumbnail grid, tap-to-enlarge lightbox (focus moves to its close button, `Escape` and a
  full-bleed backdrop button both close it), per-photo caption (debounced save), remove.
  Prefers the local blob; otherwise fetches a signed read URL and caches the blob locally so the
  next view works offline. A background upload queue (started from `PhotoAttach`'s own effect,
  not `App.tsx`) uploads any photo with a local blob and no `blobPath` once online + signed in,
  with exponential backoff (15s → 30s → … capped at 5 min per photo) and never deletes a local
  blob, uploaded or not.
- **Server** `api/src/functions/files.ts` + `api/src/lib/filesConfig.ts` + `filesSas.ts`:
  - `POST /api/files/upload-url { photoId, contentType }` → validates the photo id and content
    type, builds `<household>/photos/<id>.jpg`, returns a write-only (`create+write`) SAS URL
    good for ~15 minutes plus the `blobPath` to save.
  - `GET /api/files/read-url?path=<blobPath>` → validates the path stays inside this household's
    own prefix (rejects traversal and other households), returns a read-only SAS URL, ~15 min.
  - `authorize()` (role `family`) on both, same as `sync.ts`; `staticwebapp.config.json` already
    covers `/api/*` with the `family` role, so no config change was needed there.
  - 503 with an actionable message if `STORAGE_CONNECTION_STRING` isn't set yet (mirrors the
    `sync.ts` / `StoreNotConfiguredError` pattern).
- **Model**: `src/model/journal.ts` (`debrief`, `photo`) was already scaffolded by the
  coordinator and needed no changes — it matched what the UI needed.

### Not built (left for later, both optional per the contract)

- `journalRoutes` (`/journal/*`) is left as the empty stub. Everything the debrief/photo work
  needs is already reachable from the trip page sections; a standalone journal/photo timeline
  across trips would be more useful once Phase 2's trip pages (and navigation to them) exist, so
  it wasn't built now to avoid guessing at that shape.
- The optional server `/journal/*` routes (debriefs by trip, combined forgot list, photos) were
  not added. The client already has everything it needs via the generic record sync
  (`useRecord`/`useRecords`), and Phase 2's `generateChecklist` reads debriefs straight out of
  the local Dexie `records` table — no server endpoint is actually required for the "forgot →
  next checklist" flow. If the coordinator wants a server-side aggregate anyway (e.g. for a
  future non-phone consumer), it's a small addition to `api/src/functions/files.ts` or a new
  file — flag it and it can be added in a follow-up.

## NWS weather — implementation notes

`src/features/journal/nws.ts` implements the documented flow: `GET /points/{lat},{lon}` →
`properties.forecast` (and `properties.forecastHourly`, resolved but not fetched — the section
shows the compact multi-day forecast, not an hourly view) → `GET` that URL → `properties.periods[]`.

**This was not tested against the live API.** `api.weather.gov` and `weather.gov` are blocked
from this sandbox (confirmed by a previous attempt per the task brief; not re-attempted here to
avoid burning time on a known dead end). The period/points shapes above come from NWS's published
API docs and OpenAPI spec (as cross-checked through secondary sources, since the primary docs
site itself is also on a blocked domain), not a captured live response. `nws.test.ts` exercises
the parser and formatter against fixture JSON built from those documented shapes. **Please try a
real trip location once this is deployed** and report back if any field name doesn't match — the
parser is defensive (a period it can't parse is dropped rather than crashing the section, and
`parsePointsResponse`/`parseForecastResponse` throw a typed `NwsError('bad-response', …)` with a
readable message if the top-level shape is unexpected), so a mismatch should degrade to a clear
error message rather than a crash, but the actual field names should be confirmed.

**User-Agent**: NWS's docs ask API callers to send an identifying `User-Agent` header
(e.g. `AppName (contact-email)`), so their team can reach out about problem clients. Browsers
treat `User-Agent` as a forbidden header — client-side JavaScript cannot set it, `fetch` silently
drops any attempt to. There's no workaround from a phone's browser short of proxying the request
through our own API (which would add a server round-trip and a bit of Function execution cost for
no real benefit, since NWS is free and unauthenticated either way). This is called out here rather
than worked around; if NWS ever rate-limits us for it, the fix is a thin server-side proxy that
sets the header, at the cost of one more Function invocation per weather fetch.

**CORS**: whether `api.weather.gov` sends CORS headers permitting browser `fetch()` from an
arbitrary origin could not be verified from this sandbox either (same network block). If it turns
out NWS doesn't allow browser-origin requests, the fix is the same thin server-side proxy
mentioned above. Please check the Network tab on first real use — if `TripWeatherSection` reports
a `NwsError('network', …)` on a working phone with a working connection, that's the likely cause.

## Photo pipeline

1. Pick photo(s) → `createImageBitmap` decodes each → canvas draws it scaled to fit within 1600px
   on the longer side (`fitWithinMax`, unit tested) → `canvas.toBlob('image/jpeg', 0.8)`.
2. New `photo:*` record saved locally (`blobPath: null`) and the resized `Blob` stored in
   `db.blobs` keyed by the same id — this local copy is never deleted once the photo exists (even
   after a successful upload), so photos stay viewable offline and a flaky upload never loses the
   original.
3. A background queue (`photoUpload.ts`, started once per app session from `PhotoAttach`) scans
   for `photo` records with `blobPath === null` and a local blob, and — only when the browser
   reports online and someone is signed in — asks the server for an upload URL, `PUT`s the blob
   (`x-ms-blob-type: BlockBlob`), then saves the returned `blobPath` on the record. A failed
   attempt backs off per-photo (15s, 30s, 60s, … capped at 5 minutes) instead of hammering the
   API; reconnecting (`online` event) retries immediately.
4. Viewing a photo prefers the local blob; if it's not on this phone (e.g. it arrived via sync
   from the other phone, which only ever syncs the small JSON record, never the binary), it's
   fetched once via a signed read URL and cached into `db.blobs` for next time.

Nothing here needed a database migration — `photo` and `debrief` are plain synced records like
everything else, and the binary itself lives only in Blob Storage + each phone's local `db.blobs`
(never in Azure SQL, keeping rows small).

## Azure Storage setup (for the owner — about 10 minutes, once Azure is otherwise set up)

This assumes you've already done the README's steps 1–7 (resource group `camp-planner`, budget
alert, SQL, the Static Web App). Do this in the [Azure portal](https://portal.azure.com).

### 1. Create the storage account
1. Search **Storage accounts** → **+ Create**.
   - **Resource group:** `camp-planner` (the one you already made)
   - **Storage account name:** something unique, e.g. `campplannerphotos<yourinitials>`
     (lowercase letters/numbers only, no dashes)
   - **Region:** **(US) Central US** (same region as everything else, keeps things simple)
   - **Performance:** **Standard**
   - **Redundancy:** **Locally-redundant storage (LRS)** — the cheapest option; fine for photos
     that also live on your phones.
2. **Review + create** → **Create**.

### 2. Create a private container for photos
1. Open the new storage account → **Data storage → Containers** → **+ Container**.
2. Name: `photos`. **Public access level: Private (no anonymous access)** — this is important;
   the app only ever hands out short-lived signed links, never a public URL.
3. Create.

### 3. Allow the app's browser requests (CORS)
The app's own JavaScript uploads/downloads photos directly to Blob Storage using signed URLs, so
the storage account needs to allow that origin.
1. In the storage account, open **Settings → Resource sharing (CORS)** → the **Blob service** tab.
2. Add a rule:
   - **Allowed origins:** your Static Web App's URL, e.g. `https://<your-app>.azurestaticapps.net`
     (add a second row for a custom domain if you set one up later)
   - **Allowed methods:** `GET`, `PUT`, `OPTIONS`
   - **Allowed headers:** `*` (simplest; or narrow it to `x-ms-blob-type,content-type` if you'd
     rather be specific — the upload PUT sends `x-ms-blob-type` and `content-type`)
   - **Exposed headers:** `*`
   - **Max age:** `3600`
3. **Save**.

### 4. Get the connection string
1. Open **Security + networking → Access keys**.
2. Under **key1**, click **Show**, then copy the **Connection string**. Keep it private, like the
   SQL connection string.

### 5. Add the environment variables to the Static Web App
In the Static Web App (the same one from the README) → **Settings → Environment variables**
(under *Production*), add:

| Name | Value |
|---|---|
| `STORAGE_CONNECTION_STRING` | the connection string from step 4 |
| `PHOTO_CONTAINER` | `photos` (optional — this is already the default) |

Click **Apply**. No redeploy is required for environment variable changes to take effect, but the
next deploy will pick them up either way.

That's it — no database change, no code change. If you skip this setup, photos still work fully
on each phone (saved locally, shown locally); they just won't sync between the two of you or
survive an uninstall/reinstall until `STORAGE_CONNECTION_STRING` is set, at which point the
background queue automatically catches up on anything still waiting.

## Costs

- **Blob Storage, Standard LRS, hot tier:** roughly **2¢ per GB per month** (matches the estimate
  already in the README's cost table) — **verify** against the current
  [Azure Blob Storage pricing page](https://azure.microsoft.com/pricing/details/storage/blobs/)
  for the Central US region, since this wasn't reachable from this sandbox to confirm live.
  A resized photo is roughly 200–400 KB, so even a few thousand photos over the season stays
  well under a dollar a month in storage alone.
- **Egress (downloading photos):** Azure normally includes a small monthly amount of free
  outbound data, with per-GB charges above that — **verify** the current free egress allowance
  and per-GB rate on the same pricing page; it wasn't reachable from here to confirm the exact
  numbers. In practice, that only matters if photos are viewed from a phone that doesn't already
  have them cached locally (`db.blobs`) — normal day-to-day use on the phone that took the photo
  costs nothing, and the $5 budget alert from the README's step 1 will catch anything unexpected.
- **No other new costs.** No new Azure resource type beyond the storage account itself; the
  Function endpoints run on the existing free Static Web Apps plan.

## Requests for coordinator

1. **README.md**: please add the `STORAGE_CONNECTION_STRING` / `PHOTO_CONTAINER` rows to the
   "Environment variables" table, and either link to this file's Azure Storage setup section or
   fold it into the numbered setup steps (after the existing step 7, before "Install on each
   iPhone"). I didn't edit `README.md` since it's coordinator-owned.
2. **docs/PROGRESS.md**: please update the Phase 5 row to "Done, awaiting owner review" once
   this is merged, per the existing table's convention.
3. **Trip page wiring**: `TripWeatherSection` and `TripDebriefSection` are ready to be placed on
   the trip detail page per the Slots table (`{tripId}` props) whenever Phase 2's trip page
   exists — no changes needed on my end for that.
4. **No `staticwebapp.config.json` change was needed** — the existing `/api/*` → role `family`
   rule already covers the new `/api/files/*` routes. Flagging this so it's clear it wasn't
   missed, not that it's still outstanding.
5. No new npm dependencies were needed (`@azure/storage-blob` was already installed).

## Accessibility review — `src/components/*`, `src/pages/*`, `src/index.css`

Scope: read-only review, as requested — nothing in these files was edited (they belong to the
coordinator). Findings, roughly most → least important:

1. **`role="note"` is not a valid ARIA role** (`InstallHint.tsx` line 29, `Layout.tsx` line 42 —
   the preview banner). Unknown roles are ignored by browsers, falling back to the element's
   implicit role (a plain `<div>`, i.e. no role at all) — so these banners are currently *not*
   announced as anything special to assistive tech, silently. **Fix:** drop the invalid role. If
   these should be announced when they appear, use `role="status"` (polite) or `aria-live="polite"`
   on the wrapping element instead; if they're just supplementary text, no role is needed and a
   `<div>`/`<p>` is fine as-is.
2. **Save success has no live-region announcement, but save failure does** (`Settings.tsx`,
   `SaveRow`). The error case uses `role="alert"` and gets announced automatically; "Saved on
   this phone" is plain text with no `aria-live`, so a screen-reader user who submits a form
   isn't told it worked unless they go looking. **Fix:** add `aria-live="polite"` (or
   `role="status"`) to the saved-message span, matching the treatment already given to errors.
3. **`UpdatePrompt`'s `role="status"` wraps two interactive buttons** (lines 17–27). A `status`
   region is meant for an announced message, not for holding controls — some screen readers can
   make it awkward to reach the buttons after the announcement plays. **Fix:** put `role="status"`
   (or `aria-live="polite"`) on just the message `<p>`, and leave the buttons in a normal
   (non-live) sibling container.
4. **Custom radio group doesn't support arrow-key navigation** (`Settings.tsx`, `ThemeCard`,
   lines 85–98). It correctly uses `role="radiogroup"` / `role="radio"` / `aria-checked`, but per
   the ARIA Authoring Practices a radio group is normally a single tab stop with Left/Right
   (or Up/Down) arrow keys moving between options; here all three buttons are independently
   tabbable. Not broken (each option is reachable and toggleable via Tab + Enter/Space), just not
   the pattern some screen-reader/keyboard users will expect. **Fix (optional, low priority):**
   add a roving `tabIndex` (0 on the checked option, -1 on the others) and arrow-key handling, or
   swap to native `<input type="radio">` elements visually styled to match (simpler and free).
5. **Ambiguous link text**: the "Edit" link on the vehicle card (`Dashboard.tsx` line 41) reads
   as just "Edit" out of context — a screen-reader user browsing by links list (a common
   navigation mode) sees "Edit" with nothing to distinguish it if more such links exist elsewhere.
   **Fix:** add `aria-label="Edit vehicle details"` (or wrap "Edit vehicle details" in
   visually-hidden text) so the accessible name is self-describing.
6. **`fmtLb`'s empty state renders a bare em dash** (`Dashboard.tsx` line 13: `s.value === null ?
   '—' : …`). A screen reader will read this as "dash" or "em dash", not as "not set". **Fix:**
   use visually-hidden text alongside it, e.g. `<span aria-label="Not set">—</span>`, or just
   render the word "Not set".
7. **No `prefers-reduced-motion` handling** for the `animate-pulse` states (`SyncBadge`'s dot
   during `syncing`/`waking`). Continuous pulsing animation can bother users with vestibular
   disorders who've asked their OS to reduce motion. **Fix:** in `index.css`, add something like
   `@media (prefers-reduced-motion: reduce) { .animate-pulse { animation: none; } }` (Tailwind 4
   also ships a `motion-reduce:` variant that could be applied at the call site instead).
8. **Color contrast is asserted but not verified in-repo.** The warn/info/bad token pairs (e.g.
   `--color-warn` on `--color-warn-bg` in both themes) look reasonable by eye but weren't run
   through a contrast checker as part of this review (out of scope/tooling not set up here).
   **Suggestion:** run the token pairs in `index.css` through something like the WebAIM contrast
   checker or `axe` once, and pin the result — cheap insurance given how central these tokens are.
9. **Minor, not a defect:** `Field`'s `<label>` wraps arbitrary `children` (`ui.tsx` line 74–82).
   That's correct for the current usages (a single input/select/textarea per `Field`), but if a
   future call site puts something other than exactly one form control inside a `Field`, the
   implicit label association becomes ambiguous. No change needed now — just a note for whoever
   extends it next.

Nothing found here blocks shipping; items 1–3 are the ones worth picking up soonest since they're
small, mechanical fixes with a real (if narrow) user-facing gap.

## Testing

- `npx tsc -b` — passes.
- `npm test` — 48 tests, all passing (6 files, including the new `nws.test.ts`,
  `imageResize.test.ts`, `photoUpload.test.ts`).
- `npm run build` — passes (Vite + PWA precache build).
- `cd api && npm run build && npm test` — passes (28 tests, 1 pre-existing SQL integration test
  skipped without `TEST_SQL_CONNECTION_STRING`, unrelated to this phase).
- All new server-side logic (`filesConfig.ts` path/content-type rules, `filesSas.ts` SAS
  generation and expiry, `files.ts` request handling) is tested fully offline — the SAS tests use
  a fake `StorageSharedKeyCredential` and never touch the network, same approach the brief asked
  for.
- The NWS client is tested against fixture JSON only (see the note above on why it can't be
  tested live from here).
- Nothing in `src/features/journal/**` is exercised by an automated browser/DOM test — this repo's
  Vitest config runs in a Node environment (`environment: 'node'`, `include: ['src/**/*.test.ts']`,
  no `.tsx` tests, no Testing Library dependency), matching how every other feature in this
  codebase is tested. Anything that needs a real DOM (canvas resizing, the lightbox, IndexedDB
  blob storage) is manual/visual-verification territory once this lands in a running app.

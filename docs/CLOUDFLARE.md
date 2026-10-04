# Hosting on Cloudflare (email-code sign-in)

This replaces the Azure setup. Anyone can sign in with their **email address and a one-time code**. No Microsoft account is needed and you don't keep a list of allowed emails. Random visitors still can't see the app: they get a sign-in screen. Every email that signs in is recorded, and you can see the list in **Settings → People who signed in**.

## What it costs

**$0** for a family, on Cloudflare's free plans:

| Piece | Cloudflare product | Free allowance | Cost |
|---|---|---|---|
| Website + server code (`/api`) | Workers (static assets + Worker) | Page files free and unlimited; 100,000 `/api` requests a day | $0 |
| Database (sync, share links, people list) | D1 | 5 GB, 5 million rows read and 100,000 rows written a day | $0 |
| Sign-in (email codes) | Zero Trust → Access | Up to **50 people** | $0 |
| Campground search (optional) | Recreation.gov RIDB API key | — | Free |

Things to know:
- **Zero Trust may ask for a payment method** when you choose the Free plan. Cloudflare uses it to confirm your identity; the Free plan is $0. (Couldn't confirm from the build sandbox: *verify* at signup.)
- **The 50-person limit counts everyone who signs in**, including people you didn't invite. If you ever get near 50, you can remove people in Zero Trust → **My Team → Users**, or add a Block rule (step 4).
- **Photo backup isn't included.** On Cloudflare, photos stay on the phone that took them. Cloud photo backup would need Cloudflare R2; its free tier is 10 GB, but it needs a payment method. Ask first if you want it.
- If a free limit is ever reached, requests are refused until the next day. You are **never billed** on the Free plans.

## One-time setup (about 30 minutes, on a computer)

Menu names in Cloudflare's dashboard move around now and then. If something looks different, use the search box at the top of the dashboard.

### 1. Create the Cloudflare account
Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) (free).

### 2. Create the Worker from GitHub (done)
**Workers & Pages → Create → Import a repository** → `camping`, branch `dev`, build command `npm run build`, deploy command `npx wrangler deploy`.
- The repo's `wrangler.jsonc` describes everything else: the app files in `dist/`, the server code (`server/worker.ts`), and the database.
- `"name"` in `wrangler.jsonc` must match the Worker's name in the dashboard (it's `camping`). If you named the Worker something else, tell Claude or change that line.
- Every push to `dev` redeploys automatically.

### 3. The database (automatic)
The first deploy after `wrangler.jsonc` was added creates a D1 database named **`camp-planner`** and connects it as `DB`. Check under **Storage & Databases → D1**. The tables are created the first time the app syncs.

If the deploy log says it couldn't create the database (a permissions error), create it yourself: **D1 → Create database → `camp-planner`**, copy its **Database ID**, and add `"database_id": "<that id>"` next to `"database_name"` in `wrangler.jsonc` (or ask Claude to).

### 4. Turn on sign-in (Access)
1. Open **Zero Trust** from the dashboard sidebar. Pick a **team name**. Your *team domain* becomes `<team>.cloudflareaccess.com`. Choose the **Free** plan.
2. **Settings → Authentication → Login methods → Add new → One-time PIN.** This is the email code.
3. Back on the Worker: **Settings → Domains & Routes → workers.dev → Enable Cloudflare Access** (the Worker's **Access** tab leads to the same place). Copy the **AUD tag** it shows.
4. Cloudflare creates the Access application with a rule allowing only your Cloudflare account email. Open it (**Zero Trust → Access → Applications**, or the "Manage" link) and change it:
   - **Policy:** action **Allow**, include **Everyone**. Rename it `Everyone with an email`.
   - **Login methods:** One-time PIN.
   - **Session duration:** 1 month, so phones rarely need a new code. The app works offline regardless.
5. Share links without signing in (*verify*: not certain Cloudflare allows extra rules on a `workers.dev` address). Add a second **Self-hosted** application:
   - **Domains:** `camping.<your-subdomain>.workers.dev/s`, `…/assets`, `…/api/share`
   - **Policy:** action **Bypass**, include **Everyone**.

   The `/assets` files are the app's code and built-in campground data. They contain no trips or personal data. If Cloudflare won't accept this, share links still work, but the person you send one to must enter their email code first.
6. Optional, to block someone: edit the first application's policy and add an **Exclude** rule → **Emails** → their address.

### 5. Settings (Worker → Settings → Variables and Secrets)

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (from step 4.1) |
| `ACCESS_AUD` | the AUD tag from step 4.3 |
| `OWNER_EMAIL` | your email. You see the People list. |
| `FAMILY_EMAILS` | your spouse's email (comma-separated if more). These people share your trips. |
| `RIDB_API_KEY` | optional (type *Secret*): free key from [ridb.recreation.gov](https://ridb.recreation.gov) for Recreation.gov campground search |

Saving deploys them right away. They survive later deploys (`keep_vars` in `wrangler.jsonc`).

**Who sees what:** you and anyone in `FAMILY_EMAILS` share one set of trips. Anyone else who signs in gets their own empty space and can plan their own trips. They never see yours, except through a share link you send.

### 6. Check it
1. Open `https://camping.<your-subdomain>.workers.dev` (shown on the Worker's Overview) on your phone. Enter your email, then type the code from the email.
2. **Settings → Account** should show your email. **Settings → People who signed in → Show people** should list you.
3. Add a test item on one phone and check it appears on the other after a sync.
4. `…workers.dev/api/health` (signed in) should say `"store":"d1","signIn":"access"`.

### 7. Move your data from the Azure site
Each web address keeps its own copy of the data on the phone, so the new site starts empty:
1. On the **old** site, on the phone with the most up-to-date data: **Settings → Backup → Back up now**, and save the file to Files/iCloud Drive.
2. On the **new** site, on the same phone: sign in, then **Settings → Backup → Restore from file**. The phone then syncs everything to the new database.
3. On the other phone, just sign in to the new site. It downloads everything.
4. On iPhone, remove the old home-screen icon and **Share → Add to Home Screen** from the new site.

When the new site works, you can delete the Azure resource group so Azure can never bill you. The GitHub workflow skips the Azure deploy once its `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is removed.

## How it works (for maintainers)
- `wrangler.jsonc` serves `dist/` as static assets (single-page app fallback, `public/_headers`) and runs `server/worker.ts` only for `/api/*`, which hands off to `server/router.ts`.
- `server/access.ts` verifies Access's signed token (`Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie) against `https://<team>/cdn-cgi/access/certs`: RS256 signature, audience, issuer and expiry. Without `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` every private route answers 503. The exception is local development with `DEV_USER_EMAIL` set.
- `server/d1Store.ts` implements the same `Store` as Azure SQL (`api/src/lib/store.ts`), plus `people` and token-only share-link lookup. Uploads are written in pieces of 1.5 MB or less to stay under D1's value-size limit and the 50-queries-per-request limit. The phone resends anything left over.
- Households: `family` for `OWNER_EMAIL` + `FAMILY_EMAILS`, otherwise `person:<email>`.
- South Dakota lake report PDFs are read **on the phone** (`src/features/fishing/sdPdf.ts`): the server only finds the report and passes the official PDF along. This keeps server work within the free plan's CPU limit.
- Public routes: `GET /api/health`, `GET /api/share/<token>`. Owner only: `GET /api/people`. `GET /api/login?next=` returns to the app after Access signs someone in. The app links there because the offline cache would otherwise answer a page reload without asking Cloudflare.

**Local run of the Cloudflare server (optional):**
```sh
npm run build
npx wrangler dev --var DEV_USER_EMAIL:you@example.com --var OWNER_EMAIL:you@example.com
```
`wrangler` isn't a project dependency. `npx` downloads it when needed.

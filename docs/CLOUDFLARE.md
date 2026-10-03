# Hosting on Cloudflare (email-code sign-in)

This replaces the Azure setup. Anyone can sign in with their **email address and a one-time code**. No Microsoft account is needed and you don't keep a list of allowed emails. Random visitors still can't see the app: they get a sign-in screen. Every email that signs in is recorded, and you can see the list in **Settings → People who signed in**.

## What it costs

**$0** for a family, on Cloudflare's free plans:

| Piece | Cloudflare product | Free allowance | Cost |
|---|---|---|---|
| Website | Pages | Unlimited visits, 500 builds a month | $0 |
| Server code (`/api`) | Pages Functions (Workers) | 100,000 requests a day | $0 |
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

### 2. Create the website (Pages) from GitHub
1. **Workers & Pages → Create → Pages → Connect to Git.** Authorize GitHub and choose the **`camping`** repository.
2. Settings:
   - **Project name:** e.g. `camp-planner` (the address becomes `camp-planner.pages.dev`)
   - **Production branch:** `dev`
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variables:** add `NODE_VERSION` = `22`
3. **Save and Deploy.** The first build takes a few minutes. The app opens, but with no sign-in yet, so do step 4 right away.
4. Turn off previews so other branches don't publish unprotected copies: project → **Settings → Builds → Branch control → Preview branch: None**.

The `functions/` folder becomes the app's server automatically. Nothing else to install.

### 3. Create the database (D1)
1. **Storage & Databases → D1 → Create database.** Name: `camp-planner`.
2. Back in the Pages project: **Settings → Bindings → Add → D1 database.** Variable name **`DB`**, database `camp-planner`. Save.

The tables are created automatically the first time the app syncs.

### 4. Turn on sign-in (Zero Trust → Access)
1. Open **Zero Trust** from the dashboard sidebar. Pick a **team name**. Your *team domain* becomes `<team>.cloudflareaccess.com`. Choose the **Free** plan.
2. **Settings → Authentication → Login methods → Add new → One-time PIN.** This is the email code.
3. **Access → Applications → Add an application → Self-hosted.**
   - **Name:** Camp Planner
   - **Session duration:** 1 month, so phones rarely need a new code. The app works offline regardless.
   - **Domain:** `camp-planner.pages.dev` (your project's address), path empty.
   - **Policy:** name `Everyone with an email`, action **Allow**, include **Everyone**.
   - **Login methods:** One-time PIN.
   - Save. On the application's page, copy the **Application Audience (AUD) Tag**.
4. Let share links work without signing in. Add a second **Self-hosted** application:
   - **Name:** Camp Planner share links
   - **Domains** (add each): `camp-planner.pages.dev/s`, `camp-planner.pages.dev/assets`, `camp-planner.pages.dev/api/share`
   - **Policy:** action **Bypass**, include **Everyone**.

   The `/assets` files are the app's code and built-in campground data. They contain no trips or personal data.
5. Optional, to block someone: edit the first application's policy and add an **Exclude** rule → **Emails** → their address.

If the dashboard won't accept the `pages.dev` address, open the Pages project → **Settings → General → Access policy → Enable** instead. That protects the site with your Cloudflare account email. Then edit the policy it creates (in Zero Trust → Access → Applications) to the "Everyone" rule above.

### 5. Settings (Pages project → Settings → Variables and Secrets, Production)

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (from step 4.1) |
| `ACCESS_AUD` | the AUD tag from step 4.3 |
| `OWNER_EMAIL` | your email. You see the People list. |
| `FAMILY_EMAILS` | your spouse's email (comma-separated if more). These people share your trips. |
| `RIDB_API_KEY` | optional: free key from [ridb.recreation.gov](https://ridb.recreation.gov) for Recreation.gov campground search |

Then **Deployments → latest → Retry deployment** (or push to `dev`) so the settings take effect.

**Who sees what:** you and anyone in `FAMILY_EMAILS` share one set of trips. Anyone else who signs in gets their own empty space and can plan their own trips. They never see yours, except through a share link you send.

### 6. Check it
1. Open `https://camp-planner.pages.dev` on your phone. Enter your email, then type the code from the email.
2. **Settings → Account** should show your email. **Settings → People who signed in → Show people** should list you.
3. Add a test item on one phone and check it appears on the other after a sync.
4. `https://camp-planner.pages.dev/api/health` (signed in) should say `"store":"d1","signIn":"access"`.

### 7. Move your data from the Azure site
Each web address keeps its own copy of the data on the phone, so the new site starts empty:
1. On the **old** site, on the phone with the most up-to-date data: **Settings → Backup → Back up now**, and save the file to Files/iCloud Drive.
2. On the **new** site, on the same phone: sign in, then **Settings → Backup → Restore from file**. The phone then syncs everything to the new database.
3. On the other phone, just sign in to the new site. It downloads everything.
4. On iPhone, remove the old home-screen icon and **Share → Add to Home Screen** from the new site.

When the new site works, you can delete the Azure resource group so Azure can never bill you. The GitHub workflow skips the Azure deploy once its `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is removed.

## How it works (for maintainers)
- `functions/api/[[path]].ts` sends every `/api/*` request to `server/router.ts`.
- `server/access.ts` verifies Access's signed token (`Cf-Access-Jwt-Assertion` header, or the `CF_Authorization` cookie) against `https://<team>/cdn-cgi/access/certs`: RS256 signature, audience, issuer and expiry. Without `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` every private route answers 503. The exception is local development with `DEV_USER_EMAIL` set.
- `server/d1Store.ts` implements the same `Store` as Azure SQL (`api/src/lib/store.ts`), plus `people` and token-only share-link lookup. Uploads are written in pieces of 1.5 MB or less to stay under D1's value-size limit and the 50-queries-per-request limit. The phone resends anything left over.
- Households: `family` for `OWNER_EMAIL` + `FAMILY_EMAILS`, otherwise `person:<email>`.
- South Dakota lake report PDFs are read **on the phone** (`src/features/fishing/sdPdf.ts`): the server only finds the report and passes the official PDF along. This keeps server work within the free plan's CPU limit.
- Public routes: `GET /api/health`, `GET /api/share/<token>`. Owner only: `GET /api/people`. `GET /api/login?next=` returns to the app after Access signs someone in. The app links there because the offline cache would otherwise answer a page reload without asking Cloudflare.

**Local run of the Cloudflare server (optional):**
```sh
npm run build
npx wrangler pages dev dist --d1 DB=camp-local --binding DEV_USER_EMAIL=you@example.com --binding OWNER_EMAIL=you@example.com
```
`wrangler` isn't a project dependency. `npx` downloads it when needed.

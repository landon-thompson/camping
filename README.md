# Camp Planner

A phone-first web app for planning our family's 2027 Minnesota camping season: gear and budget, trips on a map, campground bookings, forest-road routes, and checklists that work with **no cell signal**.

Everything is saved on your phone first and syncs to a small Azure database when you have signal, so the app keeps working deep in the Superior National Forest.

---

## What it costs

On Azure's free tiers the app should run for **$0–$1 a month**.

| Piece | Azure service | Cost |
|---|---|---|
| Website + login | Static Web Apps, **Free** plan | $0 |
| Server code | Functions (included with Static Web Apps) | $0 |
| Database | Azure SQL Database **free offer** (100,000 vCore-seconds + 32 GB every month, no end date), set to *auto-pause until next month* if the allowance runs out | $0 |
| Photos / GPX files (later phases) | Blob Storage | ~2¢ per GB per month |

Two things to do so there are no surprises:

1. **Upgrade the free trial to pay-as-you-go before it ends.** The trial's $200 credit lasts 30 days. Upgrading doesn't charge you anything by itself; you pay only for usage above the free amounts.
2. **Set a $5 budget alert** (step 1 below) so you get an email if anything ever starts costing money.

Services to avoid, because they would bill you: the Static Web Apps **Standard** plan ($9/month) and "Azure Database for PostgreSQL" (free for 12 months only).

---

## One-time Azure setup (about 30 minutes)

You'll do this in the [Azure portal](https://portal.azure.com) on a computer. Menu names can shift slightly over time; if something looks different, search the portal's top search bar for the service name.

### 1. Protect your wallet
1. Search **Subscriptions**, open your subscription, and if you see an **Upgrade** banner, follow it to switch to pay-as-you-go. You'll need to do this before the 30-day trial ends.
2. Search **Cost Management**, then open **Budgets** → **+ Add**. Name it `camp-planner`, set the amount to **$5** and the reset period to **Monthly**. Add an alert at **80%** with your email address. Save.

### 2. Create a resource group
A resource group is a folder that holds everything for this app.
- Search **Resource groups** → **+ Create**. Name: `camp-planner`. Region: **(US) Central US**. Then **Review + create** → **Create**.

### 3. Create the free database
1. Search **SQL databases** → **+ Create**.
2. At the top of the page, look for the banner offering to try Azure SQL Database for free, and click **Apply offer**. (If you don't apply the offer, the database will cost money.)
3. Fill in the form:
   - **Resource group:** `camp-planner`
   - **Database name:** `campdb`
   - **Server:** click **Create new**:
     - Server name: something unique, e.g. `camp-planner-sql-<yourinitials>`
     - Location: **(US) Central US**
     - Authentication method: **Use SQL authentication**
     - Server admin login: e.g. `campadmin`. Choose a strong password and **save both in your password manager**.
   - **Behavior when free limit is reached:** **Auto-pause the database until next month**. This is what guarantees it stays free.
4. **Networking** tab: set Connectivity method to **Public endpoint**, and set **Allow Azure services and resources to access this server** to **Yes**.
5. **Review + create** → **Create**. It takes a few minutes.
6. When it's done, open the database and go to **Settings → Connection strings**. Copy the **ADO.NET (SQL authentication)** string and replace `{your_password}` with the password from above. Keep this string private; you'll paste it in step 5.

The app creates its own tables the first time it connects. There's nothing to run by hand.

### 4. Create the Static Web App (the website)
1. Search **Static Web Apps** → **+ Create**.
   - **Resource group:** `camp-planner`
   - **Name:** `camp-planner`
   - **Plan type:** **Free**
   - **Deployment source:** **Other**. Our GitHub workflow already handles deploys, so Azure shouldn't add its own.
2. **Review + create** → **Create**.
3. Open the new Static Web App. On **Overview**, note the **URL** (something like `https://<random-name>.azurestaticapps.net`). This is the app's address.
4. Click **Manage deployment token** and copy the token.

### 5. Connect GitHub to Azure
1. On GitHub, open this repository, then **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
   - Value: the deployment token from step 4.
2. In the Azure portal, open the Static Web App → **Settings → Environment variables** (under *Production*) and add:

   | Name | Value |
   |---|---|
   | `SQL_CONNECTION_STRING` | the connection string from step 3 |
   | `HOUSEHOLD_ID` | `family` |

   Click **Apply**.

### 6. Deploy
On GitHub: **Actions → Test & deploy → Run workflow**, choose branch **`dev`**, and run it. Every push to `dev` deploys automatically after the tests pass.

To check it worked, open `https://<your-app-url>/api/health`. You should see `{"ok":true,"store":"sql"}`.

### 7. Invite yourselves (only invited people can see data)
In the Static Web App, open **Settings → Role management → Invite**. Do this once for you and once for your wife:
- **Authentication provider:** Microsoft Entra ID
- **Invitee details:** the email address of that person's Microsoft account
- **Role:** `family`. It must be exactly this word.
- **Invitation expiration:** e.g. 24 hours

Click **Generate** and send the link to that person. They open it on their iPhone and sign in with their Microsoft account.

Your wife needs a (free) Microsoft account. She can create one at [account.microsoft.com](https://account.microsoft.com) using her existing email address.

### 8. Install on each iPhone
Open the app URL in **Safari**, tap **Share → Add to Home Screen**, then always open it from that icon. This matters: iPhone can clear offline data for sites that are only used as a Safari tab.

---

## How it works (for the curious)

- **App:** React + TypeScript + Tailwind, built with Vite, installable as a Progressive Web App (PWA). The service worker caches the app, so it opens with no signal.
- **Data:** stored on the phone in IndexedDB (via Dexie). Each item (a gear item, a checklist item, …) is one small record that syncs on its own. If you both edit the same record offline, **the most recent edit wins**.
- **API:** Azure Functions in [`api/`](api). `GET /api/sync` pulls changes and `POST /api/sync` pushes local edits. Only signed-in users with the `family` role can call it; this is enforced by both [`staticwebapp.config.json`](public/staticwebapp.config.json) and the code.
- **Database:** Azure SQL. Records are stored as JSON rows (see [`api/src/lib/migrations.ts`](api/src/lib/migrations.ts)). Migrations run automatically.
- **Free-tier wake-up:** the free database pauses when idle. The first sync after a quiet spell can take about a minute while it wakes up. The app shows "Waking database…" and retries by itself, and you can keep using it in the meantime.
- **Unverified numbers** (payload, tow rating, roof limit, boat weight) carry a **verify** or **estimate** tag until you confirm them. Edit them in Settings.

### Environment variables

| Where | Name | Purpose |
|---|---|---|
| Azure Static Web App | `SQL_CONNECTION_STRING` | Database connection (secret) |
| Azure Static Web App | `HOUSEHOLD_ID` | Family workspace id, `family` |
| GitHub secret | `AZURE_STATIC_WEB_APPS_API_TOKEN` | Lets GitHub Actions deploy (secret) |
| Local only (`api/local.settings.json`) | `DATA_STORE=memory` | Throwaway in-memory database for development |

Secrets are never committed. `.env*` and `api/local.settings.json` are git-ignored.

---

## Development

Requires Node 22+.

```bash
npm install            # app
npm run dev            # http://localhost:5173 (runs "This device only", no login/sync)
npm test               # unit tests
npm run build          # production build into dist/

cd api
npm install
npm run build
npm test               # API tests (database test is skipped unless configured below)
```

**Full stack locally (login + API):** install [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) and the Static Web Apps CLI (`npm i -g @azure/static-web-apps-cli`). Then:

```bash
cp api/local.settings.sample.json api/local.settings.json   # uses the in-memory store
npm run build && swa start dist --api-location api
```

Open http://localhost:4280. The emulator shows a mock sign-in form; put `family` in **User's roles**.

**Testing the database code against real SQL Server** (needs Docker):

```bash
docker run -d --name camp-sql -e ACCEPT_EULA=Y -e 'MSSQL_SA_PASSWORD=Local_Dev_Pa55!' -p 1433:1433 mcr.microsoft.com/mssql/server:2022-latest
cd api && TEST_SQL_CONNECTION_STRING='Server=localhost,1433;User Id=sa;Password=Local_Dev_Pa55!;Encrypt=true;TrustServerCertificate=true' npm test
```

GitHub Actions runs all of this, including the SQL Server test, on every push.

---

## Build phases

See [`docs/PROGRESS.md`](docs/PROGRESS.md) for status, decisions and open items.

#!/usr/bin/env bash
# One-time Azure setup for Camp Planner. Run it in Azure Cloud Shell (Bash):
#   portal.azure.com → the >_ icon at the top → Bash
#   gh auth login                      # sign in to GitHub (follow the prompts)
#   gh repo clone landon-thompson/camping -- --branch dev && cd camping
#   bash scripts/azure-setup.sh you@example.com wife@example.com
#
# Creates (all free tier, Central US): resource group, Azure SQL server + free
# database (auto-pauses instead of billing), Static Web App (Free), app settings,
# the GitHub deploy secret, starts a deploy, and sends family invitations.
# Optional photo storage: add --photos (Blob Storage, ~2¢/GB/month).
# No database (app keeps data on each phone, no sync): add --no-db.
set -euo pipefail

RG=camp-planner
LOCATION=centralus
REPO=landon-thompson/camping
SWA_NAME=camp-planner
DB_NAME=campdb
SQL_ADMIN=campadmin

PHOTOS=false
NO_DB=false
EMAILS=()
for arg in "$@"; do
  case "$arg" in
    --photos) PHOTOS=true ;;
    --no-db) NO_DB=true ;;
    *@*) EMAILS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
if [ ${#EMAILS[@]} -eq 0 ]; then
  echo "Usage: bash azure-setup.sh your@email [spouse@email] [--photos] [--no-db]" >&2
  echo "Use the email of each person's Microsoft account." >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$*"; }

step "Checking your Azure login"
SUB_NAME=$(az account show --query name -o tsv)
echo "Using subscription: $SUB_NAME"

step "Resource group $RG ($LOCATION)"
az group create -n "$RG" -l "$LOCATION" -o none

# ---------------------------------------------------------------- database
if [ "$NO_DB" = false ]; then
SUFFIX=$(openssl rand -hex 3)
SQL_SERVER=$(az sql server list -g "$RG" --query "[0].name" -o tsv 2>/dev/null || true)
if [ -z "$SQL_SERVER" ]; then
  SQL_SERVER="camp-planner-sql-$SUFFIX"
  # Random strong password (upper, lower, digit, symbol; no ; or quotes).
  SQL_PASSWORD="Cp9-$(openssl rand -hex 14)-Qz"
  step "SQL server $SQL_SERVER (this takes a few minutes)"
  az sql server create -g "$RG" -n "$SQL_SERVER" -l "$LOCATION" \
    --admin-user "$SQL_ADMIN" --admin-password "$SQL_PASSWORD" -o none
  echo "SQL admin password (save it in your password manager): $SQL_PASSWORD"
else
  # Re-run: set a fresh admin password (Cloud Shell doesn't keep the old output).
  SQL_PASSWORD="Cp9-$(openssl rand -hex 14)-Qz"
  step "SQL server $SQL_SERVER already exists — setting a new admin password"
  az sql server update -g "$RG" -n "$SQL_SERVER" --admin-password "$SQL_PASSWORD" -o none
  echo "New SQL admin password (save it in your password manager): $SQL_PASSWORD"
fi

step "Allow Azure services (the app's API) to reach the database"
az sql server firewall-rule create -g "$RG" -s "$SQL_SERVER" -n AllowAzureServices \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none

if ! az sql db show -g "$RG" -s "$SQL_SERVER" -n "$DB_NAME" -o none 2>/dev/null; then
  step "Free database $DB_NAME (Azure SQL free offer, auto-pause when the free amount is used)"
  az sql db create -g "$RG" -s "$SQL_SERVER" -n "$DB_NAME" \
    -e GeneralPurpose -f Gen5 -c 2 --compute-model Serverless \
    --backup-storage-redundancy Local \
    --use-free-limit --free-limit-exhaustion-behavior AutoPause -o none
fi

SQL_CONN=$(az sql db show-connection-string -c ado.net -s "$SQL_SERVER" -n "$DB_NAME" -o tsv)
SQL_CONN=${SQL_CONN//<username>/$SQL_ADMIN}
SQL_CONN=${SQL_CONN//<password>/$SQL_PASSWORD}
fi
SUFFIX=${SUFFIX:-$(openssl rand -hex 3)}

# ---------------------------------------------------------------- web app
if ! az staticwebapp show -n "$SWA_NAME" -g "$RG" -o none 2>/dev/null; then
  step "Static Web App $SWA_NAME (Free plan)"
  az staticwebapp create -n "$SWA_NAME" -g "$RG" -l "$LOCATION" --sku Free -o none
fi
HOST=$(az staticwebapp show -n "$SWA_NAME" -g "$RG" --query defaultHostname -o tsv)

SETTINGS=("HOUSEHOLD_ID=family")
if [ "$NO_DB" = false ]; then SETTINGS+=("SQL_CONNECTION_STRING=$SQL_CONN"); fi

# ---------------------------------------------------------------- photos (optional)
if [ "$PHOTOS" = true ]; then
  STORAGE=$(az storage account list -g "$RG" --query "[0].name" -o tsv 2>/dev/null || true)
  if [ -z "$STORAGE" ]; then
    STORAGE="campphotos$SUFFIX"
    step "Photo storage $STORAGE (Standard LRS, private)"
    az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" --sku Standard_LRS \
      --kind StorageV2 --allow-blob-public-access false --min-tls-version TLS1_2 -o none
  fi
  STORAGE_CONN=$(az storage account show-connection-string -g "$RG" -n "$STORAGE" -o tsv)
  az storage container create -n photos --connection-string "$STORAGE_CONN" -o none
  az storage cors clear --services b --connection-string "$STORAGE_CONN"
  az storage cors add --services b --methods GET PUT OPTIONS --origins "https://$HOST" \
    --allowed-headers '*' --exposed-headers '*' --max-age 3600 --connection-string "$STORAGE_CONN"
  SETTINGS+=("STORAGE_CONNECTION_STRING=$STORAGE_CONN" "PHOTO_CONTAINER=photos")
fi

step "App settings (secrets stay in Azure, never in GitHub)"
az staticwebapp appsettings set -n "$SWA_NAME" -g "$RG" --setting-names "${SETTINGS[@]}" -o none

# ---------------------------------------------------------------- GitHub + deploy
TOKEN=$(az staticwebapp secrets list -n "$SWA_NAME" -g "$RG" --query properties.apiKey -o tsv)
if command -v gh >/dev/null 2>&1; then
  step "GitHub: deploy secret + first deploy"
  gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
  printf '%s' "$TOKEN" | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo "$REPO"
  gh workflow run ci-deploy.yml --repo "$REPO" --ref dev
  echo "Deploy started: https://github.com/$REPO/actions"
else
  echo
  echo "GitHub CLI not found. Add this as repository secret AZURE_STATIC_WEB_APPS_API_TOKEN"
  echo "(GitHub → $REPO → Settings → Secrets and variables → Actions), then run the"
  echo "'Test & deploy' workflow on branch dev:"
  echo "$TOKEN"
fi

# ---------------------------------------------------------------- invitations
step "Family invitations (open each link on that person's iPhone and sign in)"
for email in "${EMAILS[@]}"; do
  LINK=$(az staticwebapp users invite -n "$SWA_NAME" -g "$RG" \
    --authentication-provider aad --user-details "$email" --roles family \
    --domain "$HOST" --invitation-expiration-in-hours 168 --query "invitationUrl || properties.invitationUrl" -o tsv)
  echo "$email → $LINK"
done

cat <<EOF

==> Done. Your app: https://$HOST
    Check the API once the deploy finishes (~3 min): https://$HOST/api/health
    ("store":"sql" with a database, "not-configured" with --no-db — both are fine)

Two things to do in the portal (can't be scripted safely):
  1. Subscriptions → $SUB_NAME → Upgrade to pay-as-you-go (the free trial ends after 30 days).
  2. Cost Management → Budgets → Add: \$5 monthly, alert at 80% to your email.

Then on each iPhone: open the invitation link in Safari, sign in, and Share → Add to Home Screen.
EOF

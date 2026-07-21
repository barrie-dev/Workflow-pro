# Azure provisioning · PostgreSQL + Blob (account key)

Concreet CLI-stappenplan om vanaf nul de twee kern-resources aan te maken en de
koppeling te bewijzen. EU-regio (GDPR): **West Europe**. Auth voor Blob:
**account key** (werkt met de bestaande adapter). Voer dit uit met de Azure CLI
(`az`) ingelogd op je abonnement.

> Secrets (wachtwoord, storage-key) blijven in je shell of Key Vault. Plak ze
> nooit in een chat of commit. De `cloud:check`-uitvoer bevat geen secrets en
> mag je wel delen.

## 0. Basis

```bash
az login
RG=monargo-prod
LOC=westeurope
az group create -n "$RG" -l "$LOC"
```

## 1. PostgreSQL Flexible Server (burstable om te starten)

```bash
PG=monargo-pg-$RANDOM            # moet globaal uniek zijn
PGADMIN=monargoadmin
PGPASS='ZET-EEN-STERK-WACHTWOORD'   # genereer er een; bewaar in Key Vault

az postgres flexible-server create \
  --resource-group "$RG" --name "$PG" --location "$LOC" \
  --tier Burstable --sku-name Standard_B1ms --version 16 \
  --storage-size 32 \
  --admin-user "$PGADMIN" --admin-password "$PGPASS" \
  --public-access None --yes

# database in de server
az postgres flexible-server db create -g "$RG" -s "$PG" -d monargo

# firewall: Azure-diensten (voor de Container App) + je eigen IP (voor migraties vanaf je laptop)
az postgres flexible-server firewall-rule create -g "$RG" -n "$PG" \
  --rule-name allow-azure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0
MYIP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create -g "$RG" -n "$PG" \
  --rule-name my-ip --start-ip-address "$MYIP" --end-ip-address "$MYIP"
```

Connectiestring (flexible server gebruikt de admin-naam rechtstreeks):

```
postgresql://<PGADMIN>:<PGPASS>@<PG>.postgres.database.azure.com:5432/monargo?sslmode=require
```

## 2. Storage Account + private container (met herstelvangnet)

```bash
SA=monargostore$RANDOM          # 3-24 lowercase, globaal uniek
az storage account create -g "$RG" -n "$SA" -l "$LOC" \
  --sku Standard_LRS --kind StorageV2 \
  --allow-blob-public-access false --min-tls-version TLS1_2

KEY=$(az storage account keys list -g "$RG" -n "$SA" --query "[0].value" -o tsv)

az storage container create --account-name "$SA" --account-key "$KEY" \
  -n monargo-files --public-access off

# recovery net: soft delete + versioning (DEV-07)
az storage account blob-service-properties update -g "$RG" -n "$SA" \
  --enable-delete-retention true --delete-retention-days 14 --enable-versioning true
```

Blob-endpoint: `https://<SA>.blob.core.windows.net`

## 3. Env-variabelen zetten (lokaal om te verifiëren, later als Container App-secrets)

```bash
export STORAGE_ADAPTER=postgres
export DATABASE_URL="postgresql://<PGADMIN>:<PGPASS>@<PG>.postgres.database.azure.com:5432/monargo?sslmode=require"
export OBJECT_STORAGE_ADAPTER=azure-blob
export OBJECT_STORAGE_ENDPOINT="https://<SA>.blob.core.windows.net"
export OBJECT_STORAGE_BUCKET=monargo-files
export OBJECT_STORAGE_ACCESS_KEY_ID="<SA>"
export OBJECT_STORAGE_SECRET_ACCESS_KEY="$KEY"
```

(PowerShell: `$env:STORAGE_ADAPTER = "postgres"` enz.)

## 4. Migraties + koppeling verifiëren

```bash
node scripts/run-migrations.js        # past migrations/sql/ toe op de lege Azure-DB
npm run cloud:check                    # verbindt met DB + Blob, print geen secrets
```

`npm run cloud:check` groen = de koppeling staat. Deel gerust de uitvoer.

## Daarna (aparte stap, DEV-06)

Container App / App Service met het image, deze env als secrets, migratie als
init-stap, probes op `/api/health` en `/api/ready`. Zie
[DEPLOY-RUNBOOK.md](DEPLOY-RUNBOOK.md) §6.

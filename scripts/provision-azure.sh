#!/usr/bin/env bash
# DEV-06 · Azure provisioning in één run (PostgreSQL + Blob, account key).
#
# Maakt vanaf nul een resource group, PostgreSQL Flexible Server + database en
# een Storage Account + private container in een EU-regio, schrijft de
# connectie-env naar een lokaal .env.azure (gitignored), en verifieert daarna de
# koppeling met scripts/check-cloud-connection.js.
#
# Vereist: Azure CLI (`az`), ingelogd via `az login`. Draai in Git Bash of WSL.
# Secrets (DB-wachtwoord, storage-key) worden AUTOMATISCH gegenereerd/opgehaald
# en alleen naar .env.azure geschreven · nooit naar stdout.
#
#   bash scripts/provision-azure.sh
#
# Overschrijfbaar via env: AZ_RG, AZ_LOC, AZ_DB, AZ_CONTAINER, AZ_PG, AZ_SA,
# AZ_PGADMIN, AZ_PUBLIC_ACCESS.

set -euo pipefail

RG="${AZ_RG:-monargo-prod}"
LOC="${AZ_LOC:-belgiumcentral}"
DBNAME="${AZ_DB:-monargo}"
CONTAINER="${AZ_CONTAINER:-monargo-files}"
PGADMIN="${AZ_PGADMIN:-monargoadmin}"
PUBLIC_ACCESS="${AZ_PUBLIC_ACCESS:-None}"
SUFFIX="$(date +%s | tail -c 6)"
PG="${AZ_PG:-monargo-pg-$SUFFIX}"
SA="${AZ_SA:-monargostore$SUFFIX}"
ENVFILE=".env.azure"

echo "== Azure provisioning =="
command -v az >/dev/null 2>&1 || { echo "FOUT: Azure CLI (az) niet gevonden. Installeer eerst (zie instructies)."; exit 1; }
az account show >/dev/null 2>&1 || { echo "FOUT: niet ingelogd. Draai eerst: az login"; exit 1; }
SUB="$(az account show --query name -o tsv)"

echo "Abonnement : $SUB"
echo "Regio      : $LOC   ·  resource group: $RG"
echo "PostgreSQL : $PG    ·  database: $DBNAME"
echo "Storage    : $SA    ·  container: $CONTAINER"
echo
read -r -p "Deze resources aanmaken? (y/N) " CONFIRM
[ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ] || { echo "Afgebroken."; exit 0; }

# Sterk, URL-veilig DB-wachtwoord (upper+lower+digit = 3 Azure-categorieën).
# Let op: lees een EINDIGE hoeveelheid urandom en snijd met bash-slicing.
# `tr </dev/urandom | head` zou onder pipefail een SIGPIPE geven en het script
# stil afbreken (klassieke valkuil).
PWRAW="$(head -c 4096 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9')"
PGPASS="Aa1${PWRAW:0:24}"

echo "-> resource providers registreren (eenmalig per abonnement, kan enkele minuten duren)"
# Een nieuw abonnement moet de namespaces expliciet registreren voordat je er
# resources van kunt maken (MissingSubscriptionRegistration). --wait blokkeert
# tot het klaar is; al-geregistreerd wordt overgeslagen.
for NS in Microsoft.DBforPostgreSQL Microsoft.Storage; do
  STATE="$(az provider show -n "$NS" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
  if [ "$STATE" = "Registered" ]; then
    echo "   $NS: al geregistreerd"
  else
    echo "   $NS: $STATE → registreren (even geduld)..."
    az provider register --namespace "$NS" --wait
    echo "   $NS: geregistreerd"
  fi
done

echo "-> resource group"
# Een resource group is enkel metadata; resources mogen in een ANDERE regio dan
# de group staan. Bestaat de group al (bv. in westeurope van een vorige poging),
# hergebruik hem dan · `az group create` met een andere -l zou anders falen.
if az group show -n "$RG" -o none 2>/dev/null; then
  RG_LOC="$(az group show -n "$RG" --query location -o tsv)"
  echo "   bestaat al in $RG_LOC · hergebruiken (data komt in $LOC, dat is wat telt voor residentie)"
else
  az group create -n "$RG" -l "$LOC" -o none
fi

echo "-> PostgreSQL Flexible Server (burstable) + database (kan enkele minuten duren)"
# Hervatbaar: bestaat er al een monargo-pg-server in de group, hergebruik hem
# (voorkomt een tweede, verweesde server na een herstart). Anders: probeer een
# rij EU-regio's tot er één lukt (capaciteit); overschrijfbaar via AZ_REGIONS.
EXISTING_PG="$(az postgres flexible-server list -g "$RG" --query "[?starts_with(name, 'monargo-pg')].name | [0]" -o tsv 2>/dev/null || true)"
if [ -n "$EXISTING_PG" ]; then
  PG="$EXISTING_PG"
  LOC="$(az postgres flexible-server show -g "$RG" -n "$PG" --query location -o tsv)"
  # Het wachtwoord van een eerdere run is niet bewaard; zet het admin-wachtwoord
  # naar het nieuw gegenereerde, zodat de connectiestring in .env.azure klopt.
  echo "   bestaande server $PG in $LOC · hergebruiken (admin-wachtwoord herzetten)"
  az postgres flexible-server update -g "$RG" -n "$PG" --admin-password "$PGPASS" -o none
else
  REGIONS="${AZ_REGIONS:-$LOC northeurope francecentral germanywestcentral swedencentral}"
  PG_OK=""
  for R in $REGIONS; do
    echo "   probeer regio $R ..."
    set +e
    ERR="$(az postgres flexible-server create \
      --resource-group "$RG" --name "$PG" --location "$R" \
      --tier Burstable --sku-name Standard_B1ms --version 16 --storage-size 32 \
      --admin-user "$PGADMIN" --admin-password "$PGPASS" \
      --public-access "$PUBLIC_ACCESS" --yes -o none 2>&1)"
    RC=$?
    set -e
    if [ $RC -eq 0 ]; then LOC="$R"; PG_OK=1; echo "   PostgreSQL aangemaakt in $R"; break; fi
    if echo "$ERR" | grep -qiE "not accepting new customers|RequestDisallowedByAzure|not available|OfferRestricted|OverQuota|LocationNotAvailable|SkuNotAvailable|not supported|InvalidResourceLocation|NoRegisteredProvider|ServiceUnavailable"; then
      echo "   $R kan de server nu niet leveren · volgende regio..."
      continue
    fi
    echo "   Onverwachte fout in $R:"; echo "$ERR"; exit 1
  done
  [ -n "$PG_OK" ] || { echo "FOUT: geen enkele geprobeerde regio accepteerde de PostgreSQL-server. Probeer met bv. AZ_REGIONS=\"polandcentral norwayeast\" opnieuw."; exit 1; }
fi

echo "-> database $DBNAME"
set +e
DBERR="$(az postgres flexible-server db create -g "$RG" -s "$PG" -n "$DBNAME" -o none 2>&1)"
DBRC=$?
set -e
if [ $DBRC -ne 0 ]; then
  echo "$DBERR" | grep -qi "already exists" && echo "   bestaat al · ok" || { echo "$DBERR"; exit 1; }
fi

echo "-> firewall: Azure-diensten + je eigen IP"
# firewall-rule: --server-name is de server, --name is de REGELnaam.
az postgres flexible-server firewall-rule create -g "$RG" --server-name "$PG" \
  --name allow-azure --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none || true
MYIP="$(curl -s https://api.ipify.org || true)"
if [ -n "$MYIP" ]; then
  az postgres flexible-server firewall-rule create -g "$RG" --server-name "$PG" \
    --name my-ip --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none || true
  echo "   je IP ($MYIP) toegevoegd"
fi

echo "-> Storage Account + private container + herstelvangnet"
# Hervatbaar: bestaande monargostore-account hergebruiken (geen dubbele).
EXISTING_SA="$(az storage account list -g "$RG" --query "[?starts_with(name, 'monargostore')].name | [0]" -o tsv 2>/dev/null || true)"
if [ -n "$EXISTING_SA" ]; then
  SA="$EXISTING_SA"; echo "   bestaande storage $SA · hergebruiken"
else
  az storage account create -g "$RG" -n "$SA" -l "$LOC" \
    --sku Standard_LRS --kind StorageV2 --allow-blob-public-access false --min-tls-version TLS1_2 -o none
fi
KEY="$(az storage account keys list -g "$RG" -n "$SA" --query '[0].value' -o tsv)"
az storage container create --account-name "$SA" --account-key "$KEY" -n "$CONTAINER" --public-access off -o none
az storage account blob-service-properties update -g "$RG" -n "$SA" \
  --enable-delete-retention true --delete-retention-days 14 --enable-versioning true -o none

echo "-> env naar $ENVFILE (gitignored) schrijven"
umask 077
cat > "$ENVFILE" <<ENV
# Gegenereerd door scripts/provision-azure.sh · $(date -u +%Y-%m-%dT%H:%M:%SZ)
# BEVAT SECRETS · niet committen, niet delen. (.env.* staat in .gitignore)
STORAGE_ADAPTER=postgres
DATABASE_URL=postgresql://$PGADMIN:$PGPASS@$PG.postgres.database.azure.com:5432/$DBNAME?sslmode=require
OBJECT_STORAGE_ADAPTER=azure-blob
OBJECT_STORAGE_ENDPOINT=https://$SA.blob.core.windows.net
OBJECT_STORAGE_BUCKET=$CONTAINER
OBJECT_STORAGE_ACCESS_KEY_ID=$SA
OBJECT_STORAGE_SECRET_ACCESS_KEY=$KEY
ENV

echo
echo "Resources aangemaakt. Env in $ENVFILE (geen secrets hierboven getoond)."
echo "-> migraties toepassen + koppeling verifiëren"
set -a; . "$ENVFILE"; set +a
node scripts/run-migrations.js
npm run cloud:check

echo
echo "Klaar. Bewaar het DB-wachtwoord/storage-key uit $ENVFILE in Key Vault en"
echo "zet dezelfde variabelen later als Container App-secrets (DEPLOY-RUNBOOK §6)."

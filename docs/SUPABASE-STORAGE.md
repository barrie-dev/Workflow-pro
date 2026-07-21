# Bestandsopslag op Supabase Storage (S3-compatibel)

Op Render staat objectopslag standaard op `local` = de containerdisk, die
**efemeer** is: bij elke herstart/deploy verdwijnen geüploade bestanden. Los dit
op door de bestaande **s3-adapter** naar **Supabase Storage** te wijzen
(S3-compatibel) - volledig binnen Render + Supabase, geen Azure. Sinds de
productie-guardrail weigert de app trouwens te starten met `local` in productie
(tenzij expliciete override), zodat deze misconfiguratie niet stil terugkeert.

## 1. Bucket + S3-sleutels in Supabase (dashboard)

1. **Storage → New bucket**: naam `monargo-files`, **niet publiek** (private).
2. **Storage → Settings → S3 Connection**: noteer het **endpoint**
   (`https://<project-ref>.supabase.co/storage/v1/s3`) en de **regio** (jouw
   project draait in `eu-west-1`).
3. **Storage → S3 access keys → New access key**: kopieer de **Access key ID**
   en de **Secret** (de secret wordt maar één keer getoond). Bewaar ze veilig.

De bucket moet vooraf bestaan: de app maakt in productie zelf geen bucket aan
(dat is bewust; de S3-CreateBucket-call hoort niet in het productiepad).

## 2. Env-variabelen op Render (secrets, niet in git)

```
OBJECT_STORAGE_ADAPTER=s3
OBJECT_STORAGE_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
OBJECT_STORAGE_BUCKET=monargo-files
OBJECT_STORAGE_REGION=eu-west-1
OBJECT_STORAGE_ACCESS_KEY_ID=<S3 access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<S3 secret>
```

`OBJECT_STORAGE_PATH_STYLE` hoeft niet: de adapter gebruikt standaard path-style,
wat Supabase Storage verwacht.

## 3. Uitrollen + verifiëren

1. Zet de vars, deploy opnieuw.
2. `GET /api/health` toont `objectStorageAdapter: "s3"`.
3. **Overlevingstest**: upload een bestand in de app, trigger een redeploy, en
   controleer dat het bestand er ná de deploy nog is (download werkt). Dat
   bewijst dat bestanden nu duurzaam buiten de containerdisk staan.
4. Als de branch met `npm run cloud:check` gemerged is: draai die in de
   Render-omgeving voor een geautomatiseerde put/get/signed-URL/delete-check
   tegen Supabase Storage (print geen secrets).

## Opmerkingen

- Supabase Storage is S3-compatibel; de app-adapter is dezelfde als voor MinIO
  en elke andere s3-dienst (bewezen in CI tegen MinIO). Mocht een
  Supabase-specifieke handtekening-quirk opduiken, dan lossen we die in de
  adapter op - het poortcontract en de app-code blijven gelijk.
- Test/dev: hier mag `local` blijven (wegwerpdata), of dezelfde Supabase-bucket
  in een aparte map/bucket. Zie `docs/ENVIRONMENTS.md`.

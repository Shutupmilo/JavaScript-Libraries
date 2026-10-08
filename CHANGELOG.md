# Changelog

Newest first. One entry per push.

## 2026-10-08 - MiloBarcode 1.2 and MiloProducts 1.0: the Barcode Products master library

- `data-sources/milo-barcode.js` 1.2 (MiloBarcode): the pick list shows products only - no Test or Problem rows. Every row carries `lookupLog` (what each source answered, in full), `lookupProblem` ("Yes" or "No") and `imageLink` (the picture's web address). Checks Barcode Products first; inside Barcode Products itself it says "Already in Barcode Products" instead of offering a duplicate. The `testMode` option is gone - the Lookup Log replaces it.
- Added `helpers/milo-products.js` 1.0 (MiloProducts): the Barcode Products settings in one place. `remember()` copies what you save in a scanning library into Barcode Products; `spread()` updates every entry with that barcode in every listed library. An empty field never wipes saved data, and only fields that differ are changed, so updates can't loop.

## 2026-10-07 - MiloWeb 1.1: fix for Open Food Facts failing on the phone

- Cause, reproduced in Rhino 1.9.1 (Memento's engine): Memento's web client only accepts plain text in request headers. Text joined with `+` is stored as a Rhino "ConsString", so every Open Food Facts request failed with "Can't execute http get request". Open Food Facts was the only source with a joined header (the User-Agent carrying the contact email).
- `helpers/milo-web.js` 1.1 (MiloWeb): turns every header name and value into plain text before sending. Problem rows now name the underlying error instead of Memento's general wrapper.

## 2026-10-06 - New layout and the v1.1 barcode engine

- New folders: `data-sources/` and `helpers/`. `_Unfinished/` kept.
- Added `helpers/milo-web.js` 1.0 (MiloWeb): never fails silently, asks for uncompressed replies, follows redirects itself, and hides anything after "?" in error text.
- Added `helpers/milo-secrets.js` 1.0 (MiloSecrets): reads values from the Secrets library by entry name.
- Added `data-sources/milo-barcode.js` 1.1 (MiloBarcode), replacing `data-sources/barcode.js` 1.0. Define-only. Order: your own library, Open Food Facts, EAN-Search (token needed), UPCitemdb (last resort). Test mode added; the `number` property removed.
- Removed `Scripts/`, `Scripts-2/` (unlicensed copies of jimmyknits42/mementoScripts), `.brb/` and `data-sources/barcode.js`.
- History restarted with one clean commit, so the removed files are not in the public history.

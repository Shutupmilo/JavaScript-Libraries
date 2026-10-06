# JavaScript-Libraries

Fire Lord Milo's JavaScript libraries for Memento Database. Memento loads them as **External Scripts**.

## Folders

| Folder | What's in it | Link it in Memento? |
|---|---|---|
| `data-sources/` | Autofill engines, one source per file | Yes |
| `helpers/` | Small shared tools that other files use | Yes |
| `android/` | Upgraded copies of Memento's built-in Android scripts (later) | Yes, once it exists |
| `_Unfinished/` | Work in progress | Never |

To use a folder, add its link in Memento's External Scripts, e.g. `github.com/Shutupmilo/JavaScript-Libraries/helpers`, then tick the files each script needs.

## Rules

1. Folders: lowercase words joined by hyphens. `_Unfinished` is the one exception.
2. Files: `milo-<what>.js`.
3. One global name per file, made from its file name: `milo-barcode.js` gives `MiloBarcode`.
4. Files only define things. Nothing runs when Memento loads them, so load order doesn't matter.
5. No version numbers in file names. Each file's version is in its header and in CHANGELOG.md.
6. Never rename or move a file once a Memento script ticks it. Memento saves the exact web address, so the tick would break.
7. No private data, ever. Scripts read private values from the "Secrets" library inside Memento when they run.
8. After a push, tap the refresh arrow in External Scripts on each device.

## What's here

- `helpers/milo-web.js` (MiloWeb 1.0): web requests that never fail silently.
- `helpers/milo-secrets.js` (MiloSecrets 1.0): reads values from the Secrets library by entry name.
- `data-sources/milo-barcode.js` (MiloBarcode 1.1): barcode autofill from your own library, Open Food Facts, EAN-Search and UPCitemdb.

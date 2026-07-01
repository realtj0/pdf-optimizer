# PDFO

A client-side PDF optimizer: strips orphaned/unreferenced objects and downsamples
embedded images to 300dpi (relative to their actual rendered size on the page).
Entirely in-browser — no upload, no server, hostable as a static site.

Live at https://realtj0.github.io/pdf-optimizer/

## Why

Two manual PDF cleanups (orphan removal: 4MB→108KB; 300dpi downsampling:
6.1MB→2.72MB) turned into a self-serve tool instead of doing it by hand each time.

## How it works

Two independent passes, both implemented in [pdfo.js](pdfo.js) on top of
[pdf-lib](https://github.com/Hopding/pdf-lib) (vendored locally as
`pdf-lib.min.js`, no CDN dependency, no build step). No pdf.js — everything
needed (image decode, display-size computation, resampling) is covered by
pdf-lib + `<canvas>`.

### 1. Orphan/unused object removal

pdf-lib's `PDFDocument.save()` does **not** garbage-collect unreferenced
indirect objects on its own — this is a known, intentional limitation (see
[pdf-lib#140](https://github.com/Hopding/pdf-lib/issues/140),
[#1662](https://github.com/Hopding/pdf-lib/issues/1662)). `pdfo.js` implements
its own mark-and-sweep pass (`runGC` in pdfo.js):

1. Start from `context.trailerInfo.Root` (the catalog) and `Info`.
2. Recursively walk every reachable dict/array/stream, collecting every
   `PDFRef` encountered — including refs nested inside *directly-embedded*
   (non-indirect) dicts/arrays, e.g. `/Resources` → `/XObject` → `/Im0` is very
   often a chain of direct dicts, not indirect objects. Missing this recursion
   was an actual bug caught during testing — it caused the very first GC pass
   to delete a page's real content stream because the traversal only checked
   top-level dict entries.
3. Anything in `context.enumerateIndirectObjects()` that was never reached
   gets `context.delete()`'d before `save()`.

### 2. 300dpi image downsampling

For each page, `computeImageUsage` runs a small custom content-stream
interpreter (`tokenize` + `interpretStream` in pdfo.js) that tracks the CTM
through `q`/`Q`/`cm`/`Do` operators (recursing into Form XObjects too) to
compute each image's actual on-page display size in points — displayed width
= `hypot(a, b)`, displayed height = `hypot(c, d)` of the CTM at the point of
the `Do` call. This avoids needing pdf.js at all: pdf.js's internal image IDs
don't map cleanly back to pdf-lib's object refs, so a custom interpreter over
pdf-lib's own resource dicts is actually simpler and more robust than trying
to correlate two independent parsers.

Given each image's max display size across all its uses on all pages, target
pixel dimensions = `displayInches * 300`. If the image's native pixel size
exceeds that (with a 5% margin), it gets resampled:

- **JPEG (`DCTDecode`)**: the raw, still-encoded stream bytes *are* a valid
  JPEG file already — decoded directly via `createImageBitmap`. (Note:
  pdf-lib's `decodePDFRawStream` throws on `DCTDecode` — it's for generic
  filters like Flate/LZW, not image codecs. This was the second bug caught
  during testing.)
- **Raw bitmaps** (`FlateDecode`/no filter, `DeviceRGB`/`DeviceGray`, 8 bits
  per component): manually unpacked into an `ImageData` and drawn via canvas.
- Anything else (JPEG2000, CCITT fax, JBIG2, indexed/CMYK/16-bit color, images
  with an `SMask`/`Mask`) is left untouched and reported in the UI results
  rather than risked — these are rare in practice (mostly scanned faxes) and
  not worth the risk of mishandling silently. See [ROADMAP.md](ROADMAP.md).

The resampled image is re-embedded via `pdfDoc.embedJpg()`, and every
reference to the old (oversized) image object is swapped to the new one
(`replaceRefEverywhere`, same nested-dict recursion as the GC pass). The old
image object then gets swept by the GC pass in step 1.

## Repo layout

```
index.html              PWA shell + UI (file picker, drag&drop, results)
pdfo.js                 Core logic: GC pass + content-stream interpreter + downsampling
pdf-lib.min.js           Vendored pdf-lib 1.17.1 browser bundle (no CDN)
manifest.webmanifest     PWA manifest incl. file_handlers (application/pdf)
sw.js                    Service worker: network-first HTML, stale-while-revalidate assets
favicon.svg              App icon (see "Icon" below)
```

Structure mirrors [md-viewer](../md-viewer) (MMV) — same PWA shell
conventions, same service worker caching strategy, same `launchQueue`
file-handling pattern.

## Icon

Navy rounded square, a folded-corner document labeled "PDF" cinched by a
leather belt/buckle — the belt-tightening-a-waist metaphor for "shrinking a
file", distinct from MMV's black square + monospace glyph so the two apps
don't look related.

## Recreate from scratch

```bash
mkdir pdf-optimizer && cd pdf-optimizer
git init
curl -sL -o pdf-lib.min.js https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js
```

Then recreate `pdfo.js`, `index.html`, `manifest.webmanifest`, `sw.js`,
`favicon.svg` from this repo (or copy them directly — they have no build step,
just static files served as-is).

**GitHub + Pages:**

```bash
gh repo create realtj0/pdf-optimizer --public --source=. --remote=origin --push
gh api -X POST repos/realtj0/pdf-optimizer/pages \
  -f "build_type=legacy" -f "source[branch]=main" -f "source[path]=/"
```

No GitHub Actions build — it's static files served directly from `main`.

**Local dev/testing:** any static file server works, e.g.
`python3 -m http.server 8743`. Tested via a Node harness
(`node-canvas` shimming `OffscreenCanvas`/`createImageBitmap`/`ImageData`) since
no build/bundler is involved; see git history for the harness script used
during development (not checked into the repo — it's a throwaway test tool,
not part of the shipped app).

## macOS Quick Action (Finder right-click)

Two parts, both one-time setup:

1. **Install PDFO as a Chrome PWA**: visit
   https://realtj0.github.io/pdf-optimizer/ in Chrome → install the app via
   Chrome's install button. This creates a real macOS app at
   `~/Applications/Chrome Apps.localized/PDFO.app`, registered for `.pdf`/
   `application/pdf` via `manifest.webmanifest`'s `file_handlers` (same
   mechanism as MMV.app).

2. **Quick Action**: `~/Library/Services/Optimize PDF.workflow` — an Automator
   Service scoped to PDF files in Finder, whose only step is a "Run Shell
   Script" action running:
   ```bash
   for f in "$@"; do
     open -a "PDFO" "$f"
   done
   ```
   `open -a "PDFO"` targets the installed PWA app by name (the app itself
   stays named PDFO); passing it a file triggers the app's
   `launchQueue.setConsumer` handler in `index.html`, which loads and
   processes the file immediately — no manual drag-and-drop needed. The
   Finder right-click menu item is labeled "Optimize PDF" (`NSMenuItem` in
   `Info.plist`), distinct from the app's own name.

   The `.workflow` bundle was authored directly (`Contents/Info.plist` +
   `Contents/document.wflow`) rather than built via Automator's UI. Right-click
   a PDF in Finder → **Quick Actions → Optimize PDF** should show it (Finder
   was restarted and the Services cache flushed via
   `/System/Library/CoreServices/pbs -flush` after installing it — if it's not
   showing up, that's the first thing to retry, or check
   **System Settings → General → Login Items & Extensions → Extensions** to
   make sure it's enabled).

## Known limitations (v1)

- Images with `SMask`/`Mask` (transparency) are left untouched — resampling
  would need to preserve the alpha channel (re-encode as PNG instead of JPEG),
  not yet implemented.
- JPEG2000, CCITT fax, and JBIG2-encoded images are left untouched (no decoder
  for these; native browser JPEG decode + manual raw-bitmap unpacking cover
  the common cases).
- Encrypted PDFs load with `ignoreEncryption: true` but aren't specifically
  tested.

See [ROADMAP.md](ROADMAP.md) for what's tracked.

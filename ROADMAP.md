# PDFO Roadmap

## How to read this

- **ID** — stable handle (`PDFO-n`), used to cross-reference items.
- **Priority** — `P0` blocker / `P1` should-do / `P2` nice-to-have / `P3` maybe.
- **Effort** — `S` (<1h) / `M` (a few hours) / `L` (a day+).
- **Status** — `parked` / `ready` / `blocked` / `done`.
- **Depends on** — IDs (or external prerequisites) that must land first.
- Pull order: dependencies first → Priority → smaller Effort.

## Master table

| ID | Priority | Effort | Status | Depends on | Summary |
|---|---|---|---|---|---|
| PDFO-1 | P0 | S | ready | Quick Action install | Verify Quick Action + PWA install actually works end-to-end |
| PDFO-2 | P0 | S | ready | — | Test against Thomas's own real-world PDFs, not just synthetic fixtures |
| QW-1 | P1 | S | ready | — | Per-image before/after size in the results list, not just counts |
| PDFO-3 | P1 | M | ready | — | SMask/transparency-aware downsampling (re-encode as PNG when alpha present) |
| PDFO-4 | P2 | M | parked | — | Batch: drop/pick multiple PDFs at once |
| PDFO-5 | P2 | L | parked | — | JPEG2000/CCITT/JBIG2 decode fallback |
| PDFO-6 | P3 | S | parked | — | Configurable target DPI (currently hardcoded 300) |
| PDFO-7 | P3 | S | parked | — | Confirm behavior on encrypted/password-protected PDFs |

## Quick wins (QW-*)

- **QW-1** — Per-image before/after size in the results list, not just counts. Piggybacks on any future UI touch.

## Now

- **PDFO-1** (P0/S) — Verify Quick Action + PWA install end-to-end. *Done when*: right-click a PDF in Finder → Quick Actions → "Optimize PDF" opens the installed PDFO app with that file already loaded and processed.
- **PDFO-2** (P0/S) — Run PDFO against a handful of Thomas's actual PDFs (the kind that motivated this tool), not just the synthetic test fixtures used during build. *Done when*: at least 2-3 real documents produce sane, non-corrupted output with meaningful size reduction.

## Soon

- **QW-1 / PDFO-3** (P1) — Results UI shows per-image reduction; SMask-aware downsampling so images with transparency (currently left untouched) also get shrunk. *Done when*: an image with an alpha channel gets downsampled and re-encoded as PNG, alpha intact.

## Later

- **PDFO-4** (P2/M) — Batch processing of multiple files in one go. *Done when*: dropping N PDFs produces N downloadable results (or a zip).
- **PDFO-5** (P2/L) — Decode fallback for JPEG2000/CCITT fax/JBIG2 images (currently reported as "unsupported, left unchanged"). *Done when*: at least one of the three formats downsamples correctly.
- **PDFO-6** (P3/S) — Expose target DPI as a UI setting instead of the hardcoded 300.
- **PDFO-7** (P3/S) — Confirm/document behavior on encrypted PDFs (currently loads with `ignoreEncryption: true`, untested).

## Done

- 2026-07-01 — Initial build: PWA shell, vendored pdf-lib, custom mark-and-sweep GC, content-stream interpreter for image display-size, JPEG + raw-bitmap downsampling to 300dpi, GitHub repo + Pages deploy, README, macOS Quick Action wired.

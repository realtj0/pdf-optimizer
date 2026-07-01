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
| PDFO-1 | P0 | S | ready | — | Test against Thomas's own real-world PDFs, not just synthetic fixtures |
| QW-1 | P1 | S | ready | — | Per-image before/after size in the results list, not just counts |
| PDFO-2 | P1 | M | ready | — | SMask/transparency-aware downsampling (re-encode as PNG when alpha present) |
| PDFO-3 | P2 | M | parked | — | Batch: drop/pick multiple PDFs at once |
| PDFO-4 | P2 | L | parked | — | JPEG2000/CCITT/JBIG2 decode fallback |
| PDFO-5 | P3 | S | parked | — | Configurable target DPI (currently hardcoded 300) |
| PDFO-6 | P3 | S | parked | — | Confirm behavior on encrypted/password-protected PDFs |

## Quick wins (QW-*)

- **QW-1** — Per-image before/after size in the results list, not just counts. Piggybacks on any future UI touch.

## Now

- **PDFO-1** (P0/S) — Run PDFO against a handful of Thomas's actual PDFs (the kind that motivated this tool), not just the synthetic test fixtures used during build. *Done when*: at least 2-3 real documents produce sane, non-corrupted output with meaningful size reduction.

## Soon

- **QW-1 / PDFO-2** (P1) — Results UI shows per-image reduction; SMask-aware downsampling so images with transparency (currently left untouched) also get shrunk. *Done when*: an image with an alpha channel gets downsampled and re-encoded as PNG, alpha intact.

## Later

- **PDFO-3** (P2/M) — Batch processing of multiple files in one go. *Done when*: dropping N PDFs produces N downloadable results (or a zip) — note the Quick Action path already handles multiple selected Finder files today (loops per file), this item is about the browser PWA drag-drop UI.
- **PDFO-4** (P2/L) — Decode fallback for JPEG2000/CCITT fax/JBIG2 images (currently reported as "unsupported, left unchanged"). *Done when*: at least one of the three formats downsamples correctly.
- **PDFO-5** (P3/S) — Expose target DPI as a UI setting instead of the hardcoded 300.
- **PDFO-6** (P3/S) — Confirm/document behavior on encrypted PDFs (currently loads with `ignoreEncryption: true`, untested).

## Done

- 2026-07-01 — Initial build: PWA shell, vendored pdf-lib, custom mark-and-sweep GC, content-stream interpreter for image display-size, JPEG + raw-bitmap downsampling to 300dpi, GitHub repo + Pages deploy, README, macOS Quick Action wired (PWA-open flow).
- 2026-07-01 — Reworked Quick Action to be fully headless: `~/Library/PDFO-CLI/optimize-cli.js` (Node + node-canvas shimming the same browser APIs) runs `pdfo.js` directly, no window opens, output saved as `<name>-optimized.pdf` next to the original, macOS notification on completion. Menu label changed to "Optimize PDF".
- 2026-07-01 — Fixed the Quick Action for real: services-cache rebuild needs `killall pbs`, not just `pbs -flush`; `CFBundleVersion` in the action dict has to match the actually-installed `Run Shell Script.action` (2.0.3); `workflowMetaData` needed several more keys (`presentationMode`, `systemImageName`, `useAutomaticInputType`, etc.) than a minimal example has, found by diffing against a real Automator-saved workflow already on the Mac. Confirmed working end-to-end with a notification.

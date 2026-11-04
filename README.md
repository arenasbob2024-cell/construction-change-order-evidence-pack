# Construction Change Order Evidence Pack

A one-page, browser-local tool for small contractors and subcontractors. It turns one change
order plus job photos into:

1. a printable US-Letter PDF record with the change details, amount, schedule impact, notes,
   captioned photos and blank handwritten signature lines; and
2. a plain-text checksum manifest containing the PDF filename, byte size and SHA-256.

No account, no upload, no backend, no analytics, no third-party runtime JavaScript. The PDF is
written by a small in-page writer using the PDF base-14 Helvetica fonts.

## Live site

https://construction-change-order-evidence.vercel.app/

## What it deliberately does not claim

This tool organizes records and computes file checksums in your browser. It does not prove what
happened, when a photo was taken, who signed it, or legal admissibility. No trusted timestamp or
legal certification is provided.

The local hash is an integrity check for the exported PDF. It is not an external timestamp and
does not establish who created the file.

## How it works

- `index.html` — the tool, explanatory content and FAQ.
- `assets/pdf.mjs` — dependency-free PDF writer (base-14 Helvetica, JPEG images, page layout).
- `assets/app.mjs` — form handling, canvas photo re-encoding, SHA-256, downloads and local checker.
- `privacy.html`, `about.html` — data handling and scope.
- `vercel.json` — clean URLs and a restrictive CSP (`connect-src 'none'`).

Photos are decoded, drawn to a canvas, capped at a 1600 px long edge and encoded as JPEG at
quality 0.85. This removes EXIF/GPS metadata from the embedded copy and changes the image bytes.
The original files are not retained or uploaded.

The manifest hashes the PDF only. No zip archive is produced, so there is no package hash to
confuse with the file hash.

## Local development

```bash
python3 -m http.server 4173
# open http://localhost:4173/
```

No build step and no dependencies.

## Tests

`tests/` contains the local verification harness. It is excluded from deployment by
`.vercelignore`.

```bash
cd tests
npm install            # playwright-core only
python3 make_fixtures.py
node smoke.mjs         # build a PDF directly from the writer
python3 readback.py    # PDF text/images/EXIF checks and checksum tamper test
node e2e.mjs           # browser flow, downloads, network, mobile viewport
node prod_check.mjs https://construction-change-order-evidence.vercel.app/  # production flow
python3 readback.py tests/artifacts/prod_CO-2026-014_change-order-evidence-pack.pdf tests/artifacts/prod_CO-2026-014_checksums.txt  # production PDF readback
```

The Node test uses the system Chrome through `playwright-core`; it does not download a browser.

## Deployment

Static deploy from this directory:

```bash
vercel deploy --prod --yes
```

No build command is required. `cleanUrls` is enabled; canonical URLs omit `.html`.

## Privacy boundary

Project fields and photos are processed in browser memory. The page has no analytics or
third-party script, and its CSP blocks outbound connections. Vercel may keep standard static-host
request logs (IP, user agent, path, time) for delivery and abuse prevention; project data never
appears in those requests because it never leaves the browser. See `privacy.html`.

## Prediction

`PREDICTION.md` records the pre-launch hypothesis and the day-7/day-14 GSC observation plan. It
contains no invented search volume, conversion or revenue figures. Shipping is not the same as
validated demand.
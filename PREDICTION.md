# Prediction — Construction Change Order Evidence Pack

Written before implementation and before the first production deploy (2026-11-04, Asia/Taipei).
This is a hypothesis log, not market research. No search-volume, revenue, or legal claims are made.

## Product and target user

- One-page, browser-local tool for small contractors and subcontractors (roughly 1–10 field
  staff) in the US/UK/Canada/Australia who record change orders in texts, email, paper notes and
  phone photos, then have to reconstruct a written record when a client disputes scope or payment.
- Core question the page must answer in the first screen: *Can I turn one change order plus its
  job photos into a single PDF record — with a checksum I can re-check later — without creating an
  account or uploading the job file?*
- Primary search intents to satisfy (template/tool intent, not legal intent):
  - construction change order template PDF
  - change order record template
  - contractor change order photo documentation
  - change order evidence / documentation checklist
- The page is a working tool, not a landing page. Success means a visitor can produce a readable
  PDF and a matching SHA-256 manifest in one session, on mobile or desktop.

## What we deliberately do **not** predict

- No monthly search volume, CTR, conversion or revenue numbers are invented.
- No claim that a local SHA-256 hash is a trusted timestamp or that the pack is court-ready.
- The pre-study thresholds (completion 15–20%, export 10%, useful-button 3–5%, return 3%) are
  unvalidated gates, not facts. Because this build intentionally has no server analytics, most of
  them cannot be measured in aggregate in this round; they are recorded so we do not silently
  relax them later.

## 7 / 14-day observation (GSC)

- Day 7 and day 14: check whether Google has indexed any of the 3 pages, then record GSC
  impressions, clicks and average position exactly as reported.
- Working hypothesis only: 1–3 pages indexed by day 14; impressions in the low tens at most;
  clicks near zero. A new 3-page site with no backlinks should not be expected to earn traffic in
  two weeks. Zero impressions with zero indexing is not evidence that the problem is fake.
- No traffic will be manufactured, bought, or seeded through external posting. No "request
  indexing" quota will be spent in this task.
- If day-14 indexing is zero: re-check canonical, robots.txt, sitemap.xml, HTTP status and
  internal links, then revise one title/H1 and re-observe for one week. Do not add features as a
  panic response.

## On-site signals (privacy-preserving)

- Network policy: the page makes **no** runtime requests after its own static assets load; CSP
  sets `connect-src 'none'`. No Vercel Analytics, no cookies, no third-party scripts.
- Local-only counters (localStorage, never transmitted) record event names only:
  `pack_generated`, `manifest_downloaded`, `verify_run`, `verify_match`, `useful_click`.
  They contain no project name, amount, notes, photo, filename, hash, or location.
- Consequence: we cannot compute a site-wide completion rate from these counters. Any claim about
  completion/export rates in the review must state the sample source and sample size. If Arenas
  later approves a privacy-preserving aggregate counter, it must be reviewed as a separate change.

## Stop / adjust gates (from the pre-study, with sample caveats)

- Day 14: zero indexed pages, or completion <5% **with a meaningful sample**, or bounce >85%
  **with a meaningful sample** → stop and report. With tiny samples, report the sample size and do
  not call failure.
- Between the gates: change only the title/first screen and run one more week; do not expand the
  feature set.

## Risks that would falsify the build (not the demand)

- PDF text is limited to the PDF base-14 Helvetica/WinAnsi character set; non-Latin input is
  replaced with `?` and the UI warns before export. This is a product limitation, not a demand
  signal.
- Canvas re-encoding strips EXIF/GPS but changes photo bytes and caps the long edge at 1600 px.
  The pack is a readable record, not a forensic copy of the original photo.
- Browser support: modern Chrome, Edge, Firefox and Safari; HEIC input is not decoded everywhere.

## Review date

- First review: 2026-11-18 (14 days after deploy), using actual GSC data and the deployment/test
  record. Shipping is not the same as validated demand.
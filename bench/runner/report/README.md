# Published benchmark reports

Reports are part of the bilingual learning portal. Measurement, export and site build are
separate operations; rebuilding the interface never launches Chrome or benchmarks.

1. Build the engine and run `node bench/runner/campagne.ts --out .mesure/out/<campaign>`.
   Resume requires the same execution arguments, repository state, built JavaScript, asset
   manifest, browser version and machine, and a completed measurement without errors. A mismatch refuses to
   overwrite evidence: select another output directory. Browser-version changes invalidate resume and comparisons.
2. Export with `node bench/runner/rapportGlobal.ts --dossier .mesure/out/<campaign>
--vers .mesure/out/<campaign>-report --id <campaign>` (on one line).
3. Stage with `node bench/runner/publierRapport.ts --dossier .mesure/out/<campaign>-report`.
   Campaign IDs are immutable. The script writes `site/reports/<id>/`, updates the catalogue,
   and keeps `report.html` as an entry to the portal. It does not deploy or push anything.
4. Validate, then preview with `pnpm docs:serve` (it builds the bundles first).
   Publishing follows the normal issue/PR and maintainer release workflow.

`formatVersion: 1` contains runs and individual readings, original PNG evidence, and public
source JSON. Machine and browser records come from measurement time, never the exporter.
Unknown values stay null. Filesystem paths and commands are excluded from public source JSON.
The original private `mesure.json` files are never overwritten. Capture paths must stay inside
the measurement directory. Export into a new directory; do not reuse an existing export.

The portal presents seven categories through the sidebar, with named-engine charts, every measured image
pair as a slider, all scene/run comparisons, and complete source tables including repeated captures.
There are no global filters. Primary charts and comparisons stay visible; raw source and protocol tables use closed disclosures. The hash identifies a campaign and tab; the latest
campaign opens by default. All source numbers remain visible, with null distinct from zero.
Timing methods stay separate; no GPU pass sum is presented as a frame. Observed arithmetic
is shown when both readings exist, with an explicit warning that it is not a controlled performance
claim. Percentages still require matching recorded conditions. Repeated-run uncertainty is not
available in current inputs, so no significance or speedup verdict is claimed.

Source tables and downloads preserve diagnostics for lighting, shadow pages, bounce, residency,
streaming, resolution, CPU stages, GPU passes and fidelity. Hardware publication references
remain outside controlled comparisons. Original captures are lazy-loaded without changing their
pixels. Missing captures remain unavailable. The report does not infer fidelity from appearance.

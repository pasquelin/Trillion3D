# Published benchmark reports

Reports are part of the bilingual learning portal. Measurement, export and site build are
separate operations; rebuilding the interface never launches Chrome or benchmarks.

1. Build the engine and run `node scripts/mesure/campagne.mjs --out .mesure/out/<campaign>`.
   Resume requires the same execution arguments, repository state, built JavaScript, asset
   manifest, browser version and machine, and a completed measurement without errors. A mismatch refuses to
   overwrite evidence: select another output directory. Browser-version changes invalidate resume and comparisons.
2. Export with `node scripts/mesure/rapportGlobal.mjs --dossier .mesure/out/<campaign>
--vers .mesure/out/<campaign>-report --id <campaign>` (on one line).
3. Stage with `node scripts/mesure/publierRapport.mjs --dossier .mesure/out/<campaign>-report`.
   Campaign IDs are immutable. The script writes `docs/reports/<id>/`, updates the catalogue,
   and keeps `report.html` as an entry to the portal. It does not deploy or push anything.
4. Run `pnpm build:docs`, validate, and preview with `pnpm docs:serve`.
   Publishing follows the normal issue/PR and maintainer release workflow.

`formatVersion: 1` contains runs and individual readings, original PNG evidence, and public
source JSON. Machine and browser records come from measurement time, never the exporter.
Unknown values stay null. Filesystem paths and commands are excluded from public source JSON.
The original private `mesure.json` files are never overwritten. Capture paths must stay inside
the measurement directory. Export into a new directory; do not reuse an existing export.

The portal translates presentation through EN/FR catalogues, keeps selection in its hash route,
and uses shared React/DaisyUI primitives. Timing methods stay separate; no GPU pass sum is
presented as a frame. Differences require matching recorded conditions, except for the explicit
experimental variable. Repeated-run uncertainty is not available in current inputs, so differences
are descriptive and never receive a significance or speedup verdict. Historical measurements
without provenance remain readable but cannot establish controlled comparisons.

Raw source downloads preserve diagnostics for lighting, shadow pages, bounce, residency,
streaming, resolution, CPU stages, GPU passes and fidelity. Hardware publication references
remain outside controlled comparisons. Original captures are lazy-loaded without changing their
pixels. Missing captures remain unavailable. The report does not infer fidelity from appearance.

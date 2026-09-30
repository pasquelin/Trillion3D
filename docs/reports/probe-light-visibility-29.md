# Per-light probe visibility — issue 29

Every contributing shadow-casting point, spot and directional light now receives its own
proxy visibility query in the production irradiance shader. Previously, after four queries,
remaining lights contributed without testing the wall. Unoccluded energy, incidence rejection,
local-light distance, directional-light reach and the existing rectangle-light contract remain
unchanged. Rectangle lights retain their existing area integration path.

The cost per updated cell grows with the number of contributing shadow-casting lights and
proxy traversal work. The existing surface cell ceiling and `bounceBatchOf(ceiling, load)`
millisecond-budget feedback continue to regulate cells per frame. No light is dropped or made
unoccluded to meet a ray quota. More lights can require smaller batches and more frames to
refresh an invalidated cache; this change does not claim measured frame times or a hard upper
bound for one cell's GPU work.

## Issue checklist

- Removed the four-shadow-query cap and its unused `lightsPerRay` setting.
- Moved all 65 scene/transport files, including the strengthened issue 1401 tests, from
  `packages/sdk-core/src/lighting/` into `tests/kit/lighting/`. Removed their public SDK exports
  and redirected test and benchmark consumers. Runtime LTC data stays in the SDK.
- The rectangle BVH and traversal shader were already in the lighting test kit at the baseline;
  no duplicate BVH was introduced and its layout/builder are unchanged.
- Brute observation mode now constructs no BVH and allocates/uploads no BVH GPU texture.
  The unused sampler aliases the complete surface texture. Entering BVH mode builds once;
  later mode changes retain topology and refit current surface values only in BVH mode.
  Diagnostics report zero BVH allocation before first use and retained bytes after later use.
  Context restoration rebuilds only the textures required by the active mode.

## Validation

- 86 lighting tests passed, zero failures/skips, including every moved scene/transport test,
  shadow visibility regressions and BVH allocation/upload/mode/restoration regressions.
- Baseline replay used the original shader and restored its original constant in the scalar
  harness: both shadow tests failed on values (21 versus 10 and 34 versus 4). The corrected
  shader passes. The harness executes production WGSL control flow on a collinear plane/light
  case with controlled incidence; it does not execute GPU machine code.
- BVH tests inspect actual resource data and recorded WebGL texture allocations/uploads,
  comparing refitted records with the existing builder. They are not rendered image proof.
- Prepared-scene consumer fixtures reuse 20 existing main-checkout caches; no native
  compiler producer changed and no cache recompilation is claimed.
- `pnpm run check:changed` ran all required static checks and 3,869 tests: 3,850 passed,
  seven failed and twelve were skipped (499.6 seconds; exit 1). Five failures came from the
  local cache scanner not following the initial directory symlinks. Replacing those links
  with copies of the same 20 caches made both affected files pass all five tests (exit 0).
- The other two failures pinned the previous SDK inventory and bundle sizes. The intentional
  removal of 14 oracle exports changes the inventory from 789 to 775 and eliminates the
  experiment Scene/browser Scene name collision. The core maths bundle falls from 5,139 to
  5,074 bytes; common/browser facade bundles remain 1,725/3,344 bytes. Updated exact assertions
  and an explicit check excluding scene/transport bindings pass all six facade tests (exit 0).
- All twelve conditional skips were rerun: nine world-partition tests, two compiler measures
  tests and one cache-format descriptor test. The existing main-checkout release compiler was
  reused after verifying that `packages/asset-compiler-rust` has no source diff from this
  branch. These files plus the facade file pass 22/22 tests, zero skips (exit 0).
- The final facade assertion addition was separately rerun (6/6), formatted and linted.
  Final `pnpm run check:tools-types` also passed (exit 0).
  No assertion was disabled and no source change followed the global run except updating
  and strengthening the facade contract test. The global command itself was not rerun or
  reclassified as exit 0; every failure and skip was resolved by the named targeted runs.

The migration and lazy allocation preserve rendering behavior. Visibility beyond four lights
is an intentional correction against the per-light occlusion reference, preserving all visible
light contributions. Chrome image and timing validation belongs to the post-merge recette;
no hardware pixel-equivalence or performance result is claimed here.

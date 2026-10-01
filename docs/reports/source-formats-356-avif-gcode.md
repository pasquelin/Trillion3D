# Independent review — AVIF, G-code and native lines (#356)

Review scope: root's AVIF image plugin, `EXT_texture_avif` selection in tables/previews, the G-code source reader, and native line admission/validation. The review corrected behavior gaps in colour admission, process-block handling, texture selection and line variants; the runtime agent also corrected endpoint colour propagation. All added regressions passed in the final shared native and changed-files gates. Raw release measurements and the retained before-fix reproductions are recorded below.

## Findings and changes

### AVIF colour interpretation needed a primary-image association

The original metadata walk inspected colour boxes without associating them with the primary image. It defaulted output transfer to sRGB even when the container did not establish that transfer. The selected `avif-parse` public metadata exposes dimensions, depth and chroma, but not AV1 transfer characteristics; `avif-decode` also does not expose that property to this caller.

The adapter now requires an explicit `nclx` sRGB transfer (13), BT.709 primaries (1), associated with the primary item through `pitm` and `ipma`. It parses bounded FullBox association records, rejects malformed/duplicate associations, and checks the actual one-based property index. A stray top-level colour box or an unassociated property cannot justify the primary transfer. Missing/unspecified/unsupported transfer, non-BT.709 primaries and ICC profiles are explicit refusals. This is a deliberately restricted decoder contract, not a claim of colour-management support.

Existing refusals of animation, non-eight-bit data and unhandled rotation/mirroring/cropping remain. Premultiplied alpha is handled by the external decoder's explicit unpremultiplication path. Output dimensions are checked against the admitted dimensions. Pixel admission and compressed-item accounting continue to use the existing image-decoder budget interface; no process-wide RSS ceiling is claimed.

The existing RGBA fixture has primary item 1, property 4 `colr`, transfer 13 and primaries 1. New tests cover removal, unrelated `colr`, unlinking, unspecified transfer, P3/BT.2020/unspecified primaries and ICC refusal. The AVIF plugin version changed so cached interpretation is invalidated.

### Cutout classification must use the same image as the displayed texture

Tables and previews used the selected extension image, but `cutout/apply.rs` still read only the core texture `source`. With an AVIF extension plus a fallback image, a cutout answer keyed to the fallback's bytes could therefore convert the displayed AVIF material from `BLEND` to `MASK`. Extension-only textures were also absent from cutout candidates.

The cutout path now uses the existing `compiler_tables::texture_image` selector. Tests distinguish fingerprints of fallback and selected images: fallback answers must leave the displayed material in blend; selected-image answers may produce mask. The same regression covers AVIF/WebP and extension-only textures. Material/texture identity is retained; only selection consistency changes.

### G-code process blocks must not become tool motion

The original parser accepted axis/extrusion words in an `M` process block and applied them using the previous modal move. For example, `M104 S200 X10` could create geometry instead of refusing an unsupported parameter combination. `S` outside a supported process command was ignored, and negative/zero feed values were accepted.

The reader now validates parameters before changing state. Supported `M` blocks accept only `M`, optional line number and the allowed process parameter; mixed motion words are refused. `S` requires a supported process command and a nonnegative value. Feed values must be positive, line numbers nonnegative integers, and accumulated extrusion/feed/offset state finite. Endpoint indices use checked `u32` conversion. The existing Z-up to Y-up metre conversion, G20/G21 units, G90/G91 coordinates, G92 offsets and explicit M82/M83 extrusion modes remain.

Before-fix reproduction against the previously built debug CLI confirmed that `M104S200X10`, `G1X1S200` and `G1X1F-600` each returned exit 0 / `ready` (`.worktrees/logs/356-review-before/gcode-before.json`, with individual stdout/stderr files). The new regression verifies refusal of those blocks and a normal temperature-setting block between two actual moves. Process settings continue to be reported as process-setting metadata rather than converted into solid geometry. The importer remains a linear toolpath subset; arcs, homing and unsupported machine commands are named refusals.

## Native line validation review

`compiler_plan/lines.rs` validates finite attributes, index bounds, conditional controls, morph-target refusal and unsupported textured lines after RAM admission. My initial local concern about odd line counts was resolved by checking the complete call path: `compiler_source::primitive_triangles` already rejects incomplete LINES pairs and strips/loops with fewer than two vertices before selection. No duplicate production validation was retained.

A pipeline regression now covers odd indexed and non-indexed LINES, and single-vertex strips/loops. This records the existing invariant at the user-visible compile boundary.

### Material variants must obey the same line restrictions

An independent CLI probe confirmed that a textured default line material was refused while the same textured material behind `KHR_materials_variants` compiled successfully (`.worktrees/logs/356-review-before/variant-line/{default,alternate}.stdout`, exits 2 and 0). The runtime line adapter does not carry a texture map, so switching variants would silently discard it. Native validation now checks the deduplicated set of default and alternate materials. Pipeline regression covers textured refusal and untextured acceptance, both with and without an explicit default material. The regression passed in the isolated-feature debug formats run (127 passed, 8 explicitly ignored fixture generators).

### Runtime line colours: confirmed gap and correction

A public geometry probe with a red/half-alpha endpoint and a green/opaque endpoint confirmed that `drawnTriangles(geometry, 'lineSegments')` produced four quad vertices but `colors: null`. `drawn.ts`'s line branch does not copy the source colour attribute into quads. Skin/morph remapping is present in `drawnDeformation`, so that path was not falsely classified as another loss.

Evidence: `.worktrees/logs/356-line-color-before.json`. The VRML/runtime agent corrected quad construction to repeat each endpoint RGBA at both sides. That agent reports 16 passing geometry/integration tests, including the real VRML fixture, normalized host colours, reversed indices/zero-length segments, loops and wireframes. This does not affect G-code's uniform material per line primitive.

## Validation evidence

- `plugins::tests::avif`: source pixels/alpha, truncation/transforms, primary association and colour refusals.
- `plugins::scene::gcode`: modal behavior plus invalid process/feed blocks.
- `cutout::tests::responses::cutout_answers_follow_the_displayed_extension_image_not_its_fallback`.
- `tests::formats::lines`: native line cases and G-code compilation.
- `tests::formats::avif_scene`: actual AVIF texture preview and material identity.

The first shared release run passed all four AVIF decoder regressions, all three G-code tests and the cutout selection regression. It reported 817 passing tests and five failures overall, so it is not claimed as a passing global gate. The AVIF pipeline failure was an incorrect test lookup in the slim manifest: actual material/image identities live in `scene-tables.json`. Correcting the lookup preserved the real preview checks and verified the published material-to-texture-to-AVIF chain.

After the feature isolation described in the main report, the debug formats run passed 127 tests (8 ignored fixture generators), including AVIF preview/identity, both line refusal regressions, G-code compilation and both surface-source pipelines. Logs: `.worktrees/logs/356-formats-isolated-json.log` and the global `356-validate-native-final.log`. Strict Clippy passed again for compiler targets/features and page codec in global `356-validate-native-isolated.log`. The final release gate subsequently exited 0: 822 unit tests passed, 13 fixture-regeneration tests and the external-Sponza test remained explicitly ignored, and all 17 CLI/integration tests passed. The final changed-files gate exited 0 with 768 tests and no skips. Logs: global `.worktrees/logs/356-validate-native-complete.log` and `356-check-changed-complete.log`.

## Final release measurements

Measured at `20261001T011158Z` after both final gates, without a concurrent build or test job. The release CLI compiled AVIF and G-code sequentially with fresh output caches, one worker, 64 MiB admission, no simplification and BC7 previews. Filesystem caches were not flushed. Binary hashing was streamed before spawning; monotonic wall time and Linux `wait4` provide elapsed time and peak RSS. These are small-fixture smoke observations, not a throughput benchmark or a hard RSS guarantee.

| Format | Wall ms | Peak RSS KiB | Exit |
| ------ | ------: | -----------: | ---: |
| avif   |   17.82 |        22152 |    0 |
| gcode  |    8.02 |        14928 |    0 |

[Raw measurements](source-formats-356-avif-gcode-timings.json) include commands, fixture hashes, raw process counters and the returned pointers. The [14-fixture snapshot](source-formats-356-final-timings.json) also includes all seven surface readers and AMF/LDraw/VRML. Binary SHA-256: `82ee39079e17a8cc7737a93cdfdd26c38050b5eb79227e9629e729c1d6ce2057`.

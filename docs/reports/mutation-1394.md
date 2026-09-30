# #1394 — sdk-core world mutation proof

**Mutation score: 93.46% — 4,786 detected / 5,121 valid mutants.**
The requested 75% threshold is exceeded. This is not a claim of 100% coverage:
303 mutants survived and 32 were not covered.

The published issue reference was 42.0% (5,120 mutants). The completed local
baseline before this reinforcement was 67.51% (3,414 detected / 5,057 valid).
Successive complete measurements reached 81.88%, 88.21%, 91.32%, then 93.46%.
The final report contains 4,706 Killed, 80 Timeout, 303 Survived, 32 NoCoverage,
66 pre-existing Ignored and 6 RuntimeError results. The repository's summary
counts Killed + Timeout over Killed + Timeout + Survived + NoCoverage.
No mutation exclusion was added. The six runner errors are not claimed detected;
counting them as undetected would still give 93.35%.

## Validation and behavior

The final shared `check:changed` gate exited successfully: **2,904 tests passed,
zero failures and zero skipped tests** (487081 ms). Formatting, source-file size,
build, lint and type checks passed. The final mutation dry run passed all 81
selected world test files. The summary credits every selected file with a kill.
No production source changed after the release gate began.

Tests now assert concrete primitive coordinates, UVs, normals and topology;
morph/skin mappings and bounds; camera rays/projections; math and buffer values;
scene lifecycle and raycasts; material/texture notifications; animation, wind and
skeleton transforms. IK checks attachment orientation and cached matrices as well
as endpoints. Independent reviewers checked Color listener ownership, IK plane
arithmetic and aliasing, bounds reference values, and the texture proxy/setter fix.

Seven real defects were corrected:

- Supplied material Color instances were not consistently observed. Replaced colors
  now detach only after the last color slot releases them; newly created optional
  numeric colors also register their listener.
- Opposite collinear IK targets could leave a chain pointing the wrong way. The
  zero-cross-product case now uses a perpendicular half-turn axis.
- Short straight chains selected an unsuitable fallback axis. Selection now uses
  direction rather than absolute bone scale.
- Fully folded chains whose endpoint coincided with the root could not open toward
  a reachable target. The first bone provides their initial direction.
- Already bent chains could miss a target when given a new pole. The old bend plane
  is rolled onto the pole plane before changing the joint angles.
- An identical repeated pole solve could move the elbow by 0.20022185. Final alignment
  around the target axis now gives the first solve the correct pole plane. A separate
  sphere-intersection oracle checks the elbow, endpoint, lengths and repeated solves.
- Texture `needsUpdate=false` requested an upload, and `true` notified twice. The
  proxy now leaves that property to its boolean setter; false is silent and true
  increments/notifies once.

Failing-before regressions and passing-after runs were retained during the task.
Only `world/animation/ik.ts`, `world/material/material.ts` and
`world/texture/texture.ts` change production behavior. The browser material-value
assertion compares the relevant color values after listener ownership changes.

## Five baseline priority files

The five priority files come from the 67.51% baseline. Their remaining mutants
are audited below; the final whole-world ranking is reported separately.
All counts include uncovered mutants rather than dropping them.

| File under sdk-core/src/world | Detected | Remaining |
| ----------------------------- | -------: | --------: |
| geometry/basic.ts             |      196 |         2 |
| animation/ik.ts               |      164 |         7 |
| geometry/round.ts             |      152 |         1 |
| geometry/drawnDeformation.ts  |       65 |         3 |
| geometry/sphere.ts            |       85 |         0 |

The 13 remaining priority-file mutants are individually explained here. These
arguments concern returned values, bone/attachment poses and world-matrix state;
no survivor is declared equivalent merely because its tests passed.

| ID   | File:line              | Equivalent behavior                                                                                                                                                                                                |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1415 | basic.ts:165           | Cap normal ny is exactly +1 or -1 at both private call sites. Dividing by ny equals multiplying by it, including signed zero.                                                                                      |
| 1423 | basic.ts:167           | The same +1/-1-only ny excludes zero, so >=0 and >0 select the same cap.                                                                                                                                           |
| 200  | ik.ts:84               | An extra eager world-matrix update during a partial solve is followed by the same two quaternion blends and final subtree update. The returned pose and matrices are unchanged.                                    |
| 203  | ik.ts:84               | A quaternion write dirties the node, so updateMatrixWorld(false) propagates its change to descendants too. An unchanged quaternion leaves poses already made current by the initial forced update/world reads.     |
| 210  | ik.ts:105              | At weight=1, the added partial branch uses two exactly zero blend factors; slerp returns the current quaternions unchanged. Other weights select the same branch.                                                  |
| 212  | ik.ts:106              | Extra initial-quaternion copies go to private scratch unused by a full solve. Every subsequent partial solve overwrites both copies before reading them.                                                           |
| 283  | ik.ts:140              | The cross-product guard already implies nonzero ac. Without a pole, plane and ba are the identical cross(ac,ab), giving zero roll and no write; with a pole, entry is unchanged.                                   |
| 284  | ik.ts:140              | The grouped logical OR between pole and length(ac) has the same effect as 283 under the retained cross-product guard: nonzero ac there, and zero added roll without a pole.                                        |
| 343  | ik.ts:177              | The partial blends dirty changed root/mid poses; false still updates and propagates those dirty matrices. Unchanged poses were already current, so the forced update adds no different result.                     |
| 2482 | round.ts:185           | copyScaledVector3 writes all three scratch indices before any read; the initial array contents/length do not matter.                                                                                               |
| 1901 | drawnDeformation.ts:29 | The extra skin component writes the next vertex's first slot before that vertex overwrites it. The final extra typed-array write is ignored; the component reader returns zero past skin.width.                    |
| 1918 | drawnDeformation.ts:39 | The extra morph component likewise overwrites only a future slot, then is overwritten; the final out-of-bounds typed-array write is ignored. A pending nonempty source already fails on its first legitimate read. |
| 1941 | drawnDeformation.ts:55 | Both list calls use the same skin.width: zero gives two undefined values, positive width two truthy Float32Arrays. Their truthiness agrees; read errors abort before the conditional.                              |

Outer deformation-loop boundaries were not treated as equivalent: zero-length
pending storage distinguishes an extra read. Larger caller-provided output arrays
also expose readList's extra writes. Dedicated tests reject both kinds of mutant.

Diagnostic source-span replay originally misclassified IK 284 because omitting
parentheses changed operator precedence. Replaying the grouped AST expression
passes all 29 IK tests, matching Stryker. The official run, not that diagnostic,
defines the reported score. No report status was manually overwritten.

## Final remaining-mutant ranking

There are 335 undetected mutants across world. Mutants outside the five baseline
priority files are not all claimed equivalent. For example, removing the empty
point-builder guard can differ for an unvalidated itemSize=0 attribute.

| File under sdk-core/src/world | Survived or uncovered |
| ----------------------------- | --------------------: |
| animation/sample.ts           |                    18 |
| geometry/geometry.ts          |                    18 |
| geometry/normals.ts           |                    18 |
| object/transformNode.ts       |                    17 |
| object/instancedMesh.ts       |                    16 |
| material/material.ts          |                    15 |
| math/quaternion.ts            |                    15 |
| math/volumes.ts               |                    13 |
| camera/index.ts               |                    12 |
| geometry/bounds.ts            |                    12 |

Additional batches removed all survivors in wind.ts, material/index.ts and box3.ts.
Texture retains only its opaque-ID counter decrement: IDs remain unique, and the
API promises identity rather than an increasing numeric order.

## Timeout integrity

Finite Timeouts were independently replayed, including all their covering files
when an initial replay passed. Passing finite mutants were not accepted as kills:
new assertions closed genuine gaps, cached Timeouts were invalidated, and Stryker
remeasured them. Large Object3D diffs were replaced by equivalent identity checks,
so six final object cases changed from wall-clock Timeout to ordinary test failure.

The final **80 Timeouts all have divergent control flow**. Seventy-seven carry
Stryker's recorded Hit limit. Three without that marker are the inverted loop
counters 1606, 1641 and 2303; their upper bounds cannot be reached after decrement.
The inventory below maps every Timeout to its source and cause. No finite
load-induced Timeout remains in the reported detection count.

| ID   | File:line                       | Replacement            | Cause                                                                  |
| ---- | ------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| 23   | animation/blend.ts:41           | `c--`                  | Counter moves away from its loop bound.                                |
| 37   | animation/blend.ts:56           | `c--`                  | Counter moves away from its loop bound.                                |
| 48   | animation/blend.ts:59           | `c--`                  | Counter moves away from its loop bound.                                |
| 62   | animation/blend.ts:67           | `c--`                  | Counter moves away from its loop bound.                                |
| 73   | animation/blend.ts:71           | `c--`                  | Counter moves away from its loop bound.                                |
| 90   | animation/blend.ts:81           | `c--`                  | Counter moves away from its loop bound.                                |
| 101  | animation/blend.ts:83           | `c--`                  | Counter moves away from its loop bound.                                |
| 115  | animation/blend.ts:87           | `c--`                  | Counter moves away from its loop bound.                                |
| 520  | animation/sample.ts:22          | `c--`                  | Counter moves away from its loop bound.                                |
| 544  | animation/sample.ts:30          | `c--`                  | Counter moves away from its loop bound.                                |
| 579  | animation/sample.ts:40          | `c--`                  | Counter moves away from its loop bound.                                |
| 602  | animation/sample.ts:51          | `c--`                  | Counter moves away from its loop bound.                                |
| 642  | animation/skeleton.ts:56        | `row--`                | Counter moves away from its loop bound.                                |
| 646  | animation/skeleton.ts:57        | `column--`             | Counter moves away from its loop bound.                                |
| 663  | animation/skeleton.ts:78        | `j--`                  | Counter moves away from its loop bound.                                |
| 677  | animation/skeleton.ts:86        | `row--`                | Counter moves away from its loop bound.                                |
| 728  | animation/skeleton.ts:105       | `j--`                  | Counter moves away from its loop bound.                                |
| 735  | animation/skeleton.ts:109       | `k--`                  | Counter moves away from its loop bound.                                |
| 805  | buffer/attribute.ts:20          | `i--`                  | Counter moves away from its loop bound.                                |
| 809  | buffer/attribute.ts:21          | `c--`                  | Counter moves away from its loop bound.                                |
| 1320 | geometry/basic.ts:99            | `i--`                  | Counter moves away from its loop bound.                                |
| 1403 | geometry/basic.ts:163           | `i--`                  | Counter moves away from its loop bound.                                |
| 1456 | geometry/bounds.ts:47           | `c--`                  | Counter moves away from its loop bound.                                |
| 1479 | geometry/bounds.ts:66           | `i--`                  | Counter moves away from its loop bound.                                |
| 1492 | geometry/bounds.ts:76           | `i--`                  | Counter moves away from its loop bound.                                |
| 1527 | geometry/bounds.ts:111          | `i -= 3`               | Positive traversal stride becomes subtraction.                         |
| 1533 | geometry/bounds.ts:113          | `i--`                  | Counter moves away from its loop bound.                                |
| 1540 | geometry/bounds.ts:115          | `j--`                  | Counter moves away from its loop bound.                                |
| 1446 | geometry/bounds.ts:31           | `c--`                  | Counter moves away from its loop bound.                                |
| 1585 | geometry/builder.ts:36          | `j--`                  | Counter moves away from its loop bound.                                |
| 1589 | geometry/builder.ts:37          | `i--`                  | Counter moves away from its loop bound.                                |
| 1602 | geometry/builder.ts:42          | `j--`                  | Counter moves away from its loop bound.                                |
| 1606 | geometry/builder.ts:43          | `i--`                  | Counter moves away from its loop bound.                                |
| 1641 | geometry/builder.ts:62          | `k--`                  | Counter moves away from its loop bound.                                |
| 1672 | geometry/drawn.ts:49            | `true`                 | Sprite fallback recursively redraws triangles with unchanged input.    |
| 1674 | geometry/drawn.ts:49            | `reading !== 'sprite'` | Sprite fallback recursively redraws triangles with unchanged input.    |
| 1758 | geometry/drawn.ts:96            | `v--`                  | Counter moves away from its loop bound.                                |
| 1762 | geometry/drawn.ts:97            | `c--`                  | Counter moves away from its loop bound.                                |
| 1779 | geometry/drawn.ts:110           | `i -= step`            | Positive traversal stride becomes subtraction.                         |
| 1805 | geometry/drawn.ts:130           | `s -= 2`               | Positive traversal stride becomes subtraction.                         |
| 1899 | geometry/drawnDeformation.ts:28 | `v--`                  | Counter moves away from its loop bound.                                |
| 1903 | geometry/drawnDeformation.ts:29 | `c--`                  | Counter moves away from its loop bound.                                |
| 1915 | geometry/drawnDeformation.ts:37 | `v--`                  | Counter moves away from its loop bound.                                |
| 1920 | geometry/drawnDeformation.ts:39 | `c--`                  | Counter moves away from its loop bound.                                |
| 1983 | geometry/drawnPoints.ts:15      | `v -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2017 | geometry/drawnSprite.ts:19      | `i -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2152 | geometry/lines.ts:15            | `t -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2169 | geometry/lines.ts:23            | `k--`                  | Counter moves away from its loop bound.                                |
| 2221 | geometry/normals.ts:18          | `k -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2254 | geometry/normals.ts:31          | `corner--`             | Counter moves away from its loop bound.                                |
| 2266 | geometry/normals.ts:39          | `v -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2294 | geometry/polyhedron.ts:26       | `f -= 3`               | Positive traversal stride becomes subtraction.                         |
| 2303 | geometry/polyhedron.ts:30       | `i--`                  | Counter moves away from its loop bound.                                |
| 2307 | geometry/polyhedron.ts:31       | `i - j`                | Increasing j makes i-j stay below cuts.                                |
| 2308 | geometry/polyhedron.ts:31       | `j--`                  | Counter moves away from its loop bound.                                |
| 2401 | geometry/round.ts:129           | `i--`                  | Counter moves away from its loop bound.                                |
| 2419 | geometry/round.ts:133           | `i--`                  | Counter moves away from its loop bound.                                |
| 2564 | geometry/shape.ts:95            | `s--`                  | Counter moves away from its loop bound.                                |
| 2580 | geometry/shape.ts:99            | `s--`                  | Counter moves away from its loop bound.                                |
| 2587 | geometry/shape.ts:100           | `bevel \|\| s >= 0`    | Enabled bevel or unconditional true keeps the descending loop running. |
| 2588 | geometry/shape.ts:100           | `true`                 | Enabled bevel or unconditional true keeps the descending loop running. |
| 2591 | geometry/shape.ts:100           | `s++`                  | Counter moves away from its loop bound.                                |
| 2727 | geometry/sphere.ts:40           | `y--`                  | Counter moves away from its loop bound.                                |
| 2731 | geometry/sphere.ts:41           | `x--`                  | Counter moves away from its loop bound.                                |
| 2753 | geometry/sphere.ts:52           | `y--`                  | Counter moves away from its loop bound.                                |
| 2757 | geometry/sphere.ts:53           | `x--`                  | Counter moves away from its loop bound.                                |
| 2791 | geometry/transform.ts:25        | `i--`                  | Counter moves away from its loop bound.                                |
| 2796 | geometry/transform.ts:27        | `c--`                  | Counter moves away from its loop bound.                                |
| 2805 | geometry/transform.ts:35        | `i--`                  | Counter moves away from its loop bound.                                |
| 2814 | geometry/transform.ts:38        | `c--`                  | Counter moves away from its loop bound.                                |
| 2991 | geometry/triangulate.ts:92      | `k--`                  | Counter moves away from its loop bound.                                |
| 3420 | math/box3.ts:82                 | `i -= itemSize`        | Positive traversal stride becomes subtraction.                         |
| 3659 | math/colorNames.ts:40           | `i -= 2`               | Positive traversal stride becomes subtraction.                         |
| 3668 | math/curves.ts:13               | `i--`                  | Counter moves away from its loop bound.                                |
| 3680 | math/curves.ts:27               | `i--`                  | Counter moves away from its loop bound.                                |
| 3806 | math/curves.ts:147              | `i--`                  | Counter moves away from its loop bound.                                |
| 3835 | math/curves.ts:165              | `i--`                  | Counter moves away from its loop bound.                                |
| 3887 | math/curves.ts:182              | `i--`                  | Counter moves away from its loop bound.                                |
| 4661 | math/volumes.ts:192             | `i -= 4`               | Positive traversal stride becomes subtraction.                         |
| 4990 | object/objectPose.ts:35         | `i--`                  | Counter moves away from its loop bound.                                |

## Reproduction

Use the repository's Node 24/pnpm 11 toolchain and installed lockfile dependencies.
The versioned runner measures the complete world production scope against all
SDK-core unit tests:

```sh
TRILLION3D_MUTATION_CONCURRENCY=2 pnpm run test:mutation \
  --mutate 'packages/sdk-core/src/world/**/*.ts' \
  --mutate '!**/*.test.ts' --mutate '!**/*.fixture.ts' \
  --out .mesure/out/1394-repro
```

The recorded run used Stryker 10, TAP per-test coverage, two workers, and the 81
world test files only. Additional SDK-core tests may detect additional mutants;
wall-clock classifications can vary with host load. The exact focused settings
can be reproduced without this session's temporary driver: save this configuration
at the checkout root as `stryker.world.config.mjs`, then run
`pnpm exec stryker run stryker.world.config.mjs`. This runs fresh without a cache.

```js
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setPriority } from 'node:os';
import { resolve } from 'node:path';
import { repositoryFiles, localFileGlobs } from './scripts/repository-files.ts';
import { isUnitTest } from './scripts/unit-tests.ts';

setPriority(19);
process.env.GIT_DIR = resolve(
  execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim(),
);
mkdirSync('.mesure/out/1394-repro', { recursive: true });
export default {
  testRunner: 'tap',
  plugins: ['@stryker-mutator/tap-runner'],
  tap: {
    testFiles: (repositoryFiles() ?? []).filter(
      (file) => isUnitTest(file) && file.startsWith('packages/sdk-core/src/world/'),
    ),
  },
  mutate: ['packages/sdk-core/src/world/**/*.ts', '!**/*.test.ts', '!**/*.fixture.ts'],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  timeoutMS: 10000,
  timeoutFactor: 2,
  incremental: false,
  reporters: ['json', 'progress'],
  jsonReporter: { fileName: '.mesure/out/1394-repro/mutation.json' },
  tempDirName: '.mesure/stryker-world-reproduction',
  cleanTempDir: 'always',
  ignorePatterns: [
    '/dist',
    '/.mesure',
    '/.worktrees',
    '/graphify-out',
    '**/target',
    '/tests/assets',
    '/site/assets',
    ...localFileGlobs(),
  ],
};
```

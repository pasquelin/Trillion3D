# #1402 — sdk-core collision mutation proof

**Measured mutation score: 90.20% — 1,197 detected / 1,327 valid mutants.**
This exceeds the requested 75% target. It is not a claim of 100% mutation coverage.
The issue reference was 59.3%; the first local focused baseline was 75.75%.

## Measurement boundary

The completed report measured the final production implementation with 85 unit tests.
Subsequent changes added assertions and tests only: the delivered collision suite
passes **102 tests, zero failures, zero skips**. Its additional exact-mutant
replays are reported separately; they do not inflate the measured 90.20% score.
A later incremental run was stopped after the complete audit, and no partial
measurement is used in this report.

| Stryker status     | Count |
| ------------------ | ----: |
| Killed             |  1118 |
| Timeout            |    79 |
| Survived           |   130 |
| NoCoverage         |     0 |
| Ignored (existing) |   209 |
| RuntimeError       |     2 |

The repository score counts Killed+Timeout over Killed+Timeout+Survived+NoCoverage.
Killed alone gives 84.25%. Even counting both runner errors as undetected and
excluding all timeouts from detected gives 84.12%, still above 75%.
The two RuntimeError results were terminated TAP children in mesh tests; they are
not claimed detected. No mutation exclusion was added. The complete measurement
credited every selected test file with a kill; each subsequently added test file
has an exact assertion-failing mutant reproduction.

Completed raw report: `.mesure/out/1402-completed/mutation.json` (local artifact).
SHA-256: `4f5afa98f689b0b24377c7b7997533e7c1608e21148cca9f1303ed2c0e0a1689`.
The report and summary were saved before stopping the later runner. The transient
incremental cache is not a published result.

## Behavior and validation

Four real defects discovered during the work were corrected:

- Upward-turning a face normal no longer reverses the winding used to test a
  sphere drop inside a downward-authored triangle.
- Near-vertical finite edges no longer disappear behind an arbitrary angular
  cutoff. Exactly vertical and underflowed sweep coefficients are still skipped.
- A compensated feet+radius sum keeps an exactly resting sphere grounded on
  translated floors; no arbitrary geometric tolerance was introduced.
- A speculative raised step is committed only when the actual shorter step
  succeeds and gains height. Failed or flat attempts restore pose and velocity.

Tests cover face/edge/corner contacts, authored normals, packed triangle isolation,
box/ray boundaries, BVH bounds, capsule overlap recovery, grounded movement,
climb limits, jump deadlines, landing events, braking distances and interpolation.
The existing acceleration loop is bounded and asserts that its target was reached;
the coyote test asserts departure from the ledge before checking the grace period.

Trajectory and recovery tests use public geometric inputs and recorded pose/velocity
references with 1 mm tolerances, plus continuity, height and nonpenetration checks.
These references are behavior regressions, not analytic proofs of physical accuracy.
`character.fixture.ts` shares box geometry and an origin-rebasing collision adapter
that propagates each live capsule push. Large-origin tests do not claim universal
bit-identical translation invariance. A normalized large-coordinate trajectory
uses finite Float32 vertices and detects centroid overflow changing contact order.

The final collision-only test run, tools TypeScript project, ESLint, Prettier and
collision duplication check all pass; duplication reports zero clones. Every
collision source/test file fits the 200-line limit. The earlier shared release gate
passed 2904 tests with zero skips; later additions are covered by the 102-test domain
run. This report does not claim that earlier shared gate collected later tests.

## Audit of the five files selected from the baseline

The priority files remain `triangleQuery.ts`, `characterBody.ts`, `triangleTree.ts`,
`characterDrive.ts` and `capsule.ts`; priorities were not repeatedly reselected.
Their 85 survivors in the completed report have individual assessments below:
**56 equivalent mutations and 29 rejected by maintained regression assertions**.
No priority survivor is left unassessed. Exact Node module-hook replays changed
only the specified mutation and failed with AssertionError, not syntax/import
errors. Their results never replace Stryker's recorded Survived status or score.

Centroid changes are not declared equivalent merely because bounds and triangle
permutations remain valid: contact order affects sequential collision resolution.
All such survivors are caught by trajectory tests, including `/3` to `*3`, which
can overflow Float32 centroid storage even when source vertices remain finite.

### capsule.ts

| Report ID | Line | Replacement                                                            | Assessment                                                                                                                                                                                                           |
| --------- | ---- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9         | 73   | `k <= 3`                                                               | Loop adds k=3: writes outside the three-element typed min/max arrays are discarded.                                                                                                                                  |
| 15        | 74   | `3 - k`                                                                | Exact assertion failure in maintained capsuleValues.test.ts.                                                                                                                                                         |
| 46        | 95   | `k <= 3`                                                               | Loop adds k=3: writes outside the three-element typed normal array are discarded.                                                                                                                                    |
| 61        | 105  | `face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] <= 0` | Exact assertion failure in maintained capsuleValues.test.ts.                                                                                                                                                         |
| 77        | 117  | `false`                                                                | For a degenerate triangle the removed face-length guard leads to NaN normalized face components and projections. The capsulePass depth > 0 check rejects the NaN depth; no push callback occurs, as in the original. |
| 80        | 118  | `k <= 3`                                                               | Loop adds k=3: writes outside the three-element typed normal array are discarded.                                                                                                                                    |
| 70        | 106  | `k <= 3`                                                               | Loop adds k=3: writes outside the three-element typed surface array are discarded.                                                                                                                                   |
| 101       | 125  | `radius - low < radius + high`                                         | Exact assertion failure in maintained capsuleValues.test.ts.                                                                                                                                                         |
| 107       | 126  | `k <= 3`                                                               | Loop adds k=3: writes outside the three-element typed normal array are discarded.                                                                                                                                    |

### characterBody.ts

| Report ID | Line | Replacement                                                               | Assessment                                                                                              |
| --------- | ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 217       | 149  | `report.impact <= 0`                                                      | Exact assertion failure in maintained bodyContacts.test.ts.                                             |
| 115       | 54   | `{}`                                                                      | Initial step object is completely assigned by driveTick before the caller reads a successful DriveStep. |
| 116       | 54   | `true`                                                                    | Initial jumped flag is overwritten by driveTick before the caller reads a successful DriveStep.         |
| 118       | 61   | `{}`                                                                      | Initial report fields are reset by freshReport before every move.                                       |
| 119       | 61   | `true`                                                                    | Initial report.ground is reset by freshReport before every move.                                        |
| 120       | 61   | `true`                                                                    | Initial report.wall is reset by freshReport before every move.                                          |
| 122       | 64   | `true`                                                                    | Initial rules.onGround is assigned by read() before every use.                                          |
| 121       | 64   | `{}`                                                                      | Initial rules fields are all assigned by read() before every use.                                       |
| 142       | 88   | `false`                                                                   | Exact assertion failure in maintained recoveryValues.test.ts.                                           |
| 145       | 90   | `false`                                                                   | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 150       | 103  | `false`                                                                   | Exact assertion failure in maintained recoveryValues.test.ts.                                           |
| 152       | 104  | `Math.min(1, settings.capsuleRadius / length)`                            | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 153       | 104  | `settings.capsuleRadius * length`                                         | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 159       | 107  | `true`                                                                    | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 160       | 107  | `stepOver(dx * reach, dz * reach) \|\| capsule.feet[1] > start[1] + 1e-6` | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 162       | 107  | `dz / reach`                                                              | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 163       | 108  | `true`                                                                    | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 164       | 108  | `capsule.feet[1] >= start[1] + 1e-6`                                      | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 166       | 108  | `start[1] - 1e-6`                                                         | Exact assertion failure in maintained trajectoryValues.test.ts.                                         |
| 168       | 110  | `capsule.feet[1] >= start[1] + 1e-6`                                      | Exact assertion failure in maintained stepGuards.test.ts.                                               |

### characterDrive.ts

| Report ID | Line | Replacement                                       | Assessment                                                                                                                                                                                                                                                                                  |
| --------- | ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 342       | 93   | `true`                                            | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 362       | 113  | `true`                                            | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 366       | 113  | `hypot2(velocity[0], velocity[2]) <= REST * rate` | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 368       | 113  | `REST / rate`                                     | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 375       | 136  | `gap >= push / rate`                              | At gap = push / rate, the added equality case computes linear = min(h, 0) = 0; subsequent position and velocity calculations are unchanged.                                                                                                                                                 |
| 379       | 136  | `(gap - push / rate) * push`                      | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 380       | 136  | `gap + push / rate`                               | Exact assertion failure in maintained driveBoundaries.test.ts.                                                                                                                                                                                                                              |
| 397       | 139  | `h + linear`                                      | The changed h-linear fallback is used only at rate=0 for physical nonnegative response rates. Then push/rate is Infinity (or NaN at push=0), so gap>push/rate is false and linear=0. Consequently h+linear and h-linear are equal. At positive rate the exponential branch is used instead. |

### triangleQuery.ts

| Report ID | Line | Replacement                 | Assessment                                                                                                                                                                                                                                                                                                                              |
| --------- | ---- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1412      | 109  | `[]`                        | The [] swap assigns undefined to a and b only for a negative-direction slab. Comparisons against these values do not update near/far, weakening pruning for that axis. Other axes and exact crossTriangle checks remain; traversal order and nearest-hit selection are unchanged. Reviewed by parent.                                   |
| 1283      | 27   | `top >= 0`                  | The extra empty-stack iteration reads an undefined node. A finite query rejects its empty bounds; even with unbounded query coordinates, the undefined link/count makes its triangle loop empty. The now-negative stack cursor terminates without any visitor call.                                                                     |
| 1290      | 30   | `false`                     | Removing the node box prune visits extra nodes, but every candidate triangle is still independently filtered by its own box.                                                                                                                                                                                                            |
| 1310      | 52   | `k <= 3`                    | The extra fourth-axis query min[3] and max[3] are undefined; both rejection comparisons are false, regardless of the extra source reads.                                                                                                                                                                                                |
| 1325      | 57   | `value <= low`              | Assigning the same lower bound on equality leaves the bound unchanged.                                                                                                                                                                                                                                                                  |
| 1329      | 58   | `value >= high`             | Assigning the same upper bound on equality leaves the bound unchanged.                                                                                                                                                                                                                                                                  |
| 1353      | 81   | `false`                     | A degenerate triangle has zero facing; the following facing===0 guard returns the same miss.                                                                                                                                                                                                                                            |
| 1369      | 85   | `false`                     | Allowing a negative ray parameter through to insideTriangle still returns a negative value; nearestTriangleOnRay rejects it with crossed>=0.                                                                                                                                                                                            |
| 1370      | 85   | `true`                      | Allowing a negative ray parameter through to insideTriangle still returns a negative value; nearestTriangleOnRay rejects it with crossed>=0.                                                                                                                                                                                            |
| 1382      | 97   | `{}`                        | An empty enterBox returns undefined, which is not Infinity: traversal visits all nodes and the exact triangle intersections determine the same nearest hit.                                                                                                                                                                             |
| 1383      | 100  | `false`                     | Skipping box axes returns zero, disabling only broadphase pruning; exact triangle tests remain.                                                                                                                                                                                                                                         |
| 1384      | 100  | `k <= 3`                    | The extra fourth axis has undefined values, produces NaN and updates no near/far bound.                                                                                                                                                                                                                                                 |
| 1385      | 100  | `k >= 3`                    | The axis loop never starts, returning zero and disabling only broadphase pruning.                                                                                                                                                                                                                                                       |
| 1387      | 100  | `{}`                        | The empty axis-loop body leaves near=0 and disables only broadphase pruning.                                                                                                                                                                                                                                                            |
| 1392      | 103  | `false`                     | Without the parallel-axis block, IEEE division by zero gives an unbounded interval for an origin inside the slab (NaN at its boundary), or an infinite/negative interval that is rejected for an outside origin. The same nodes are accepted.                                                                                           |
| 1394      | 103  | `{}`                        | Without the parallel-axis block, IEEE division by zero gives an unbounded interval for an origin inside the slab (NaN at its boundary), or an infinite/negative interval that is rejected for an outside origin. The same nodes are accepted.                                                                                           |
| 1396      | 104  | `false`                     | Removing the below-low rejection weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                   |
| 1397      | 104  | `o[k] < low && o[k] > high` | An origin cannot be simultaneously below low and above high for a valid node box; disabling that prune visits extra nodes only.                                                                                                                                                                                                         |
| 1398      | 104  | `false`                     | Removing the below-low rejection weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                   |
| 1401      | 104  | `false`                     | Removing the above-high rejection weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                  |
| 1410      | 109  | `a >= b`                    | Swapping two equal endpoints leaves them unchanged.                                                                                                                                                                                                                                                                                     |
| 1413      | 110  | `true`                      | Assigning near=a instead of its maximum can only lower near, weakening node rejection; exact triangle tests remain authoritative.                                                                                                                                                                                                       |
| 1414      | 110  | `false`                     | Leaving near=0 weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                                     |
| 1415      | 110  | `a >= near`                 | Assigning near on equality leaves it unchanged.                                                                                                                                                                                                                                                                                         |
| 1416      | 110  | `a <= near`                 | Assigning near to a smaller endpoint weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                               |
| 1417      | 111  | `true`                      | Assigning far=b rather than its minimum can only enlarge far, weakening node rejection; exact triangle tests remain authoritative.                                                                                                                                                                                                      |
| 1418      | 111  | `false`                     | Leaving far at before weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                              |
| 1419      | 111  | `b <= far`                  | Assigning far on equality leaves it unchanged.                                                                                                                                                                                                                                                                                          |
| 1420      | 111  | `b >= far`                  | Assigning far to a larger endpoint weakens the node filter and visits extra nodes only.                                                                                                                                                                                                                                                 |
| 1422      | 112  | `false`                     | Removing the near>far rejection visits extra nodes; exact triangle tests determine the same nearest hit.                                                                                                                                                                                                                                |
| 1427      | 127  | `false`                     | An empty tree has no triangles or node count, so the traversal cannot retain a hit and still returns null.                                                                                                                                                                                                                              |
| 1432      | 133  | `top >= 0`                  | The extra empty-stack iteration reads an undefined node, has no triangle count or link, runs no triangle loop, and terminates with the same nearest hit.                                                                                                                                                                                |
| 1437      | 135  | `false`                     | Removing node pruning visits extra nodes; exact triangle tests determine the same nearest hit.                                                                                                                                                                                                                                          |
| 1449      | 141  | `t <= end`                  | Leaves are visited left-to-right in their contiguous triangle-buffer order. The extra tested triangle is the first triangle of the next leaf, so it overtakes no intermediate hit. If it intersects nearer, its valid leaf box cannot exclude it; at equal distance the strict < retains the same first global hit. Reviewed by parent. |

### triangleTree.ts

| Report ID | Line | Replacement                                                               | Assessment                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1475      | 49   | `t <= count`                                                              | The extra t=count iteration writes past the fixed order/centre buffers, so writes are discarded and no retained entry changes.                                                                                                                                                                                                                                                                                        |
| 1480      | 51   | `k <= 3`                                                                  | The k=3 centre write is overwritten by the next triangle's k=0 write; the final extra write is outside the centre buffer.                                                                                                                                                                                                                                                                                             |
| 1484      | 52   | `3 / t`                                                                   | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1485      | 52   | `(source[9 * t + k] + source[9 * t + 3 + k] + source[9 * t + 6 + k]) * 3` | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1486      | 52   | `source[9 * t + k] + source[9 * t + 3 + k] - source[9 * t + 6 + k]`       | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1488      | 52   | `9 * t - k`                                                               | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1490      | 52   | `9 * t + 3 - k`                                                           | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1493      | 52   | `9 * t + 6 - k`                                                           | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1494      | 52   | `9 * t - 6`                                                               | Exact assertion failure in maintained trajectoryValues.test.ts / recoveryValues.test.ts.                                                                                                                                                                                                                                                                                                                              |
| 1501      | 59   | `i <= count`                                                              | The extra i=count iteration writes outside the fixed triangle buffer and is discarded.                                                                                                                                                                                                                                                                                                                                |
| 1505      | 60   | `k <= 9`                                                                  | The extra k=9 write is overwritten by the next triangle's k=0 copy; the last extra write is outside the triangle buffer.                                                                                                                                                                                                                                                                                              |
| 1519      | 74   | `at - 3`                                                                  | Array.fill uses a negative end relative to array length. At the root, fill(Infinity,0,-3) initializes every min slot in the entire bounds buffer; later nodes use end < start and do nothing. buildCentreTree visits the root before all descendants, and each node initializes its own max slots before calculating bounds. Thus every min starts at Infinity exactly as in the original, including a one-node tree. |
| 1542      | 80   | `value <= bounds[at + k]`                                                 | Assigning an equal lower bound leaves it unchanged.                                                                                                                                                                                                                                                                                                                                                                   |
| 1548      | 81   | `value >= bounds[at + 3 + k]`                                             | Assigning an equal upper bound leaves it unchanged.                                                                                                                                                                                                                                                                                                                                                                   |

## Complete measured survivor ranking

Survivors outside the five baseline priorities remain reported without any blanket
equivalence claim. Additional tests may catch them; no unmeasured gain is claimed.

| File                  | Survived |
| --------------------- | -------: |
| triangleQuery.ts      |       34 |
| characterBody.ts      |       20 |
| triangleTree.ts       |       14 |
| drop.ts               |       13 |
| characterMove.ts      |       11 |
| characterEye.ts       |        9 |
| capsule.ts            |        9 |
| characterDrive.ts     |        8 |
| characterCollision.ts |        7 |
| meshTriangles.ts      |        4 |
| characterSettings.ts  |        1 |

## Reproduction

Run `node --test packages/sdk-core/src/collision/*.test.ts` for the maintained suite.
The repository entrypoint also accepts this mutation scope (its test list is broader):

```sh
TRILLION3D_MUTATION_CONCURRENCY=2 pnpm run test:mutation \
  --mutate 'packages/sdk-core/src/collision/**/*.ts' \
  --mutate '!**/*.test.ts' --mutate '!**/*.fixture.ts' \
  --out .mesure/out/1402-repro
```

The published measurement used the focused configuration below with incremental
reuse, two workers and priority 19. The 10 s timeout plus factor 2 replaced an earlier
short timeout after exact manual reproductions exposed false timeouts under CPU
contention. All 122 earlier Timeout cache entries were removed before the reliable
measurement series; source exclusions and status classifications were unchanged.
A fresh reproduction should use incremental:false as shown. Stryker/test-runner
versions are pinned by the lockfile. Save this at the repository root as a temporary
`stryker.collision.config.mjs`, then run `pnpm exec stryker run stryker.collision.config.mjs`:

```js
import { mkdirSync } from 'node:fs';
import { setPriority } from 'node:os';
import { repositoryFiles, localFileGlobs } from './scripts/repository-files.ts';
import { isUnitTest } from './scripts/unit-tests.ts';
setPriority(19);
mkdirSync('.mesure/out/1402-repro', { recursive: true });
export default {
  testRunner: 'tap',
  plugins: ['@stryker-mutator/tap-runner'],
  tap: {
    testFiles: (repositoryFiles() ?? []).filter(
      (file) => isUnitTest(file) && file.startsWith('packages/sdk-core/src/collision/'),
    ),
  },
  mutate: ['packages/sdk-core/src/collision/**/*.ts', '!**/*.test.ts', '!**/*.fixture.ts'],
  coverageAnalysis: 'perTest',
  concurrency: 2,
  timeoutMS: 10000,
  timeoutFactor: 2,
  incremental: false,
  reporters: ['json', 'progress'],
  jsonReporter: { fileName: '.mesure/out/1402-repro/mutation.json' },
  tempDirName: '.mesure/stryker-collision-repro',
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

# #1401 — sdk-core lighting mutation proof

Mutation score: 98.06 % (1815 detected, 36 undetected)

Published reference from #1367 / #1380: **59.10%**, 1,094 detected / 1,851 mutants.
Measured before the final strengthening: **76.07%**, 1,408 / 1,851.
Successive measured improvements: **90.28%**, **96.54%**, **97.84%**, then the score above.
No production code or mutation exclusions were changed for this issue.
Stryker statuses: 1775 killed, 40 timed out,
32 survived, 4 uncovered. Timeouts count as detected;
uncovered mutants remain in the denominator.

## Reproduction and validation

With the repository's documented Node/pnpm toolchain and dependencies installed:

```sh
TRILLION3D_MUTATION_CONCURRENCY=1 pnpm run test:mutation \
  --mutate 'packages/sdk-core/src/lighting/**/*.ts' \
  --mutate '!**/*.test.ts' --mutate '!**/*.fixture.ts' \
  --out .mesure/out/1401-repro
```

This versioned command runs all sdk-core unit tests against lighting production
sources. The recorded measurement used Stryker 10, TAP per-test coverage, one
worker, the same source globs, and all 48 lighting unit-test files. Its temporary
local driver is not required by the command above. Omitting other domains' tests
makes the recorded score conservative relative to the full sdk-core suite; wall
clock timeout classifications can nevertheless vary with host load. Incremental
results were reused only for unchanged source/tests. No mutant was excluded.
All new tests pass individually, and the final mutation dry run passes without
added skipped tests. Full-repository validation is tracked separately from this
mutation measurement.

Release verification: all 84 lighting tests pass, with no failures or skipped
tests. The shared branch's latest format, lint and TypeScript checks pass for
these files; the remaining shared gate work concerns duplicate fixtures in the
unfinished world/collision batches. The earlier full `pnpm test` run passed
5,303 tests with none skipped; the 84-test lighting run also includes the later
precision and input-type regressions.

## Independently checked behavior

- Analytic two- and three-patch systems, later-column pivoting, ill-conditioned tied
  pivots, singular boundaries, and isolation of disconnected finite emitters during
  overflow. Exact pivot mutants 1096, 1100, 1101 and 1107 were also replayed separately
  and each failed a new regression while the original passed.
- Static/moving geometry invalidation, sphere lifecycle, material updates, shuffled
  cells on skew surfaces, and incompatible topology diagnostics.
- Known ray-to-cell hits, UVs, blocker removal/restoration, patch-cell remapping,
  back-face/sphere absorption, and nearest-hit distance boundaries.
- Iteration budgets, warm starts, exact convergence boundaries, independent RGB
  solutions, progress, and cancellation before publication or additional work.
- Three independent 80-digit golden-ratio ray references detect numerical phase
  regressions; exact mutants 1210, 1211 and 1230 each fail their respective fixture.
- Exact owned-buffer accounting, validation before allocation, safe-integer overflow,
  and external-clock selection.
- Exported binary glTF values, compact alignment, integer indices, material bindings,
  scene metadata, patch positions, room bounds, and LTC transform orientation.

## Scope of equivalence arguments

Internal transport states are created by createTransportState; their typed arrays
are not replaced or externally corrupted. Scene vectors/topology obey validateScene.
Physical oracle snapshots have finite form factors and albedo in [0,1], as produced
by the engine. Source overflow is explicitly exercised; it is not assumed absent.
The suite additionally tests accepted general linear systems to catch pivot errors.
No survivor is declared equivalent merely because it was not killed.

## Final survivor inventory

The first five files below are the actual five worst files of this report. Every
survivor is identified individually; later files are included for complete review.

### packages/sdk-core/src/lighting/transport/geometry.ts (8) — worst five

| ID  | Line | Individual reason                                                                                                                                                                |
| --- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 726 |   81 | Recomputing rays for an unchanged patch deterministically overwrites the same values; no geometry or visibility value changes.                                                   |
| 796 |   97 | The extra color component writes the next patch's first component, which the next patch overwrites. The final extra write is outside the typed array.                            |
| 805 |  102 | The missing-cell guard is unreachable: validated topology fixes equal cell/patch counts and earlier guards reject out-of-range and duplicate cells, so occupancy is a bijection. |
| 806 |  102 | All cells are nonnegative after the established bijection; both some(value<0) and every(value<0) are false.                                                                      |
| 807 |  102 | Returning undefined keeps the final guard false, exactly as the impossible missing-cell predicate for validated topology.                                                        |
| 809 |  102 | The negative-cell predicate is always false after in-range, unique occupancy of every cell.                                                                                      |
| 813 |  103 | The changed error code belongs to the unreachable missing-cell branch established by the topology/occupancy bijection.                                                           |
| 814 |  103 | The changed diagnostic belongs to the same unreachable missing-cell branch.                                                                                                      |

### packages/sdk-core/src/lighting/transport/oracle.ts (8) — worst five

| ID   | Line | Individual reason                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1055 |   37 | The extra matrix/RHS row is entirely outside the fixed typed arrays. Its writes are ignored; no callback occurs inside this extra row.                                                                                                                                                                                                                                                                     |
| 1062 |   39 | The extra column writes the next row's first entry, which the next outer iteration overwrites before use. The last such write is out of bounds.                                                                                                                                                                                                                                                            |
| 1091 |   46 | The extra pivot candidate reads undefined. Math.abs(undefined) is NaN, so the comparison cannot select it.                                                                                                                                                                                                                                                                                                 |
| 1111 |   51 | When the selected pivot already equals the current row, the added swap only assigns each matrix/RHS slot its own value.                                                                                                                                                                                                                                                                                    |
| 1130 |   61 | The extra elimination row only reads and writes beyond the fixed matrix and RHS arrays; the writes are ignored.                                                                                                                                                                                                                                                                                            |
| 1140 |   63 | The noninteger row/size index ignores the write that clears a lower-triangular coefficient. Later pivots, row swaps, and back substitution never read that eliminated column again.                                                                                                                                                                                                                        |
| 1146 |   65 | At pivot zero, finite input coefficients and validated albedo in [0,1] make initial matrix entries finite; partial pivoting bounds the factor by one. The extra source value is the already-cleared row-one column-zero value, so it subtracts zero. At later pivots the extra write only touches discarded column zero, which is never read again. RHS overflow cannot affect this matrix-side reasoning. |
| 1157 |   70 | The two added initial back-substitution rows only write outside the result array. Every valid row is then evaluated unchanged.                                                                                                                                                                                                                                                                             |

### packages/sdk-core/src/lighting/transport/intersections.ts (4) — worst five

| ID   | Line | Individual reason                                                                                                                                                    |
| ---- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 833  |   20 | crossVector3 writes all three coordinates of its fresh destination array, so starting that destination empty yields the identical three coordinates.                 |
| 952  |   68 | A zero denominator is rejected by the earlier parallel-ray guard and never reaches the front/back classification.                                                    |
| 982  |   85 | For negative discriminants, Math.sqrt produces NaN; the subsequent positive-distance comparison rejects it and returns the existing limit, as the removed guard did. |
| 1000 |   89 | When t equals limit, both branches return that same numeric distance.                                                                                                |

### packages/sdk-core/src/lighting/ltcTable.ts (3) — worst five

| ID  | Line | Individual reason                                                                                                                                      |
| --- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 31  |   44 | The added cell's encoded writes all lie beyond the fixed half-float array and are ignored.                                                             |
| 35  |   45 | The added seventh coefficient writes the next cell's first coefficient, which is overwritten on that next iteration; the final write is out of bounds. |
| 54  |   59 | The added decode pair is beyond the text and maps to the first position beyond the output table. The resulting write is ignored.                       |

### packages/sdk-core/src/lighting/transport/state.ts (3) — worst five

| ID   | Line | Individual reason                                                                                                                                  |
| ---- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1501 |   88 | Owned typed-array bytes exactly equal the safe-integer estimate already checked before allocation; the second over-budget guard cannot be reached. |
| 1505 |   88 | The empty code is in the unreachable second memory-budget failure branch.                                                                          |
| 1506 |   88 | The empty message is in the same unreachable second memory-budget failure branch.                                                                  |

### packages/sdk-core/src/lighting/scene/math.ts (2)

| ID  | Line | Individual reason                                                                                                                                   |
| --- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 440 |    5 | addVector3 assigns all three coordinates of its fresh destination, so an initially empty ordinary array becomes the identical three-element result. |
| 442 |    7 | copyScaledVector3 assigns all three coordinates of its fresh destination, likewise yielding the identical result from an empty array.               |

### packages/sdk-core/src/lighting/scene/objects.ts (2)

| ID  | Line | Individual reason                                                                                                       |
| --- | ---: | ----------------------------------------------------------------------------------------------------------------------- |
| 452 |   13 | Validated light controls have unique ids, so the equal-id comparator branch is never selected for two distinct entries. |
| 465 |   13 | After the earlier equal-id branch, ids differ; less-than and less-than-or-equal therefore give the same result.         |

### packages/sdk-core/src/lighting/transport/solve.ts (2)

| ID   | Line | Individual reason                                                                                                                                                                         |
| ---- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1342 |   51 | Any nonfinite radiance contaminates the next dense transport step and its maximum residual (including zero times infinity/NaN). The preceding finite-errorBound check already rejects it. |
| 1347 |   53 | The added irradiance row only writes past the ends of both output typed arrays; valid rows and reported progress are unchanged.                                                           |

### packages/sdk-core/src/lighting/transport/validation.ts (2)

| ID   | Line | Individual reason                                                                                                                                                                                                       |
| ---- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1604 |   23 | With no observer, the direct call throws TypeError inside the existing observer-isolation catch and is swallowed; cancellation checks and visible behavior are unchanged.                                               |
| 1725 |   69 | Equality at abs(norm-1)==1e-6 is unattainable for a binary64 norm near 1: by exact subtraction its difference is a multiple of 2^-53, whereas binary64 1e-6 is not. Thus >= and > select the same representable values. |

### packages/sdk-core/src/lighting/transport/rays.ts (1)

| ID   | Line | Individual reason                                                                                                                   |
| ---- | ---: | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1204 |   27 | The added tangent coordinate is index 3 of a length-three Float64Array; its write is ignored and no extra coordinate is read later. |

### packages/sdk-core/src/lighting/transport/visibility.ts (1)

| ID   | Line | Individual reason                                                                                                                     |
| ---- | ---: | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1858 |  100 | The extra moving-surface iteration reads undefined at moving[surfaceCount], which is false; no intersection or count update executes. |

## Unresolved classifications

None.

## Timeout audit

All 40 final Timeout statuses were audited without editing the report or cache.
Stryker recorded an instrumented loop-hit-limit failure for 36 mutants:
33, 37, 46, 56, 285, 289, 715, 798, 842, 1051, 1057, 1064, 1092,
1093, 1118, 1131, 1132, 1148, 1161, 1166, 1167, 1186, 1187, 1188,
1206, 1215, 1284, 1321, 1323, 1349, 1354, 1513, 1518, 1777, 1860, 1907.
These failures do not depend on wall-clock machine load. Mutant 1186's `value >= 0`
condition never exits at zero because shifting zero preserves zero; it does not
merely add one iteration.

Three more timeouts (1079, 1806, 1825) reverse an incrementing counter into a
counter that decreases indefinitely while its upper-bound condition stays true.
Out-of-bounds typed-array accesses do not terminate these loops.

The remaining mutant, 50, replaces the LTC decoded-cache guard with `false` and
is finite. An exact isolated replay failed the existing cache identity contract
in 0.28 seconds: `assert.equal(ltcTable() === table, true)`. The boolean expression
avoids formatting two 32768-element arrays on assertion failure. Its timeout may
reflect diagnostic formatting or host load, but its observable cache regression
is independently detected. The authoritative report still classifies it Timeout;
this audit does not silently relabel it Killed. No finite extra-iteration mutant
remains an unexplained Timeout.

# Fluids S3 experiments

This is the isolated experiment for [#421](https://github.com/pasquelin/Trillion3D/issues/421),
not a production fluid API or an approved set of tiers. The existing wave, buoyancy
and particle implementations remain the S0–S2 foundations. These experiments do
not measure the placeholder smoke meshes of the older fluids scene.

## Run

The repository's recette session runs Chrome measurements. Inspect the candidate
matrix without starting Chrome:

```sh
pnpm run bench:fluid-s3 --list
```

Measure one indexed candidate, with five repetitions of disabled/enabled pairs:

```sh
pnpm run bench:fluid-s3 --case 0 --visible --width 1280 --height 720 --dpr 1 --repeats 5
```

Omit `--case` for the full matrix. `--frames` defaults to 180 measured frames;
`--warmup` defaults to 60. Each side uses a fresh system Chrome process and
identical candidate parameters. Pair order alternates between repetitions.
The disabled side keeps the same resource handles but performs no simulation or
effect draw. Reported bytes count declared allocations, not observed physical
VRAM residency. This control does not estimate removing fluids from a product.

Raw results go to `.mesure/out/421/s3.json`, or a file under `.mesure/out/421` selected by `--out`.
The command records its arguments, commit, dirty status, machine, CSS dimensions,
DPR, candidate, actual device/capabilities, allocations and separate CPU/rAF/GPU
samples. It saves each completed side so a later refusal does not erase results.
An interrupted run remains `running`, a thrown error is `failed`, and unavailable
GPU timing or a refused candidate produces `incomplete` with exit status 2.
No absent timing is substituted with zero or CPU time.

## Measurements to review

Ripples cover 256² and 512², WebGL2 and WebGPU, 30 Hz and a distant-water 15 Hz
update, with zero or 64 injection splats. Smoke covers 32³ and 64³, 10 or 20
pressure iterations, and projected areas of 6.25%, 25%, 50% and 100% of the canvas.
Its render target is half resolution, followed by a bilateral reconstruction.
Ripples measure simulation and injection only: their canvas is the control clear,
not a rendered water surface. Smoke measures simulation and volume rendering.
These two workloads must not be presented as equivalent rendering costs.
Simulation cadence follows elapsed rAF time, with a 0.25-second input clamp and
at most four ripple ticks or one smoke tick per submitted frame. `droppedSteps`
and `clampedSeconds` expose stalls; a candidate that loses simulation time has
not demonstrated maintaining its requested rate.

Compare repeated frame-envelope distributions and their spread before retaining
any candidate. Pass timestamps explain work; their sum is not the frame cost.
The standalone canvas measures this experiment's envelope, not interaction with
the production engine's other effects. Keep that distinction in the decision.
Record driver/browser/device, resolution/DPR, resource bytes, CPU submission,
GPU frame span, refusals and losses alongside the chosen candidate. Review the
visible smoke solution and the ripple state as well as the timings; a fast
unstable or empty simulation is not an acceptable tier. The ripple harness does
not provide a water-surface image proof.

Publish the measured decision on the issue through the recette workflow, then
remove temporary measurement output. The parent programme requires review of
S0–S3 before production integration. This harness does not imply that review has
happened or that any tier meets a hardware budget.

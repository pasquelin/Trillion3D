# S3 isolated smoke candidate

`createSmoke` allocates a 32³ or 64³ collocated velocity/density grid. A positive
`dt` encodes one semi-Lagrangian advection/source step, divergence, 10 or 20
Jacobi pressure iterations, and velocity projection. `dt=0` only draws the
resident field. The caller must submit each encode before encoding another:
step and camera uniforms are reused. The shared harness runs at most one
1/30-second simulation tick per animation frame and records dropped ticks.

The collocated central-difference divergence/gradient and six-neighbour Jacobi
Laplacian are an approximate stable-fluids projection. They do not form an exact
discrete inverse, and the fixed iteration count leaves a pressure residual.
Neither exact incompressibility nor numerical convergence is claimed by the
command-graph unit tests. Recette must inspect the evolving field and image.

The camera is the harness's fixed orthographic square frustum, looking along
negative Z from `[0,0,2]`. SDK matrices use clip depths `[-1,+1]`. The volume's
half-extents are `[sqrt(coverage),sqrt(coverage),0.5]`, so its projected area is
exactly the requested fraction before pixel rounding. The scissor assumes this
camera; the matrix input is not a promise of arbitrary-camera support.

Raymarching uses at most 128 midpoint samples per intersecting half-resolution
pixel. Extinction is 8 and the bounded source colour is `[0.65,0.7,0.8]`.
Stopping at transmittance below 0.005 omits at most 0.005 opacity and at most
0.005 per colour channel **relative to the remaining discrete samples**. This is
not a bound on sampling, half-resolution, pressure or advection error against a
continuous/reference image. A 2×2 bilateral upsample uses actual box-entry depth
and blends premultiplied colour over the harness background. There is no opaque
scene-depth input or claim about interleaved transparent geometry.

Resources total 28 bytes per grid cell: two RGBA16F state fields, two R32F
pressures and one R32F divergence. Half-resolution colour/depth add 12 bytes per
pixel, plus 144 uniform bytes. Admission limits this declared storage to 64 MiB;
allocator overhead and pipeline/driver memory are not included. R32F bindings
use unfilterable texture loads and need no optional float32 filtering feature.
Buffers, bind groups, staging arrays and pass descriptors are reused per frame;
the WebGPU implementation still owns command encoding allocations.

CPU tests verify resource admission/cleanup, pressure ping-pong and final
bindings, dispatch counts, paused drawing, invalid steps, and the SDK camera's
near/far and coverage geometry. All six complete shader modules pass Naga 27.0.3
validation with optional capabilities disabled. These are structural checks,
not a GPU execution, image or timing proof. No candidate is a retained tier
until recette records matched GPU captures and image results.

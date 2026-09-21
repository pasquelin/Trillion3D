# Specification — WebGeometry without Three.js: engine, editor, final bake

Version 2, 16 September 2026. Reference document for agents. Every requirement is numbered and
verifiable; a requirement without an associated measurement does not exist.

## 0. Goal and non-goals

Goal: a complete, autonomous virtualized-geometry engine for the web, usable in an editor (edit
mode) and shippable in a game (final mode), at 120 frames per second on the bench scenes, with no
rendering loss, and with no Three.js dependency in the SDK or in the shipped runtime. Three.js
survives only in the measurement bench, as a witness engine.

Non-goals for this version: skeletal animation, physics, audio, networking. Dynamic global
illumination, reflections and shadows are NOT non-goals: they are the end goal, by stages, in §8.
They are out of scope and must not be started before phases 1 through 5 are done.

Cross-cutting rules: fidelity before speed (no reduction of resolution, distance or quality;
transparent surfaces never turned into masked ones inside the engine); no debt; forbidden words
(the name of Epic's virtualized geometry system, the name of its engine); a host configures
nothing and reads no format field; tests written after the code, in one pass; every merge proven
by identical captures or a difference explained at A/A noise level.

## 1. Target architecture

```
Sources (glTF, FBX, OBJ, STL, PLY, images)
        │
        ▼
[1] Native Rust compiler (single binary, multi-OS, also wasm for the editor)
    import → normalisation → 128-tri clusters → per-object DAG (multi-material)
    → certified error (shape + colour + quantisation) → self-contained packets
    → streamable texture mips → binary manifest → per-object cache, addressed by digest
        │                                   ▲
        ▼                                   │ recompilation of one object (edit mode)
[2] Versioned cache format (static folder, everything in .bin + one small JSON)
        │
        ▼
[3] Browser runtime (TypeScript + WGSL + GLSL, zero Three.js)
    loader → priority streaming → cluster selection (GPU on WebGPU, CPU on WebGL2)
    → rendering (visibility buffer + deferred lighting on WebGPU; multi-draw + forward on WebGL2)
    → scene API (add, remove, transform, materials, camera, picking)
        │
        ├── [4] Editor (edit mode: incremental compile, hot swap, source mode, history)
        └── [5] Final bake (final mode: global recompile, district blocks, streaming order, runtime only)

[6] Bench: Three.js witness, 4-engine campaigns, WebGPU/WebGL2 parity, captures, reports
```

## 2. Native compiler (Rust)

C1. **Import**: native glTF/GLB; FBX and OBJ via `ufbx`; STL and PLY. Normalised output: positions,
normals, UVs (two sets), colours, tangents if present, PBR materials (colour, metal-roughness,
normal, emission, occlusion, alpha mode), hierarchy and matrices, instances. Criterion: the eight
bench scenes and three test FBX/OBJ files imported without Blender or Node.
C2. **Clusters**: spatial partition into clusters of ≤ 128 triangles, compact, sphere and box
bounds. Criterion: size distribution published, no degenerate box.
C3. **Per-object multi-material DAG**: built on every opaque primitive of a mesh; groups of 8 to 32
clusters; group simplification with per-vertex locks at group borders; each triangle keeps its
material; pages publish per-material ranges. Material borders stay locked while they cover more
than one pixel at the level-switch distance, free beyond. Transparents: own DAG per primitive,
source order kept. Criterion: Emerald general view ≤ 200,000 selected triangles at 1 px for a
city, identical image at 0 px, differences at 1 px localised and under the threshold.
C4. **Certified error**: `error(cluster) = max(group geometric error, child errors) + quantisation
error + colour error` (UV deviation and texture-weighted normal), monotonic, in object units, with
a projection sphere. Criterion: monotonicity test on every scene, zero violations.
C5. **Self-contained packets**: each cluster is a page of its own (`WGP3`, `docs/FORMAT.md`)
holding bit-packed local indices, positions on a per-primitive power-of-two grid with per-cluster
minima and widths, 16-bit octahedral normals, UVs on a `2^-14` grid, colours on a `2^-8` grid, no
tangent; streams the GPU reads in place, no compression library; `source.bin` is no longer read by
the runtime. Criterion: bytes per triangle ≤ 12 — measured 18.3 on Emerald Square and 9.9 on
Whisperwind Village (#9), the gap being one vertex per triangle of topology and index bits;
Emerald general-view fill < 300 ms warm.
C6. **Textures**: PNG/JPEG decode in the compiler, mip generation, split into tiles or streamable
levels, atlas table; raw GPU format, lossless, or lossy block-compressed (BC/ASTC, see §7 and
Textures T5; the bench's 0 px thresholds do not apply to that lot). Criterion: Emerald's first
frame with no full-resolution texture; mips requested by visibility.
C7. **Binary manifest**: typed columns (bounds, spheres, errors, levels, groups, material ranges,
packets, offsets), a JSON of a few hundred KiB (objects, materials, structure), all addressed by
SHA-256 digest. Criterion: load + decode < 100 ms for Emerald.
C8. **Per-object cache**: one compiled object = one directory addressed by the digest of its source
and options; a scene = a manifest that references objects and instances. Recompiling one object
does not touch the others. Criterion: edit an Emerald object and recompile ≤ 500 ms for a 100,000
triangle object.
C9. **Single binary**: one executable per OS (macOS arm64/x64, Linux x64/arm64, Windows x64),
stdout event protocol (progress, errors, short result), result written to disk, never a full
manifest on stdout. The same code compiled to WebAssembly for the editor (compile one object in
the browser, off the main thread). Criterion: a host prepares its scenes with Node only as a
relay; the editor recompiles an object without a server.
C10. **Provenance**: compiler digest (sources + locked dependencies) in every cache; two compiles
of the same file yield the same bytes. Criterion: null diff between two runs.

## 3. Browser runtime (TypeScript, WGSL, GLSL)

R1. **Zero Three.js dependency** in `sdk-browser`. Own math (matrices, quaternions, frustum, rays)
shared with the compiler via wasm where parity matters (screen error, picking).

The WebGL2 migration starts with an engine-owned surface: the engine creates the context with its
declared attributes, owns drawing-buffer size and DPR, observes loss and restoration, and releases
the context on disposal. During this foundation stage, the Three scene renderer receives that
already-owned context as a temporary draw adapter. Cluster programs, composition targets, captures,
and observation meshes move to engine resources in the following stages; this stage does not claim
their removal or a performance gain.

The next delivered stage owns opaque and alpha-masked prepared-page cluster submission on WebGL2.
Its GLSL implements an additive Lambert plus Cook-Torrance GGX/Smith/Schlick model from published
material equations and handles the glTF texture channels, transforms, UV sets and samplers accepted by
its explicit compatibility gate. Published geometric normal variance filters specular roughness, and
identical mobile-scene campaigns must equal or beat the temporary adapter's whole-frame envelope.
One frame owner routes display, render targets, held-frame recovery
and capture through that program, then restores state for the temporary scene adapter. The image
delta, curved-surface stability and whole-frame cost against the witness are measured and
published; this stage does not claim bit identity or an unmeasured speed gain.

The following stages own clustered blend, side-split ordering and diagnostic pages on the same
program (#119), then transmission (#120): a transmissive source mesh stays a scene copy of the
engine's, composed after the clusters over a frozen backdrop of the frame in linear light, the
same model as the WebGPU transmission pass. With that, no paged cluster has another renderer:
the temporary complete-scene path is gone, and a scene the program cannot draw in full fails its
preparation with a named error instead of a partial image. What remains of the adapter is the
composition host of the non-transmissive blended copies, the comparison compositor, captures and
held frames (#85).

The first stage of #85 measured that remainder before touching it — at most 0.3 ms of the CPU
frame on `exact-cluster-pages`, 0.1 ms p95 per host segment, no gain to claim (the numbers in
`docs/API.md`, batch E6) — and
made the engine surface the session's WebGL2 authority, the Three adapter a detail of the
composition host alone. The second stage removed that adapter: the composition host holds no
renderer (`docs/API.md`, batch E7: what each engine object computes, what it replaces, and the
byte proof — captures identical, two defects of the Three path gone with it). What remains is
the third stage: the draw records' `BufferGeometry` and `Material` descriptors, the
non-transmissive blended copies the owner will submit — the scene the exact engine still hands
the witness adapter — and the observation meshes.

R1a. **What remains of Three.js in the engine, measured.** The 15 September survey (lot T1) listed
file by file every call to a Three.js math method in `sdk-browser`; those counts are stale and are
reread from `git log` rather than copied here. The rule in force is the closed list held by
`test/integration/moteur-sans-three.test.mjs` and
`test/integration/moteur-sans-three-math.test.mjs`: any engine file that imports `three` outside
that list fails the test, and the list never grows. On the per-frame WebGPU path: cluster cut
(`pageSelectionCut.ts`), selection uniforms (`gpuSelection.ts`), encode of draws, blending and
shadows (`webgpuPagesEncode*.ts`), face winding (`webgpuBlendDraw.ts`), Hi-Z (`hizDepth.ts`,
`hizProjection*.ts`, `hizTemporal.ts`); the view-projection matrix is recomposed there nine times
by independent copies. At load: page boxes and spheres (four copies of `Box3.getBoundingSphere`),
node world matrices. The rest serves only the Three witness engines (`referenceBackend.ts`,
`threeLod.ts` with `LOD.update`, `exactPages*.ts`) and diagnostics. Homegrown calculations already
exist and are the base: `extractPlanes`/`boxClip` (`pageSelectionMath.ts`), box-corner transform
(`hizCorners.ts`), `maxStretch`/`clusterErrorPixels` (`projectionOracles.ts`),
`shadowProjection`/`shadowOrthographic`/`composeFace` (`sceneLightShadowMath.ts`), and the shared
functions of the `formules-communes-*` lots.

R1b. **Homegrown math foundation, not a Three clone.** A module in `sdk-core` (no DOM), limited to
operations actually called: 3- and 4-vectors, 3×3 and 4×4 matrices (product, inverse, determinant,
normal matrix, TRS compose/decompose, `lookAt`, perspective and orthographic in the engine's only
depth convention — reversed-Z `[0,1]`, infinite far plane, housed in
`packages/sdk-browser/depthConvention.ts` and composed by `perspectiveProjection` of
`packages/sdk-core/mathCamera.ts`), quaternions, colours (HSL, sRGB ↔ linear, already factored).
Representation: column-major `Float64Array`/`Float32Array` like Three, outputs passed in, zero
allocation per frame, batched operations (n boxes, n spheres) rather than per object. Replacing
each Three method while keeping `THREE.Vector3`, `THREE.Matrix4` or `Object3D` in the signatures
does not count: the dependency is gone when no Three type crosses the engine.

The batched form is part of the runtime's public maths (#80): `packages/sdk-core/mathBatch*.ts`,
listed in `docs/API.md` § "Batch math for hosts" and taught in `docs/SDK.md` under the same title
— `n` elements per call on flat arrays or sub-views of a fixed stride, no allocation, each
repeating the unit function that stays its oracle, exported by `sdk-core`, `sdk-browser` and
`web-geometry` alike. A WebAssembly kernel exists only where the governor (`mathPathGovernor.ts`)
has a measured loop to arbitrate; a loop the engine's own frame measures under its clock keeps its
JavaScript form.

R1c. **Transforms and camera owned by the engine.** The hard part is not the formula but the
hierarchy: parent/child, update order, dirty marking, negative and non-uniform scales (the sign of
the determinant decides face winding), singular matrices, camera (view, projection,
view-projection, inverses, frustum planes) and depth conventions. These objects replace
`updateMatrixWorld`, `getWorld*`, `lookAt`, `updateProjectionMatrix` on the WebGPU path.
`LOD.update` belongs to the Three witness engine: it follows it outside the SDK, it is not
rewritten.

The first scene-model foundation is delivered: `sdk-core` exposes versioned `SceneRoot` and
`SceneNode` handles over that transform hierarchy, with stable ids, visibility, attach/detach,
copy, clone and explicit destruction. It does not mark the host-contract group complete:
materials, frame hooks and the `createExplorer` migration remain later #78 lots, and the browser
runtime still consumes its existing scene contract meanwhile.

R1d. **Proof, on every lot.** Equivalence bench against Three.js on representative and degenerate
cases (negative scales, non-uniform, singular matrices, NaN, ±0, infinities): bitwise identity
where the formula is the same, otherwise a bounded difference explained before merge; common-bench
campaign at 0 pixels (three still views and a moving camera, two thresholds, A/A witness),
`tri = selected`, per-frame allocation counter at zero; structure tests
(`test/integration/moteur-sans-three.test.mjs`,
`test/integration/moteur-sans-three-math.test.mjs`) forbidding `three` in WebGPU-path files then
in all of `sdk-browser` outside the witness adapter. A speed gain is not a goal of these lots: it
is measured, it is not assumed.

R1e. **Workers and WebAssembly: after measurement, never for an isolated matrix.** A worker frees
the render thread, WebAssembly speeds compiled code, the two combine (page decode:
`pageDecodePool.ts`, `pageDecodeTask.ts`, `geometryPageWasm.ts`, already in place). Intended split,
to confirm on the bench on a quiet machine: camera matrices, vectors and colours in TypeScript on
the render thread; transform of large vertex sets and batched volume math in a worker, Wasm if the
gain is measured; spatial-structure build in a worker, Rust/Wasm shared with the compiler where
parity matters (screen error, picking); current-frame visibility selection unchanged until another
organisation has been measured. The number of call sites does not measure a cost: real frequency,
volume processed and cross-thread traffic are measured before any move. Transferable buffers avoid
copies but change owner: a lot, not a call.

R1f. **Image output owned by the engine.** With a single WebGPU engine, the host canvas is
configured by the engine's own `GPUCanvasContext` and the composition pass writes the display
image straight into the swap chain: there is no separate presentation pass to remove, and no
object of the host's rendering library on that path. A host that composes several engines on a
WebGL2 surface receives the engine's canvas as `presentedSurface` and copies it with the engine's
own full-screen program (`webglCanvasBlit.ts`, one owner for the frame and the capture alike): the
rows are reversed once, the source is read in the encoding the destination writes — a host render
target is sRGB, the page framebuffer is not — so nothing converts twice, and the synchronous
capture reads the same copy. What still belongs to the host library on the output side is the
WebGL2 renderer itself — the batch engine written on host meshes
and the composition host around it — and it is written by its own lot, not by this one.

R2. **Loader**: reads the binary manifest and packets; never a format field on the host side;
public validation (`assertCachePointer`, `assertCacheReady`).
R3. **Streaming**: 32 in-flight transfers, priority by screen error then distance, prefetch ring,
camera prediction, byte-bounded LRU cache, persistent digest cache (Cache Storage/OPFS), in-flight
transfers never cancelled by a move. Criterion: after a camera cut, complete cut < 300 ms warm;
second visit with no network.

R3b. **Page budget, and what it guarantees.** The budget is a **byte** reservoir set by the host
(`geometryPoolBytes`, 512 MiB by default like the reference's pool), converted into distinct pages
— never into placements — at the size of the largest page; it never drops below root coverage, and
a reservoir full of pages the frame holds stops the load burst without dropping anything
(`geometryPoolSaturated`): a cache slot holds one page, and two placements of the same cluster —
under two instances of an object — occupy one. When the requested cut exceeds the budget, the
queue keeps the coarsest prefix (decreasing levels, publication order at equal level); the cache
reclaims slots by age when they run out, and what the frame draws is pinned while it draws it,
including a resident ancestor the cut did not request. Forcibly unloading every key that leaves
the kept set was tried and measured: 211,041 evictions in seventy frames, a coarser image, not to
be repeated. Guarantee: **the resident set is a function of the requested cut and the budget
alone**, never of the order in which the network delivered the pages — two runs of the same camera
at the same threshold reside the same set and produce the same image. Criterion: 0 px A/A witness
on four runs, harness default warmup.
R4. **Coverage**: pinned roots, per-group fallback onto the resident coarse representation, never
a hole, never an exception other than a missing root. Criterion: `tri = selected` at every budget
≥ roots.
R5. **Selection**: WebGPU compute (one thread per cluster, early-reject culling hierarchy,
two-phase Hi-Z occlusion — main pass culled by the previous image's pyramid, post pass re-tested
by this image's, `gpuPartitionProjectWgsl.ts`); WebGL2 on CPU (culling hierarchy,
allocation-free) with a Wasm SIMD option if > 2 ms. Criterion: Emerald selection < 1 ms GPU,
< 2 ms CPU.
R5b. **Hi-Z test invariant.** The occlusion test never decides that a visible cluster will not be
drawn: it compares a **strict lower bound** of the depth the cluster will write to an **upper
bound** of the depth already written on its footprint. The upper bound is the max reduction of the
already-drawn pass depth, sampled at the mip whose outward-rounded footprint covers the screen
rectangle clipped to the viewport. The lower bound is the nearest corner of the **whole** box,
corrected for two gaps: single-precision transport rounding, directed toward −∞, and the coplanar
layer bias, subtracted in hardware units by `biasedDepthBits` — a cluster of non-zero layer is
drawn closer than its own corner. A box that crosses the near plane, an empty footprint or one
wider than the kernel never rejects. Consequence: the test may delay a cluster by one pass, never
remove a pixel. Criterion: constructed cases (rounding that goes up, coplanar layer) in
`hizNearestBound.test.ts`, and 0 px on the bench.

R5c. **On a pixel of exactly equal depth, the winner depends on visibility history.** The
occluder/tested split decides **draw order**, and at equal depth the `greater` test
(`DEPTH_COMPARE`, `packages/sdk-browser/depthConvention.ts`) always gives the pixel to the first
drawn. Four facts, measured on the bench and true of every scene by construction. **(a)** A depth
layer is carried by `pageDepthLayer`, a value **per primitive page**: it separates neither two
triangles of the same cluster, nor two instances of the same page — 57 to 77 % of equalities in a
real scene. **(b)** 100 % of the pixels a partition change moves oppose **two distinct clusters**.
**(c)** But those clusters are not coplanar: read on the cluster-identity image, they are
**boundary** pixels — the loser occupies a neighbour of the reference image, no neighbourhood is
uniform — on an **edge that two non-coplanar surfaces share**. The relation at work is “two
clusters share an edge”: massive, view-borne, outside the four layer bits. No extension of
`coplanar-depth-layers-*` can therefore fix that winner, and the compile-time winner is
**abandoned**. **(d)** Contract: on a pixel where two clusters have exactly the same depth, the
winner depends on visibility history; the bound is the **exact-equality set**, ≤ 0.007 % of the
image on the bench scene. Proof required of a partition change: every moved pixel belongs to the
exact-equality set measured by an instrument that replaces `DEPTH_COMPARE` with
`depthCompare: 'greater-equal'` (instrument to write: nothing of the kind exists today in
`packages/sdk-browser`); its per-view count does not exceed that of the single pass; the image
does not flicker from frame to frame with a still camera; the moving camera at both thresholds
stays inside the equality set; holes 0 and identical cut.

R5d. **What the cut does not reread per cluster: the root declares it once.** The per-cluster path
of the cut (`take`, `keep`) is walked eighty thousand times per frame on the general view:
everything constant under a node is set once per root or per cut, then passed in — never reread
from state or from the record. Two declarations follow. **Cones**: `ClusterRoot.cones` is `false`
when no page of the root carries a normal cone, and the cut then stops reading `cone`; absent or
`true`, it tests every page. Silence therefore keeps the full behaviour, and **whoever puts a cone
on a page raises its root's flag** — `collectClusterPages` declares `false`, `prepareCones` raises
`true`. That is the only contract that makes an omission visible: a root that carries cones
without declaring them would lose them silently. **Residency**: the rule (`RESIDENT_ALL`,
`RESIDENT_ASK`, `RESIDENT_ARRAY`) depends only on the cut request and is resolved once in
`selectVisiblePages`. Criterion: bitwise-identical cut, equal `selectedTriangles`, 0 px with still
and moving camera at both thresholds.

R5e. **What the culling hierarchy has already settled: the trunk.** Measured on the bench scene,
hierarchy included, general view at threshold zero: 80,153 clusters visited, **all under a node
entirely in the trunk**, and **2,479 box-test calls in total — one per root, none on an inner
node, none on a page**. V8 profile of the cut: `traverse` 36.4 %, `keep` 20.1 %, `take` 11.0 %,
**box test 3.2 %**. The previous lot's “two thirds of the time in the trunk test” was the artefact
of a profile taken **without** the hierarchy, where every page pays its test; with it, the trunk
is already resolved at the first node of each root. Contract consequence: the only record read the
trunk still imposed on a cluster it does not test is the **presence** of its box, and
`ClusterRoot.boxes` removes it — `true` declares that every page of the root carries `min` and
`max`, absent or `false` checks every page as before, and `collectClusterPages` declares `true`
because the page contract makes both mandatory. Criterion: identical cut, `selectedTriangles`,
`nodesTested` and `frustumRejected` equal, 0 px with still and moving camera at both thresholds.
Second consequence, on the lists: the two cuts were not expensive because of `push` but because
`length = 0` **gives back their capacity every frame** and they grow it from zero to eighty
thousand — so the lists are written by index and take their length only once the cut is done,
with the state's counts authoritative in the meantime. What remains for the 2 ms target is no
longer the trunk but the record itself: `traverse`'s page loop, the per-cluster dispatch, and the
per-root cost (2,479 world box tests, two matrix products and a plane extraction).

R6. **WebGPU rendering**: visibility buffer, compaction and `drawIndexedIndirect` per cluster,
software raster bounded to real small triangles, material resolve one class per pass under the
material-depth test (#11; tile binning of classes is not done), deferred lighting
(GGX, IBL if and when shipped, ACES tone mapping, sRGB), transparents in GPU selection and
indirect per material, static page table updated per page, zero allocation per frame. Criterion:
Emerald 1280×720 CPU < 4 ms, GPU < 6 ms, image identical to the reference.

R6b. **What the fixed CPU still costs, and where it went.** The fixed CPU cost of a WebGPU frame
(Emerald, general view, threshold 0, 1280×720) is **4.7 to 4.9 ms** after the `blend-encodage`
lot, against 6.1 to 6.2 ms on its base in the same run, 7.7 on the evening of the 15th and
33.6 ms on 14 September. **With a moving camera the lot returns nothing** — 8.7 → 8.5 ms at
threshold 0, inside the noise: every projected bound changes each frame, so no box is held. The
per-step profile, measured bound by bound and not deduced from a neighbouring counter, gives the
remaining posts in order: **draw records ~1.3 ms**; **cut adoption 0.9 ms**; **transparents
0.8 ms** (world 0.2 · blend uniforms 0.4 · encode of the 1,928 calls 0.2); **Hi-Z test ~0.4 ms**
(the comparison of held boxes, still camera); **animations 0.4 ms**; **occluder-history loop
0.4 ms**; **partition 0.4 ms**; **uploads 0.2 ms**.

Two reading errors are corrected here. **Blend-pass encode does not cost 2.7 to 3.1 ms but 0.2**:
the `appelsDeMelange` counter displays on the “Pass encode” line, the blend duration does not —
`transparentEncodeMs` lands on “Transparents” and `encodeRestMs` subtracts it. The 2.7 ms were
**packing of the Hi-Z tested boxes**, 1.7 ms for thirty-six thousand boxes and 1.18 MiB per
frame, plus 0.4 ms of occluder-history loop. And **per-object reading of the records needed no
new invariant**: the page-table row already carries the index count the GPU draws, written by the
same function that writes the row; reading it is more exact than rereading the object, not less.

What remains refused, and the reason matters: caching `uncoveredTriangles` would make the no-hole
proof depend on the accuracy of a stamp; holding the **entire result** of the records from frame
to frame still needs the unproven invariant on the lifetime of a resident page's array; and
carrying the Hi-Z test projection onto the GPU is impossible bit-exact, `projectCornersInto`
projecting in double precision and `hizNearestBound` drawing its lower-bound proof from that
precision, which WGSL does not have.

R6c. **What a reader keeps from frame to frame carries the age of what it describes.** Every list,
count or bound held from one frame to the next must be validated by a stamp of the described data,
never by a flag set during render: cut adoption also happens **outside** render — the drain
replays one after the host has taken its lists — and a per-frame flag does not see what moves
after it. Cost of forgetting, measured: 5,918 pixels and a cut of 1,273,565 triangles instead of
1,599,951, invisible with a still camera. Criterion: **every optimisation of lists, residency or
pinning is proven with a moving camera**, at both thresholds, in addition to the still poses.
R6d. **Transmission is a fullscreen pass, not a forward blend.** A material that transmits —
`KHR_materials_transmission`, with `KHR_materials_ior` and `KHR_materials_volume`; water, thick
glass — is composed by the water pass (`webgpuWaterPass.ts`), after the ordinary blends, on the
image they left. Contract, in three steps and one hook (`webgpuWaterFrame.ts` holds the frame side:
its bind group, its copies and its two passes, rebuilt only when a target or a lighting resource
changed identity). **(a)** The backdrop is frozen: the lit image is copied once, and the opaque
depth once into the depth the surface stage tests (`webgpuTransmission.ts`); the composite reads
the opaque depth itself, which nothing writes in between. **(b)** The surface stage (`WG water
surfaces`) draws the transmission slice of the blend plan with the blend vertex stage and the blend
material read (`webgpuBlendShaderSurface.ts`, the single read of a transparent material, shared
with the blend fragment), into the opaque resolve's own surface buffer — free once that resolve
consumed it — plus the item's water rank and the opacity (`webgpuWaterSurfaceWgsl.ts`); hardware
depth is tested against the opaque copy and written, so the nearest surface of a pixel is the one
composed and a surface behind an opaque never is. **(c)** The composite (`WG water composite`,
`webgpuWaterCompositeWgsl.ts`) lights each water pixel once, with the engine's only lighting
formula and its only reflection model — `declaredLighting`, `sampleBounce`, on the deferred bounce
layout's own binding numbers and WGSL blocks —, refracts the backdrop by the material IOR
and attenuates it by the volume colour over **the distance the ray travels in the volume: the
declared thickness, or the distance to the opaque backdrop under the pixel when that is shorter**.
That bound is what makes the pass water as the reference's single-layer water is: a basin declared
deeper than its floor renders its floor, a block just below the surface is displaced and tinted by
its own depth. Over an empty backdrop the transmitted share keeps that emptiness as coverage, and
the display background shows through. The hook is one line of `encodeBlend`: the pass is encoded
when the frustum kept a transmissive surface; a diagnostic view or variant, or a capture from a
second camera, draws the slice as one more blend. Nothing is bound per item any more: the material
volume is read by water rank — carried above the item's flags, compact over the transmissive items
— in a storage buffer sized to them, the blend layout lost its three transmission bindings, and the
transmission slice merges its runs on the blend's terms. Declared limits, shared with the forward
pass that preceded: one screen-space sample at the exit, never a march, so a ray that crosses an
object before its exit does not see it; no transmissive surface sees through another. Criterion:
0 px A/A on the repository fixture (`fixtures/classes-materiaux/transmission.gltf`, the only asset
in the repository with a transmissive surface — neither bench scene carries one) and on the bench
scene, whose image the batch does not move; the browser proof
`test/browser/water-pass-webgpu.browser.mjs` predicts the composed pixel from the material numbers
alone, paged and unpaged, and holds the still image.

R7. **WebGL2 rendering**: the same lighting formulas in GLSL generated from the same source as the
WGSL, persistent index buffers, `WEBGL_multi_draw`, one draw per material not per object (instance
matrices in a texture), sorted transparents, textures and mips managed by the runtime. Criterion:
pixel parity with WebGPU on every bench scene (max error ≤ 2 per channel, explained), CPU < 8 ms
on Emerald.
R7b. **What an instance costs, and what it does not.** Placing the same object N times allocates
**no extra geometry**, on either engine: vertices, indices, UVs, normals and tangents belong to
the source geometry, never to the placement, and the shape of its DAG — culling hierarchy,
per-node bounds, error bands, streaming packets, group links, cluster identities — is computed
once per object and reread by each placement. What a placement owns is what distinguishes it: its
world matrix, its world box, its draw rank, its forced-group flags, and one record per cluster —
because its cut belongs to it, projected error depending on its distance. The page budget does not
count twice a cluster placed twice (R3b). Criterion: `geometryAllocationBytes` identical at 1 and
at N instances (Emerald, WebGPU 209.1 MiB, WebGL2 223.3 MiB at 1 as at 9), identical image at 0 px.

R8. **Scene API**: `addObject(cache, transform)`, `removeObject`, `setTransform`, `setMaterial`,
`setCamera`, `pick(x, y)` (ray against visible clusters and real triangles), residency and loading
events. Criterion: operations applied on the next frame, no per-frame allocation.
R9. **Honest metrics**: rAF, CPU per step, GPU per pass (WebGPU) or `null`, submitted and selected
triangles under the same contract for every engine, `pagesDetached`, `cacheEvictions`, holes
measured by the SDK itself. Criterion: identical fields across engines, no deduced value.

## 4. Edit mode

E1. **Editable object**: an imported object exists in two forms: source (raw triangles) and
compiled (clusters). The engine displays the compiled form by default.
E2. **Instant gestures** (no recompile): add, remove, duplicate, move, rotate, scale, change
material or texture, visibility. Criterion: effect on the next frame.
E3. **Sculpting and mesh edit**: during the gesture the object displays from its source form
(direct path, no LOD); on release, recompile of that object alone in the background (wasm in a
Worker, or native binary if the host is Electron); hot swap when the cache is ready, previous
version displayed until then. Criterion: no dropped frame during the swap, recompile ≤ 500 ms for
100,000 triangles.
E4. **History**: each compiled version addressed by digest; undo = redisplay an existing cache;
garbage-collect unreferenced versions. Criterion: undo/redo in < 16 ms.
E5. **Tools drawn by the engine**: handles, selection, grid, boxes, everything is rendered by our
runtime (no overlaid Three canvas). Criterion: no Three.js dependency in the editor except import
if it remains there transiently.
E6. **Project**: a project file references sources, options, caches by digest, scene; cold-reloadable
without recompiling what has not changed.

## 5. Final mode (bake)

F1. **Single command**: `compile --final <project> <output>` produces a complete static folder.
F2. **Global optimisations**: recompile of every object with the same options; **district blocks**:
neighbouring objects merged into a scene DAG for distant views (identical-pixel rule); packet
order along likely paths; streamable texture mips; digest deduplication.
F3. **Shipped runtime**: the rendering SDK alone (a few hundred KiB), no compiler, no editor, no
Three.js. Load from a plain static folder or a CDN, `Cache-Control: immutable`.
F4. **Criterion**: on Emerald × 9, general view < 2 M selected triangles, 120 FPS presented on
WebGPU, first frame < 1.5 s cold and < 500 ms warm, image identical to edit mode at the same
threshold.

## 6. Bench and proof

B1. Three.js remains the **witness engine**: same scene, same camera, lossless PNG
capture, pixel comparison at 0 px (identity expected) and at 1 px (differences localised to
switches), A/A witness.
B2. **WebGPU/WebGL2 parity**: automatic test on every scene, max error ≤ 2 per channel, else fail.
B2bis. **Temporal antialiasing** (WebGPU, on by default): accumulation only touches the two pixels
of an edge, surface interiors stay at 0 px, two runs produce the same image bit-exact, a frame is
held only after a full cycle of still frames, and a moved object leaves no ghost; 0 px benches
turn it off (`temporalAntialiasing: false`).
B3. **Campaigns**: visible 120 Hz window, idle machine, measure mode without a trace, ABBA,
DPR/pixelError/resolution/commit recorded, four engines, 1 and 9 instances, every scene; verdict
per scene and engine (presented FPS, p95, p99, frames > 8.33 ms, different pixels, first frame).
B4. **Repository bench** (`scripts/mesure/banc.mjs`) for the fast proofs of each merge: the
repository measures itself, with no other project on the machine.

## 7. Risks and decisions taken

- Vertex quantisation: accepted, quantisation error enters the certified error (decision of
  14 September).
- Lossy texture compression: accepted for textures alone (decision of 17 September 2026, Textures
  T5) — BC on desktop, ASTC on mobile, to ship with before/after images and the measured delta
  published. The bench's 0 px thresholds do not apply to that lot; they remain intact for geometry
  and lighting. Lossless streamable mips first.
- FBX: imperfect free reader; glTF remains the pivot, upstream conversion if needed.
- WebGL2: never the same pipeline as WebGPU (no compute); parity required on the image, not on the
  method.
- Three months of agents estimated for phases 1 to 7; phases 1 to 3 already give a shippable
  rendering engine.

## 8. Lighting: the target and the web strategy

End goal: the reference's lighting — dynamic global illumination, reflections, shadows — at its
performance, on the web. Nothing here is copied: what follows comes from public material (SIGGRAPH
talks 2021–2022, documentation) and from what the engine already has.

What the reference is made of, and our counterpart:

| Reference piece                                   | Role                                                         | What we have today                                           | What is missing |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | --------------- |
| Temporal antialiasing                             | denoises everything stochastic                               | shipped (Lumière 16), 0 px A/A                               | —               |
| Screen traces                                     | first shot of every ray: image depth and normal, almost free | nothing                                                      | L1              |
| Distance fields (per mesh, then global)           | off-screen rays without hardware ray tracing                 | certified-error resident proxy, walked triangle by triangle  | L4              |
| Surface cache                                     | radiance of off-screen surfaces, updated under budget        | one radiance per triangle and proxy face, swept under budget | L4              |
| Screen probes (16 px grid) + world radiance cache | final gather, temporally filtered                            | cascaded SH2 world probes; no screen probe                   | L5              |
| Reflections                                       | screen traces, then distance fields reading the cache        | none                                                         | L1, L6          |
| Virtual shadow maps                               | 16k shadow pages, only the views, cached                     | 4096 atlas, page-cached sliding cascades, 1 ms budget        | L3              |
| Stochastic direct lighting                        | few samples per pixel, denoised                              | tiled culling; four draws per moving pixel, exact at rest    | L2 (denoise)    |

What the web imposes, and the answer:

- **No hardware ray tracing**: the reference's software path — screen traces first, distance
  fields next — is the one taken; the distance field is baked by the compiler, like textures, at a
  resolution fixed by the budget.
- **Bounded, unreadable memory**: what streams enters a host-set byte reservoir, never read off
  the machine (§3, `geometryPoolBytes` and `texturePoolBytes`, adjustable in session by
  `setMemoryBudgets`), and displays coarser if it does not fit, never refused; image targets
  follow resolution with no ceiling; textures and geometry first return what they take (T2bis, T5,
  Geometry 5 and 11).
- **One browser frame**: each piece has a millisecond budget and a reading by envelope difference;
  lot order follows what the measurement says costs, not preference.
- **No persistent threads, eight storage buffers per stage**: worked around as for the DAG cut
  and the compute raster.

Stages, each with its proof (0 px A/A at rest, budget held, before/after published):

- **L0** — done (Lumière 17, campaign 18 Sept. 2026, Emerald 2496×1404): the sun is 4.7 ms of
  envelope on the ground view and 5.8 ms on the street view (`mobile` − `sans-lumiere`); lighting
  without maps ≤ 0.96 ms (`lampes-4-sans-ombres` − `sans-lumiere`); still camera: 0 page redrawn,
  envelope no lower. What remained, the sampling, is L2 below — not a cascade ring.
- **L1** — screen traces: reflections and short bounce from the already-rendered HDR, depth and
  normal; the cheapest piece of the reference, and the first.
- **L2** — sampling done (#36, 20 Sept. 2026, Emerald 2496×1404, ground view, 32 shadowed
  lights reaching one pixel): a moving pixel weighs every light of its tile without its shadow,
  shades the four it draws — exactly those worth a sample's share, stratified for the rest —
  and the history averages the draws; a still image shades every light and converges to the
  exact sum, 0 px A/A. Envelope 39.9 → 17.9 ms GPU on a moving camera; the grain left in motion
  is measured in `docs/SDK.md`. What remains of L2: a spatial denoise before the history,
  where the reference has one.
- **L3** — shadows in virtual pages from the hardware raster (Lumière 2, 6, 12): only the pages
  seen, cached. The compute raster has been off since Geometry 26, measurement done.
- **L4** — baked global distance field, walked in compute, reading the proxy's surface cache.
- **L5** — screen probes gathering L1 and L4, filtered by temporal history; world probes
  (Lumière 11) for the far field; bounce on by default when its budget holds.
- **L6** — rough reflections and materials (Lumière 7, 10).

Exit criterion: on the same scene and the same machine as the reference (Geometry 25), same image
to the eye, same byte budgets, same millisecond envelope.

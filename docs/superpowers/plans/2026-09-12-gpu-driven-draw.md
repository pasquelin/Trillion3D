# GPU-Driven Draw (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-page JavaScript `pass.draw()` loop on `webgpu-page-raster` by compacting visible resident pages into one instanced vertex-pull draw per bin, issued with a single `drawIndirect`, and reject back-facing clusters with the existing `coneRejects` oracle — without changing Format 1 or breaking A/A vs the CPU cut.

**Architecture:** The visbuffer path already vertex-pulls indices from the page cache (`@builtin(vertex_index)`, not an index buffer). A `drawIndexedIndirect` per page would keep the CPU encoder loop the vision docs warn about. Phase 1 therefore (1) puts per-page vis state in the existing `pageTable` storage, (2) instances `vis_vs` on `@builtin(instance_index)` against `concatPos`, (3) GPU-compacts `selected ∩ resident ∩ bin` with a **stable exclusive scan** (order is contractual for A/A), (4) writes one 16-byte non-indexed indirect command per bin, (5) adds conservative normal-cone rejection in `flagNodes` / `selectVisiblePages` using cones computed at prepare-time from source triangles. `selectVisiblePages` remains the A/A oracle and the silent fallback. Node tests still do not execute WGSL: mocks run the CPU kernels.

**Tech Stack:** WebGPU (WGSL compute + render), TypeScript Node 22 `--experimental-strip-types`, Three.js r174 types only, existing `sdk-core` oracles (`coneRejects`, `exclusiveScan`, `compact`).

**Spec:** Conversation audit 2026-09-12 (corrected) + `docs/vision/mathematiques/CALCULS_ESSENTIELS.md` §11–12 + `docs/vision/runtime/RENDU_ET_SELECTION.md` (cone + indirect caveats). Delivered contract remains Format 1 (`docs/FORMAT.md`). Vision symbols are not public API.

## Global Constraints

- Format 1 is unchanged: no cone fields in `clusters.json`, no VGE1, no new page bytes.
- `selectVisiblePages` stays the A/A oracle; GPU kernels must match it bit-for-bit on page IDs (same sort) and on `frustumRejected` / cone-rejected accounting.
- Node tests never execute WGSL. Mocks must call the CPU kernel (`evaluateSelectionKernel`, `evaluateDrawCompact`) the same way `webgpuPages.test.ts` already fakes `resolveSelection`.
- Do not advertise `indirect draw` as supported until `createGpuDraw` succeeds; if it fails, keep the current per-page `pass.draw()` loop and leave `'indirect draw'` in `unsupported`.
- Compaction order is contractual (transparency / A/A). Use exclusive scan, not `atomicAdd`.
- WebGPU `drawIndirect` is **16 bytes** (`vertexCount, instanceCount, firstVertex, firstInstance`). Do not reuse the 20-byte `drawIndexedIndirect` oracle (`oracles.test.ts` « indirect base vertex signed ») for this path.
- `gpuDriven` already means “GPU selection exists”. Do not redefine it. Indirect success is expressed by removing `'indirect draw'` from `unsupported`.
- Double-sided materials and missing/degenerate cones never reject (`angle = π`).
- Hi-Z two-pass intra-frame stays: occluder pass then rest pass, each with its own compact + indirect. Shade stays `draw(3)`.
- Out of scope: temporal Hi-Z, VGE1, DAG \(N\to M\), N-API, PBR IBL/normal maps, `multiDrawIndirect` extension.

---

## File map

| File | Role |
|---|---|
| `packages/sdk-core/oracles.ts` | Add `packDrawIndirect(vertexCount, instanceCount): Uint32Array` (4×u32). Reuse `exclusiveScan` / `compact` / `coneRejects`. |
| `packages/sdk-core/oracles.test.ts` | Tests for the 16-byte packer. |
| `packages/sdk-browser/pageCone.ts` | **New.** Object-space page cone from triangles; conservative merge; perspective `directionSpread`. |
| `packages/sdk-browser/pageCone.test.ts` | **New.** |
| `packages/sdk-browser/pageSelection.ts` | Apply cone in `selectVisiblePages` (same predicate as GPU). |
| `packages/sdk-browser/gpuSelection.ts` | Pack cone into nodes; `flagNodes` + `nodeFlags` call `coneRejects`; A/A kernel. |
| `packages/sdk-browser/gpuDraw.ts` | **New.** Compact shader, CPU `evaluateDrawCompact`, `createGpuDraw`, indirect buffer. |
| `packages/sdk-browser/gpuDraw.test.ts` | **New.** |
| `packages/sdk-browser/visibilityBuffer.ts` | Instanced `vis_vs` / `vis_hiz_vs` reading `pageTable` + `concatPos`. |
| `packages/sdk-browser/webgpuPages.ts` | Wire compact → `drawIndirect` per bin; fallback loop; capabilities. |
| `packages/sdk-browser/webgpuPages.test.ts` | Mock `drawIndirect`; assert draw-call count not summed vertexCount; A/A images unchanged. |
| `packages/sdk-browser/gpuSelection.test.ts` | Cone A/A vs `selectVisiblePages`. |
| `README.md`, `SDK.md`, `packages/README.md` | Honest capabilities: one indirect instanced vis draw per bin; cone when prepared. |

Do not split `webgpuPages.ts` in this plan. New logic lives in `pageCone.ts` and `gpuDraw.ts`.

---

### Task 1: 16-byte drawIndirect packer (oracle)

**Files:**
- Modify: `packages/sdk-core/oracles.ts` (after `compact`)
- Modify: `packages/sdk-core/oracles.test.ts` (after `indirect base vertex signed`)
- Test: `packages/sdk-core/oracles.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `packDrawIndirect(vertexCount: number, instanceCount: number): Uint32Array` length 4, little-endian interpretation `[vertexCount, instanceCount, 0, 0]`. Throws if counts are not unsigned 32-bit integers.

- [ ] **Step 1: Write the failing test**

```ts
test('non-indexed drawIndirect is four u32 words', () => {
  const words = packDrawIndirect(768, 17);
  assert.equal(words.length, 4);
  assert.equal(words[0], 768);
  assert.equal(words[1], 17);
  assert.equal(words[2], 0);
  assert.equal(words[3], 0);
  assert.equal(words.byteLength, 16);
});

test('drawIndirect packer rejects non-integers and negatives', () => {
  assert.throws(() => packDrawIndirect(1.5, 1));
  assert.throws(() => packDrawIndirect(-1, 1));
  assert.throws(() => packDrawIndirect(1, 0xffffffff + 1));
});
```

Import `packDrawIndirect` from `./oracles.ts`. Do not change the existing 20-byte indexed test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/sdk-core/oracles.test.ts`

Expected: FAIL — `packDrawIndirect` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `oracles.ts`:

```ts
/** WebGPU drawIndirect (non-indexed): 16 bytes. Not drawIndexedIndirect. */
export function packDrawIndirect(vertexCount: number, instanceCount: number): Uint32Array {
  const fit = (value: number, name: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`${name} is not a u32`);
    return value;
  };
  return Uint32Array.of(fit(vertexCount, 'vertexCount'), fit(instanceCount, 'instanceCount'), 0, 0);
}
```

Already re-exported via `export * from './oracles.ts'` in `sdk-core/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test packages/sdk-core/oracles.test.ts`

Expected: PASS, including the existing indexed 20-byte test.

- [ ] **Step 5: Commit** (only if the user asked to commit)

```bash
git add packages/sdk-core/oracles.ts packages/sdk-core/oracles.test.ts
git commit -m "feat: pack 16-byte WebGPU drawIndirect arguments"
```

---

### Task 2: Page cones + CPU cut (A/A substrate)

**Files:**
- Create: `packages/sdk-browser/pageCone.ts`
- Create: `packages/sdk-browser/pageCone.test.ts`
- Modify: `packages/sdk-browser/pageSelection.ts` (`PageRec`, `selectVisiblePages`)
- Test: `packages/sdk-browser/pageCone.test.ts` and extend `gpuSelection.test.ts` only after Task 3 if needed. CPU tests live here.

**Interfaces:**
- Consumes: `coneRejects` from `sdk-core`.
- Produces:
  - `export type NormalCone = { axis:[number,number,number]; angle:number }`
  - `export const OPEN_CONE: NormalCone` — `{axis:[0,0,1], angle: Math.PI}` (never rejects).
  - `export function triangleCone(positions: ArrayLike<number>, indices: ArrayLike<number>): NormalCone`
  - `export function mergeCones(left: NormalCone, right: NormalCone): NormalCone`
  - `export function perspectiveSpread(center:[number,number,number], radius:number, cameraWorld:[number,number,number]): number` — `asin(clamp(r/d,0,1))` if `d>r` else `Math.PI`.
  - `export function coneCullsPage(cone: NormalCone, world: THREE.Matrix4, min:number[], max:number[], camera: THREE.PerspectiveCamera): boolean`
  - `PageRec.cone?: NormalCone` optional; missing ⇒ `OPEN_CONE`.
  - `PageRec.doubleSided?: boolean` already derivable from `material`; `selectVisiblePages` must skip cone when `materialSide === DoubleSide`.

**Predicate (must match WGSL later):**

```
view = normalize(cameraPos - worldAabbCenter)
axisWorld = normalize(normalMatrix * cone.axis)
spread = perspectiveSpread(center, aabbRadius, cameraPos)
if doubleSided or cone.angle >= π/2: keep
if coneRejects(dot(axisWorld, view), cone.angle, spread): reject
```

`selectVisiblePages`: after the frustum test, if the node has a page (leaf) or is about to emit `coarsePages`, test the cone attached to **each emitted page**. Internal BVH nodes are not cone-culled as a group (a mixed group can contain front-facing children). Count cone rejects separately? Keep `frustumRejected` as today (frustum only). Do not inflate frustum counts with cone rejects — add `coneRejected` only if tests need it. Prefer **not** adding a new metric in this task; cone-rejected pages simply never enter `shown`. GPU `frustumRejected` stays frustum-only so A/A on that field still holds.

- [ ] **Step 1: Write failing tests in `pageCone.test.ts`**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {OPEN_CONE,triangleCone,mergeCones,perspectiveSpread,coneCullsPage} from './pageCone.ts';
import {coneRejects} from '../sdk-core/index.ts';

test('a single front-facing triangle has a narrow cone along +z', () => {
  const cone = triangleCone([0,0,0, 1,0,0, 0,1,0], [0,1,2]);
  assert.ok(cone.angle < 1e-6);
  assert.ok(cone.axis[2] > 0.9);
});

test('opposite triangles produce an open cone', () => {
  const cone = triangleCone(
    [0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, 1,0,0],
    [0,1,2, 3,4,5],
  );
  assert.ok(cone.angle >= Math.PI / 2 - 1e-6);
});

test('OPEN_CONE never rejects', () => {
  const world = new THREE.Matrix4();
  const cam = new THREE.PerspectiveCamera(55,1,.1,100);
  cam.position.set(0,0,5); cam.lookAt(0,0,0); cam.updateMatrixWorld();
  assert.equal(coneCullsPage(OPEN_CONE, world, [-1,-1,0], [1,1,0], cam), false);
});

test('a +z cone seen from behind the plane is rejected, and perspective spread keeps a grazing bound', () => {
  const cone = {axis:[0,0,1] as [number,number,number], angle: Math.PI/6};
  const world = new THREE.Matrix4();
  const behind = new THREE.PerspectiveCamera(55,1,.1,100);
  behind.position.set(0,0,-5); behind.lookAt(0,0,0); behind.updateMatrixWorld();
  assert.equal(coneCullsPage(cone, world, [-0.1,-0.1,0], [0.1,0.1,0], behind), true);
  const grazing = new THREE.PerspectiveCamera(55,1,.1,100);
  grazing.position.set(0,0,5); grazing.lookAt(0,0,0); grazing.updateMatrixWorld();
  assert.equal(coneCullsPage(cone, world, [-1,-1,0], [1,1,0], grazing), false);
});

test('perspectiveSpread is π when the camera is inside the bound sphere', () => {
  assert.equal(perspectiveSpread([0,0,0], 2, [0,0,0]), Math.PI);
});

test('mergeCones of identical cones is the same cone', () => {
  const a = {axis:[0,0,1] as [number,number,number], angle:0.1};
  const m = mergeCones(a, a);
  assert.ok(Math.abs(m.angle - 0.1) < 1e-6);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test packages/sdk-browser/pageCone.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `pageCone.ts`**

Rules:
- Skip degenerate triangles (`cross` length 0).
- If no valid normal remains → `OPEN_CONE`.
- Axis = normalized sum of unit face normals (area-weighted via `||cross||`).
- `angle = max acos(clamp(dot(n, axis), -1, 1))`.
- `mergeCones`: if either is open → `OPEN_CONE`. Else new axis = normalize(a+b) (if ~0 → open), angle = max of `acos(dot(childAxis, newAxis)) + childAngle`, clamped to π.
- `coneCullsPage` uses world AABB center/radius, `THREE.Matrix3().getNormalMatrix(world)` for the axis, `coneRejects`. Catch oracle throws → do not reject.

- [ ] **Step 4: Wire `selectVisiblePages`**

When emitting a leaf `node.page` or each `coarsePages[id]`:
```
const rec = pages[id];
if (rec && coneCullsPage(rec.cone ?? OPEN_CONE, world, rec.min, rec.max, camera)
    && material is not DoubleSide) skip (do not push).
```
Double-sided: `Array.isArray(rec.material) ? rec.material[0].side : rec.material.side` === `THREE.DoubleSide`.

Do **not** require cones on `PageRec` yet; default open so existing tests stay green.

- [ ] **Step 5: Run existing selection tests**

Run: `node --experimental-strip-types --test packages/sdk-browser/pageCone.test.ts packages/sdk-browser/gpuSelection.test.ts packages/sdk-browser/*.test.ts`

Expected: PASS. Existing A/A cuts have no cones ⇒ identical.

- [ ] **Step 6: Commit** (if requested)

```bash
git add packages/sdk-browser/pageCone.ts packages/sdk-browser/pageCone.test.ts packages/sdk-browser/pageSelection.ts
git commit -m "feat: conservative page normal cones for CPU LOD cuts"
```

---

### Task 3: GPU `flagNodes` cone + pack cones + A/A

**Files:**
- Modify: `packages/sdk-browser/gpuSelection.ts` (`PackedForest`, `packSelectionForest`, `SELECTION_SHADER`, `nodeFlags`, `evaluateSelectionKernel`, `interleaveNodes`)
- Modify: `packages/sdk-browser/gpuSelection.test.ts`
- Modify: `packages/sdk-browser/webgpuPages.ts` (attach `rec.cone` during `collectClusterPages` consumption / `prepare`)

**Interfaces:**
- Consumes: `NormalCone`, `OPEN_CONE`, `coneCullsPage`, `perspectiveSpread` from `pageCone.ts`; `coneRejects`.
- Produces: `PackedForest.cones: Float32Array` — 4 floats per node `[axis.x, axis.y, axis.z, angle]`. Leaves copy `page.cone ?? OPEN_CONE`. Internal nodes: `OPEN_CONE` (page-level cull only, matching Task 2).
- `packSelectionForest` extra generic constraint: pages may carry `cone?: NormalCone` and `material`.
- Shader `Node` gains `coneAxis: vec3f, coneAngle: f32` (use the existing `pad0` + one extra float by expanding the node from 64 to 80 bytes **or** a parallel `cones` storage buffer).

**Preferred layout (less risk):** keep 64-byte nodes. Add binding 7: `var<storage, read> cones: array<vec4f>` aligned with node index. No stride change, existing `interleaveNodes` tests (`pack stores one world matrix per root`) stay valid.

`flagNodes` after frustum, before `lodOk`:

```wgsl
fn coneCulled(node:Node)->bool{
 if(node.page==0xffffffffu){return false;}
 let cone=cones[/* node index via id.x */];
 if(cone.w>=1.57079632679){return false;} // π/2
 let box=worldAabb(node);
 let center=0.5*(box.min+box.max);
 let cam=/* camera world position: decode from inverse of uni.view column */;
 let toCam=cam-center;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=normalize(cone.xyz); // object space; transform by world like normals
 // world normal matrix from worlds[node.worldIndex] 3x3 inverse-transpose
 let e=0.5*(box.max-box.min);
 let radius=length(e);
 var spread=0.0;
 if(dist<=radius){return false;}
 spread=asin(clamp(radius/dist,0.0,1.0));
 let d=dot(axisWorld, view);
 return d < -sin(cone.w+spread) && (cone.w+spread) < 1.57079632679;
}
```

Camera world position: extract from `uni.view` (view = worldInverse). `cam = (inverse(view))[3].xyz` or use the already-uploaded view to transform the AABB center into view space and take `-viewZ` direction: **object-to-camera in world = cameraPos - center**. Add `cameraWorld: vec3f` to `Uniforms` (fits in the existing 256-byte uniform: currently planes 96 + view 64 + pixelScale 8 + pixelError 4 + near 4 + 4×u32 = 192, 64 bytes free). Pack `cameraWorld` at offset 48 of the float block (`target[48..50]`).

CPU `nodeFlags` must use the same numbers via `coneCullsPage`.

Double-sided leaves: pack `OPEN_CONE` even if a geometric cone exists.

- [ ] **Step 1: Failing A/A test**

In `gpuSelection.test.ts`:

```ts
test('compute kernel cone-rejects a back-facing leaf the CPU also rejects', () => {
  const pages = recs([{id:0,url:'front',count:3}]);
  (pages[0] as Rec & {cone: {axis:[number,number,number]; angle:number}}).cone = {axis:[0,0,1], angle: Math.PI/6};
  const tree: Tree = {min:[-0.1,-0.1,0],max:[0.1,0.1,0],page:0};
  const behind = cameraAt(0,0,-5,0,0,0);
  assertSameCut(forest(pages as Rec[], tree), behind, 0);
  const gpu = gpuCut(forest(pages as Rec[], tree), behind, 0);
  assert.equal(gpu.pageIds.length, 0);
});
```

Extend `Rec` in the test file with optional `cone`. Extend `packSelectionForest` / `selectVisiblePages` pages type. `assertSameCut` already compares CPU `selectVisiblePages` vs `evaluateSelectionKernel`.

- [ ] **Step 2: Run to verify fail**

Run: `node --experimental-strip-types --test packages/sdk-browser/gpuSelection.test.ts`

Expected: FAIL — GPU still emits the page.

- [ ] **Step 3: Implement packing + CPU `nodeFlags` + WGSL `coneCulled` + `evaluateSelectionKernel`**

Update `writeUniforms` to store `camera.position` — `SelectionUniforms` needs `cameraWorld: [number, number, number]`. Add it in `cameraSelectionUniforms` from `camera.getWorldPosition`. Update `sameSelectionUniforms` to compare it.

Update `createGpuSelection` bind group with cones buffer. Mock in `gpuSelection.test.ts` `mockSelectionDevice` must accept the extra binding (entry count 8).

- [ ] **Step 4: Attach cones in `webgpuPages.ts` during page collection**

After `collectClusterPages`, for each `PageRec` with `array` and `attributes.position`:

```ts
rec.cone = visMaterial(rec.material).doubleSided
  ? OPEN_CONE
  : triangleCone(rec.attributes.position.array, rec.array);
```

`packSelectionForest(roots)` is already called at backend construction — cones must be filled **before** `packSelectionForest`. Move `packSelectionForest` to after this loop, or pack in `prepare()` before `createGpuSelection`. Today it runs at factory time (line ~107). Move packing to `prepare()` so position arrays are available. Keep a module-level `packedForest` assigned in `prepare`.

- [ ] **Step 5: Run selection + webgpu page tests**

Run: `node --experimental-strip-types --test packages/sdk-browser/gpuSelection.test.ts packages/sdk-browser/webgpuPages.test.ts`

Expected: PASS. Quad tests are +z facing, camera at +z ⇒ no cone reject.

- [ ] **Step 6: Commit** (if requested)

```bash
git add packages/sdk-browser/gpuSelection.ts packages/sdk-browser/gpuSelection.test.ts packages/sdk-browser/webgpuPages.ts packages/sdk-browser/pageSelection.ts
git commit -m "feat: GPU and CPU LOD cuts share conservative backface cones"
```

---

### Task 4: Instanced vis vertex shader (no CPU draw loop substrate)

**Files:**
- Modify: `packages/sdk-browser/visibilityBuffer.ts` (`VIS_SHADER`)
- Modify: `packages/sdk-browser/visibilityBuffer.test.ts` (string contracts)
- Test: `packages/sdk-browser/visibilityBuffer.test.ts`

**Interfaces:**
- Consumes: `PAGE_INFO_STRIDE` / `PageInfo` already used by `SHADE_SHADER` (`world, baseColor, metalness, roughness, mapIndex, flags, pageOffset, indexCount, vertexBase, packedBase, uvScale, clusterHash`).
- Produces: `vis_vs` / `vis_hiz_vs` indexed by `instance_index` into `pages: array<PageInfo>`, positions from `positions[vertexBase + index]`, clip if `vertexIndex >= page.indexCount` **or** (hiz) `hizFlags[page.hizSlot] != 0`.
- Add `hizSlot: u32` to `PageInfo` (there is `pad1` at the end). Use `pad1` as `hizSlot`. CPU writer in `webgpuPages.ts` already writes 32 floats / 128 bytes; set `pageInts[base+31] = hizSlot` (`0xffffffff` when not rest).

New vis bindings (single layout for both vis passes):

```
0 indices  (cache.buffer)
1 positions (concatPos)        // was per-geometry position buffer
2 pages    (pageTable)         // storage, same as shade
3 hizFlags (gpuHiz.flags or a 4-byte zero buffer)
```

Uniforms for vis become a small global `viewProj` only (or keep reading `uni.viewProj` from a 256-byte uniform without dynamic offset). Drop per-draw dynamic offset.

CPU `rasterVisibilityIds` oracle is unchanged (still the image A/A). This task only changes WGSL strings + tests that the shader contains `instance_index` and `pages[`.

- [ ] **Step 1: Failing shader-contract tests**

```ts
test('vis shader instances pages from the page table', () => {
  assert.match(VIS_SHADER, /@builtin\(instance_index\)/);
  assert.match(VIS_SHADER, /pages\s*:\s*array<PageInfo>/);
  assert.match(VIS_SHADER, /vertexIndex\s*>=\s*page\.indexCount/);
  assert.doesNotMatch(VIS_SHADER, /uni\.pageOffset/);
});
```

Add to `visibilityBuffer.test.ts` (create the test file if missing; grep first). If no vis shader tests exist, create `packages/sdk-browser/visibilityBuffer.test.ts` with the snippet above plus keep existing tests in that file.

- [ ] **Step 2: Run to verify fail**

Expected: FAIL — current `vis_vs` uses `uni.pageOffset`.

- [ ] **Step 3: Rewrite `VIS_SHADER`**

Keep `vis_hiz_fs` / `vis_fs` outputs identical (`id = packedBase | (tri & 0xffff)`).

```wgsl
@vertex fn vis_vs(@builtin(vertex_index) vertexIndex:u32, @builtin(instance_index) instanceIndex:u32)->VSOut{
 var out:VSOut;
 let page=pages[instanceIndex];
 if(vertexIndex>=page.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.id=0u;return out;}
 let id=indices[page.pageOffset+vertexIndex];
 let p=vertPos(page.vertexBase,id);
 let world=page.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;
 out.id=page.packedBase|((vertexIndex/3u)&0xffffu);
 return out;
}
```

`vis_hiz_vs`: same, plus `if(page.hizSlot!=0xffffffffu && hizFlags[page.hizSlot]!=0u){ clip }`.

Share `vertPos` with shade (duplicate 3 lines; do not merge shader strings in this task).

- [ ] **Step 4: Run visbuffer tests**

Run: `node --experimental-strip-types --test packages/sdk-browser/visibilityBuffer.test.ts`

Expected: PASS. CPU oracles (`rasterVisibilityIds`, `shadeVisibility`) untouched.

- [ ] **Step 5: Commit** (if requested)

```bash
git add packages/sdk-browser/visibilityBuffer.ts packages/sdk-browser/visibilityBuffer.test.ts
git commit -m "feat: instance visbuffer vertices from the page table"
```

Note: `webgpuPages.ts` will not compile against the new shader until Task 6. Land Task 4 and Task 6 in the same execution wave if the TypeScript compile of pipelines happens at `prepare()` (string only — `webgpuPages.ts` still compiles). WGSL is a string: **the repo still typechecks**. Runtime `prepare()` would fail until Task 6 updates bind groups. Do not run a browser in Task 4. Unit tests only.

---

### Task 5: GPU compact kernel (stable) + `createGpuDraw`

**Files:**
- Create: `packages/sdk-browser/gpuDraw.ts`
- Create: `packages/sdk-browser/gpuDraw.test.ts`

**Interfaces:**
- Consumes: `packDrawIndirect`, `exclusiveScan`, `compact` from `sdk-core`.
- Produces:

```ts
export const DRAW_INDIRECT_STRIDE = 16;
export const BIN_BACK = 0, BIN_NONE = 1, BIN_FRONT = 2;
export type DrawItem = { pageIndex: number; bin: 0|1|2; rest: 0|1 };
export type CompactResult = {
  instances: Uint32Array;      // compacted pageIndex in input order
  bins: Uint32Array;           // compacted bin
  rests: Uint32Array;          // compacted rest flag
  counts: [number, number, number, number, number, number]; // (bin + 3*rest)
  indirect: Uint32Array;       // 6 * 4 u32, one drawIndirect per (bin, rest)
  overflow: boolean;
};
export function evaluateDrawCompact(
  items: DrawItem[],
  maxVertexCount: number,
  slotCap: number,
): CompactResult;

export type GpuDraw = {
  encode(encoder: GPUCommandEncoder, items: DrawItem[], maxVertexCount: number): void;
  indirectBuffer: GPUBuffer;   // 6 * 16 bytes
  instanceBuffer: GPUBuffer;   // slotCap u32 page indices, ordered
  peek(): CompactResult | null;
  dispose(): void;
};
export async function createGpuDraw(device: GPUDevice, slotCap: number): Promise<GpuDraw | undefined>;
```

**Bin mapping:** `bin = DoubleSide → 1, BackSide → 2, else 0`. `rest = 1` only for Hi-Z second pass items.

**Six indirect slots** at `16 * (rest * 3 + bin)`:
`vertexCount = maxVertexCount`, `instanceCount = count[slot]`, `firstVertex = 0`, `firstInstance = start[slot]` where `start = exclusiveScan(counts)`.

Instance buffer layout: concatenated 6 regions in bin-major order, stable within each region (input order preserved — `compact` oracle).

**WGSL:** one-thread `compactDraws` like `resolveSelection` (page counts ≪ 10⁵; order trivial). Input: `items: array<DrawItem>` + `count` uniform. Output: instance ids + 6 indirect commands. Overflow if `items.length > slotCap`.

CPU `evaluateDrawCompact` is what the mock `dispatchWorkgroups` runs (copy the `webgpuPages.test.ts` pattern).

- [ ] **Step 1: Failing tests**

```ts
test('compact keeps input order inside each bin and writes 16-byte indirects', () => {
  const items = [
    {pageIndex:4, bin:0 as const, rest:0 as const},
    {pageIndex:1, bin:1 as const, rest:0 as const},
    {pageIndex:7, bin:0 as const, rest:0 as const},
  ];
  const result = evaluateDrawCompact(items, 768, 8);
  assert.equal(result.overflow, false);
  assert.deepEqual([...result.instances.subarray(0,3)], [4,7,1]);
  const back = result.indirect.subarray(0, 4);
  assert.deepEqual([...back], [...packDrawIndirect(768, 2)]);
  const none = result.indirect.subarray(4, 8);
  assert.deepEqual([...none], [...packDrawIndirect(768, 1)]);
});

test('compact overflow sets the flag and writes zero instance counts', () => {
  const items = [{pageIndex:0, bin:0 as const, rest:0 as const}];
  const result = evaluateDrawCompact(items, 768, 0);
  assert.equal(result.overflow, true);
  assert.equal(result.indirect[1], 0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --experimental-strip-types --test packages/sdk-browser/gpuDraw.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `evaluateDrawCompact` first (CPU oracle), then WGSL string `DRAW_SHADER`, then `createGpuDraw`**

`createGpuDraw` mirrors `createGpuSelection`: `pushErrorScope`, `getCompilationInfo`, return `undefined` on failure, `INDIRECT | STORAGE | COPY_DST | COPY_SRC` on the indirect buffer.

`encode`: `queue.writeBuffer` the items (CPU still knows `drawn` for pins — that is required for residency). Dispatch 1 thread. Do **not** read back for drawing.

Item upload is O(drawn) bytes (8–12 bytes each), not O(drawn) encoder calls.

- [ ] **Step 4: Run gpuDraw tests**

Run: `node --experimental-strip-types --test packages/sdk-browser/gpuDraw.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit** (if requested)

```bash
git add packages/sdk-browser/gpuDraw.ts packages/sdk-browser/gpuDraw.test.ts
git commit -m "feat: stable GPU compaction into six drawIndirect commands"
```

---

### Task 6: Wire `encodeVis` / `encodeDraws` to `drawIndirect`

**Files:**
- Modify: `packages/sdk-browser/webgpuPages.ts`
- Modify: `packages/sdk-browser/webgpuPages.test.ts` (`mockGpu` must implement `drawIndirect`)

**Interfaces:**
- Consumes: `createGpuDraw`, `evaluateDrawCompact`, `DrawItem`, `BIN_*` from `gpuDraw.ts`; instanced `VIS_SHADER` from Task 4.
- Produces: vis encode uses **at most 6** `drawIndirect` (3 cull × 2 passes) + 1 shade `draw(3)`. Untextured fallback uses the same instance path if `concatPos` exists; otherwise keep the old loop (no concatPos ⇒ no instancing).

**`encodeVis` replacement (logic):**

1. Build `packed` as today (resident ∩ drawn, has index + concat block).
2. `splitOccluders` as today → `twoPass`.
3. Write `pageTable` as today, plus `hizSlot` for rest items (`0..restCount-1`) else `0xffffffff`.
4. Build `DrawItem[]`:
   - occluder items: `rest=0`, `pageIndex=i` in `packed`
   - rest items: `rest=1`
   - `bin` from `materialSide`
5. If `gpuDraw`: `gpuDraw.encode(encoder, items, maxIndexCount)` then for each of 6 slots with `counts[s]>0` (CPU `evaluateDrawCompact` on the same items — CPU may use counts for metrics; **drawing** uses `pass.drawIndirect(gpuDraw.indirectBuffer, s*16)`). Metrics `submittedTriangles` = sum of packed index lengths / 3 as today (not `maxVertexCount * instances`).
6. If `!gpuDraw` or overflow: existing per-page `pass.draw` loop (do not drop vis).
7. Bind groups: one vis group `{cache, concatPos, pageTable, zeroFlags}` and one rest group `{…, gpuHiz.flags}`. Pipelines: still 3 cull modes × {occluder, rest} = 6 pipelines, but **one drawIndirect each**, not one draw per page.
8. `pass.setBindGroup(0, group)` once per bin; `pass.drawIndirect(buffer, offset)`.

**Mock changes** in `webgpuPages.test.ts`:

```ts
drawIndirect(buffer:{data?:Uint8Array}, offset:number){
  const words=new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset+offset, 4);
  draws.push({vertexCount:words[0], instanceCount:words[1], indirect:true});
}
```

Update the test that currently does:

```ts
assert.equal(draws.reduce((n,d)=>n+d.vertexCount,0),9);
```

This **must** change. Today: vis `draw(3)+draw(3)` + shade `draw(3)` = 9. After: vis `drawIndirect(max, 2)` + shade `draw(3)`. Replace with:

```ts
const vis = draws.filter(d => d.indirect);
const shade = draws.filter(d => !d.indirect);
assert.equal(shade.reduce((n,d)=>n+d.vertexCount,0), 3);
assert.ok(vis.length >= 1 && vis.length <= 6);
assert.equal(vis.reduce((n,d)=>n+(d.instanceCount??0),0), 2);
```

Keep the image A/A test (`webgpu page raster matches the WebGL2 exact-pages triangles`) — `maxChannelError === 0` still required. Cone should not fire on the +z quad.

Mock compute for compact: when `entryPoint==='compactDraws'`, run `evaluateDrawCompact` into the indirect + instance buffers (same pattern as `resolveSelection`).

- [ ] **Step 1: Update mock + change the vertexCount===9 assertion to the failing new contract**

Run `webgpuPages.test.ts` — FAIL on missing `drawIndirect` or still seeing per-page draws.

- [ ] **Step 2: Implement wiring in `webgpuPages.ts`**

- `gpuDraw = await createGpuDraw(gpuDevice, slots)` in `prepare()`.
- On failure: leave `'indirect draw'` in `unsupported`, keep loop.
- On success: `capabilities.unsupported = capabilities.unsupported.filter(i => i !== 'indirect draw')`.
- `maxIndexCount = Math.max(1, ...allPages.map(p => p.index.length or p.array.length))`.
- Destroy `gpuDraw` in `dispose` / `dropVis`.

Untextured `encodeDraws` (no vis): if `gpuDraw` and `concatPos`, same instancing with the **untextured** VS rewritten similarly **or** keep the loop for that rare fallback. Prefer keeping the untextured per-page loop (it is the failure path). Do not spend this task rewriting `SHADER` (the beauty untextured VS). Only the vis path is GPU-driven.

- [ ] **Step 3: Run browser tests**

Run: `node --experimental-strip-types --test packages/sdk-browser/*.test.ts`

Expected: PASS, including Hi-Z two-pass tests (`passes` loadOp sequence unchanged: vis `clear` then `load` then shade `clear`).

- [ ] **Step 4: Run the full JS suite**

Run: `npm test`

Expected: 213 + new tests, 0 fail.

- [ ] **Step 5: Commit** (if requested)

```bash
git add packages/sdk-browser/webgpuPages.ts packages/sdk-browser/webgpuPages.test.ts
git commit -m "feat: issue one drawIndirect per vis bin instead of per page"
```

---

### Task 7: Capabilities copy + docs honesty

**Files:**
- Modify: `README.md` (Current capabilities / Current limits)
- Modify: `SDK.md` (webgpu-page-raster paragraph)
- Modify: `packages/README.md` (the long `webgpuPagesBackend` paragraph)
- Modify: `packages/sdk-browser/webgpuPages.test.ts` — assert `'indirect draw'` is **not** in `unsupported` after a successful prepare with mocked compute+indirect; assert it **is** present when `createGpuDraw` cannot be created (device without `INDIRECT` usage still works in mock — simulate by making `createComputePipeline` throw on `compactDraws` only).

**Copy to write (English, matches existing docs):**

> GPU frustum + `lodScore` selection plus conservative backface cones (prepare-time page cones, `coneRejects` with perspective spread). Visbuffer encode instances resident pages from the page table and issues at most six non-indexed `drawIndirect` commands (cull mode × this-frame Hi-Z pass). `selectVisiblePages` remains the A/A oracle and the silent fallback. Compaction is a stable exclusive scan; overflow or a missing compact pipeline restores the per-page `draw()` loop and keeps `'indirect draw'` in `unsupported`. This is not `multiDrawIndexedIndirect`, not temporal Hi-Z, and not MeshStandardMaterial pixel-perfect.

- [ ] **Step 1: Write the capability test first**

```ts
test('a successful vis+compact pipeline drops indirect draw from unsupported', async () => {
  // mockGpu with packed forest + enableHiz + compactDraws evaluator
  assert.equal(backend.capabilities.unsupported.includes('indirect draw'), false);
  assert.equal(backend.capabilities.gpuDriven, true);
});

test('a compact pipeline failure keeps the per-page draw loop', async () => {
  assert.equal(backend.capabilities.unsupported.includes('indirect draw'), true);
});
```

- [ ] **Step 2: Update the three docs paragraphs; do not mention VGE1 or N-API**

- [ ] **Step 3: `npm test` and `python3 docs/check-links.py`**

Expected: PASS.

- [ ] **Step 4: Commit** (if requested)

```bash
git add README.md SDK.md packages/README.md packages/sdk-browser/webgpuPages.test.ts
git commit -m "docs: describe instanced drawIndirect vis encode without overclaiming"
```

---

## Self-review

**Spec coverage**
- Compaction GPU → Task 5 (`evaluateDrawCompact` + `compactDraws`).
- Indirect emit, one call per bin, not per page → Task 6. Instanced substrate → Task 4.
- Backface cone in `flagNodes` + CPU oracle → Tasks 2–3.
- A/A vs `selectVisiblePages` / `evaluateSelectionKernel` / image compare → Tasks 3 and 6.
- Honest capabilities → Task 7.
- 16-byte vs 20-byte trap → Task 1.

**Placeholders:** none. Overflow, double-sided, missing cone, compact failure, untextured fallback are explicit.

**Type consistency:** `DrawItem.pageIndex` is the index into that frame's `packed` array (not the selection forest page id). `PackedForest.cones` is per hierarchy **node**, while `PageRec.cone` is per page. Indirect slot `rest*3+bin`. `hizSlot` is `pad1` of `PageInfo`. `SelectionUniforms.cameraWorld` added in Task 3.

**Risks to not “fix” in this plan**
- CPU still uploads `drawn` items (residency is host-side). That is required; Phase 1 does not GPU-stream pages.
- `maxVertexCount * instanceCount` overdraws clipped vertices. Pages are ≤768 indices; measure later, do not bin-by-size here (YAGNI).
- Untextured fallback keeps the JS loop on purpose.

---

## Execution notes

`webgpuPages.ts` `prepare()` currently packs the forest at factory time. Task 3 moves `packSelectionForest` to `prepare()` after cones are filled. Do that before creating `gpuSelection`.

`npm test` does not run WGSL. A physical WebGPU campaign is **not** a gate of this plan (product principle: no invented speedup). After Task 6, a host with WebGPU can confirm `metrics().drawCalls` drops from `O(pages)` to `≤7` (6 vis + 1 shade). Add `drawCalls` on the WebGPU backend metrics if it is currently missing or always 0 — optional, only if `FrameMetrics.drawCalls` is already populated by the explorer from backend metrics. If the backend does not report it, do not invent a GPU timestamp.

Do not open Phase 2 (DAG / VGE1) in the same PR wave.

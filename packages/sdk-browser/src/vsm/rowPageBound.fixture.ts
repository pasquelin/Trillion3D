// Rows of world spheres for the chunks' position bound, and the brute force of the pairs and
// commands each row can make: the shipped cull (`vsmRenderCullWgsl`, run by `shaderRun`) on the
// projection data's clip matrix — the orthographic box, the screen rect — then the pages of the rect;
// for a local light's maps, its range first, the perspective box, and every mip's rect.
import {
  ceilFloat32,
  writeSplitDouble,
} from '../../../sdk-core/src/math/primitives/splitDouble.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { CLUSTER_SPHERE_FLOATS as STRIDE } from '../gpu/shadow/sphereContract.ts';
import { Mat, shaderRun } from '../texture/shaderRun.fixture.ts';
import { vector } from '../texture/shaderRunBuiltins.fixture.ts';
import { VsmCacheManager } from './cacheManager.ts';
import { frame, LEVELS, PROJECTION, VIEW } from './clipmap.fixture.ts';
import { VSM_LOG2_PAGE, VSM_MIPS, VSM_LEVEL0_TEXELS } from './constants.ts';
import { addVsmLocalLightShadow, vsmLocalViewData, type VsmLocalLightInput } from './localLight.ts';
import { vsmRenderCullWgsl } from './renderCullWgsl.ts';
import { createVsmResources } from './resources.ts';
import type { VsmRenderScene } from './renderPass.ts';
import type { VsmBoundLight, VsmRowSpheres, VsmWorst } from './rowPageBound.ts';

import { seeded } from './planFrames.fixture.ts';

export { seeded };
export const PAGES = 2048;
/** The raster's worst case at `PAGES` pages under a sun, its lists of `cap` entries. */
export const worstOf = (cap = 1 << 21): VsmWorst => ({
  rows: Math.floor(cap / PAGES),
  cmdsPerRow: LEVELS,
  pages: PAGES,
  cap,
});

/** No rows' spheres: no row has one, the bound cannot speak. */
export const emptyRowSpheres = (): VsmRowSpheres => ({
  packed: new Float32Array(0),
  written: { epoch: 0, runs: [] },
});

/** `n` rows: centre `at(i)` (world metres, double), radius `radius(i)`, packed as the engine's. */
export function sphereRows(
  n: number,
  at: (i: number) => number[],
  radius: (i: number) => number,
): VsmRowSpheres {
  const packed = new Float32Array(n * STRIDE);
  for (let i = 0; i < n; i++) writeRow(packed, i, at(i), radius(i));
  return { packed, written: { epoch: 0, runs: [] } };
}
/** `n` rows within `spread` metres of `centre`, radii log-uniform in [rMin, rMax]. */
export function scene(
  n: number,
  centre: number[],
  spread: number,
  rMin: number,
  rMax: number,
  seed = 1,
) {
  const rand = seeded(seed);
  return sphereRows(
    n,
    () => centre.map((c) => c + (rand() * 2 - 1) * spread),
    () => rMin * (rMax / rMin) ** rand(),
  );
}
export function writeRow(packed: Float32Array, i: number, c: number[], r: number) {
  for (let a = 0; a < 3; a++) writeSplitDouble(packed, i * STRIDE + a, i * STRIDE + 4 + a, c[a]);
  packed[i * STRIDE + 3] = ceilFloat32(r);
}

/** A sun's clipmap around `eye`, as the frame's light (`VsmBoundLight`). */
export function sunAt(eye: number[], cache = new VsmCacheManager()) {
  const clipmap = frame(cache, eye);
  const light: VsmBoundLight = {
    kind: 'directional',
    firstId: 0,
    count: LEVELS,
    shouldRender: true,
    clipmap,
  };
  return { cache, clipmap, light };
}

/** A spot or point light's full maps (`addVsmLocalLightShadow`), as the frame's light. */
export function localAt(input: Omit<VsmLocalLightInput, 'id'>, cache = new VsmCacheManager()) {
  const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] };
  const view = vsmLocalViewData(camera, { width: 1024, height: 1024 });
  const { cacheEntry } = addVsmLocalLightShadow(cache, { id: 'lamp', ...input }, [view], 0);
  const light: VsmBoundLight = {
    kind: input.kind,
    firstId: 0,
    count: cacheEntry.mapCaches.length,
    shouldRender: true,
    singlePage: false,
    entry: cacheEntry,
  };
  return { cache, light };
}

type Cull = { clipLow: number[]; clipHigh: number[]; inMapView: boolean };
const res = createVsmResources(
  fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } }).device,
  { fullMapCapacity: 63 },
);
const cull = shaderRun<{
  vsmShiftedBoxOrtho: (c: number[], e: number[], m: Mat, near: boolean) => Cull;
  vsmShiftedBoxPerspective: (c: number[], e: number[], m: Mat, viewToClip: Mat) => Cull;
  vsmRectPixels: (view: number[], cull: Cull) => number[];
}>(
  // The perspective box's corner list, `array<vec4f,8>(…)`, as a JavaScript array.
  vsmRenderCullWgsl(res.layout).replace(/array<\s*\w+\s*,\s*\d+\s*>\(/g, 'arrayOf('),
  [
    ...['vsmShiftedBoxOrtho', 'vsmShiftedBoxPerspective', 'vsmRectPixels'],
    // The cull of the box in clip space they hand it to (`boxCullWgsl.ts`).
    ...['vsmBoxInOrthoView', 'vsmBoxInPerspectiveView'],
  ],
  { vec4i: vector(4, (x) => Math.trunc(Number(x))), arrayOf: (...v: unknown[]) => v },
);
const SIZE = VSM_LEVEL0_TEXELS;
/** vsmShiftedToClip: each column (x, y, z, w) of the UV matrix → (2x − w, w − 2y, z, w). */
const clipOf = (uv: Float64Array) =>
  new Mat(
    [0, 1, 2, 3].flatMap((k) => {
      const [x, y, z, w] = uv.slice(k * 4, k * 4 + 4);
      return [2 * x - w, w - 2 * y, z, w];
    }),
  );
/** Pages of a pixel rect, 0 when empty. */
const pagesRect = ([x0, y0, x1, y1]: number[]) =>
  x1 < x0 || y1 < y0
    ? 0
    : ((x1 >> VSM_LOG2_PAGE) - (x0 >> VSM_LOG2_PAGE) + 1) *
      ((y1 >> VSM_LOG2_PAGE) - (y0 >> VSM_LOG2_PAGE) + 1);

/** Per row, the pairs (pages of every level's rect, at most `pages`) and the commands (levels
 *  whose rect is not empty) the shipped cull gives it — every page valid, nothing cached. */
export function bruteForce(rows: VsmRowSpheres, light: VsmBoundLight, pages: number) {
  const n = rows.packed.length / STRIDE,
    p = rows.packed;
  const pairs = new Float64Array(n),
    cmds = new Float64Array(n);
  for (const entry of light.clipmap!.cacheEntry.mapCaches.slice(0, light.count)) {
    const pd = entry.projectionData;
    const m = clipOf(pd.shiftedToMapUv);
    for (let i = 0; i < n; i++) {
      const b = i * STRIDE,
        r = p[b + 3];
      const c = [0, 1, 2].map((a) => p[b + a] + p[b + 4 + a] + pd.originShift[a]);
      const box = cull.vsmShiftedBoxOrtho(c, [r, r, r], m, false);
      if (!box.inMapView) continue;
      const count = pagesRect(cull.vsmRectPixels([0, 0, SIZE, SIZE], box));
      if (count === 0) continue;
      pairs[i] += count;
      cmds[i]++;
    }
  }
  for (let i = 0; i < n; i++) pairs[i] = Math.min(pairs[i], pages);
  return { pairs, cmds };
}

/** The same under a local light's maps (`localAt`): range, the perspective
 *  box, then a command and the rect's pages per mip whose rect is not empty. Pairs not capped. */
export function bruteForceLocal(rows: VsmRowSpheres, light: VsmBoundLight) {
  const n = rows.packed.length / STRIDE,
    p = rows.packed;
  const pairs = new Float64Array(n),
    cmds = new Float64Array(n);
  for (const entry of light.entry!.mapCaches.slice(0, light.count)) {
    const pd = entry.projectionData;
    const m = clipOf(pd.shiftedToMapUv),
      viewToClip = new Mat([...pd.lightViewToClip]);
    for (let i = 0; i < n; i++) {
      const b = i * STRIDE,
        r = p[b + 3];
      const c = [0, 1, 2].map((a) => p[b + a] + p[b + 4 + a] + pd.originShift[a]);
      if (Math.hypot(c[0], c[1], c[2]) > pd.lightRange + r) continue;
      const box = cull.vsmShiftedBoxPerspective(c, [r, r, r], m, viewToClip);
      if (!box.inMapView) continue;
      for (let mip = 0; mip < VSM_MIPS; mip++) {
        const size = SIZE >> mip;
        const count = pagesRect(cull.vsmRectPixels([0, 0, size, size], box));
        pairs[i] += count;
        if (count) cmds[i]++;
      }
    }
  }
  return { pairs, cmds };
}

/** Sums of the k largest of `v`, for every k (index k). */
export function topSums(v: Float64Array) {
  const sorted = Float64Array.from(v).sort().reverse();
  const out = new Float64Array(v.length + 1);
  for (let k = 0; k < v.length; k++) out[k + 1] = out[k] + sorted[k];
  return out;
}

/** What a raster pass of `rowCount` rows under one sun is encoded with, on a recording device: an
 *  encoder that records nothing, the scene on one tiny buffer, and the sun. */
export function recordingRaster(device: GPUDevice, rowCount: number) {
  const pass = {
    ...{ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {} },
    ...{ dispatchWorkgroupsIndirect() {}, drawIndirect() {}, end() {} },
  };
  const encoder = {
    beginComputePass: () => pass,
    beginRenderPass: () => pass,
    clearBuffer() {},
    copyBufferToBuffer() {},
  } as unknown as GPUCommandEncoder;
  const buffer = device.createBuffer({ size: 16, usage: 0 });
  const scene: VsmRenderScene = {
    rowCount,
    ...{ pageTable: buffer, spheres: buffer, mobility: buffer, rowLods: buffer },
    pageLayout: {} as GPUBindGroupLayout,
    pageGroup: {} as GPUBindGroup,
    rowSpheres: emptyRowSpheres(),
    camera: {
      ...{ eye: [0, 0, 0], view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      ...{ focalPixels: 100, near: 0.1, perspective: true, threshold: 1 },
    },
  };
  const lights = [{ kind: 'directional' as const, firstId: 0, count: 1, shouldRender: true }];
  return { encoder, scene, lights };
}

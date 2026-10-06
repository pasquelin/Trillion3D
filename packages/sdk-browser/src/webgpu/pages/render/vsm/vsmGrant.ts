// The virtual shadow maps' set, made within the room the GPU budget leaves it: a smaller physical
// page pool — coarser shadows — when memory is short, no shadow when not even its eighth fits, and
// never an allocation the budget refuses, which would stop every later frame (`deviceLedger.ts`).
import type { WebgpuPagesRuntime } from '../../runtime.ts';
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts';
import { VSM_PRESSURE_CALM_FRAMES, VSM_POOL_PAGES } from '../../../../vsm/constants.ts';
import {
  vsmTransmissionContextBytes,
  vsmTransmissionFloorBytes,
} from '../../../../vsm/transmissionPass.ts';
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts';
import { VSM_PM_CONTEXT_BYTES } from '../../../../vsm/pageManagementPass.ts';
import { vsmProjectionBytesToMake, vsmProjectionReserve } from '../../../../vsm/projectionPass.ts';
import { VSM_INVALIDATION_PARAMS_BYTES } from '../../../../vsm/invalidationWgsl.ts';
import { outOfMemoryContext } from '../../../../residency/outOfMemory.ts';
import { noteShadowPressure } from '../../../shadow/memoryGrant.ts';
import {
  castingCount,
  createEngineVsm,
  destroyEngineVsm,
  directionalCount,
  ENGINE_VSM_SIDE_BYTES,
  engineVsmBytes,
  engineVsmOptions,
  ensureMask,
  fullMapsFor,
  growEngineVsmTables,
  maskBytes,
  maskGrowth,
  maskLayersFor,
  renderViewBound,
  type EngineVsm,
} from './engineVsm.ts';
import { vsmRenderContextBytes, vsmRenderFloorBytes } from '../../../../vsm/renderPass.ts';
import {
  vsmLayout,
  vsmPoolWithin,
  vsmResourceBytes,
  vsmTableBytes,
  type VsmLayout,
} from '../../../../vsm/layout.ts';
import { vsmTransmissionBytes } from '../../../../vsm/transmissionLayout.ts';

/** What every reason this module gives the lights for reading no shadow starts with. */
const UNAVAILABLE = 'virtual shadow maps';

/** A set refused for the frame's lights: the room it waits for, the maps those lights want, and
 *  the set asked for them — an overflow regrow's, never asked again as the set that overflowed. */
export type VsmRefusal = {
  retryAt: number;
  wanted: number;
  directional: number;
  fullMapCapacity: number;
  poolPages: number;
};

/** What the replaced set held of what a frame grows: its raster lists, and its coloured atlas with
 *  its draw context — measured before it is freed (`heldBeside`). */
type HeldBeside = { lists: number; transmission: number };

const heldBeside = (vsm: EngineVsm | undefined): HeldBeside => ({
  lists: vsm ? vsmRenderContextBytes(vsm.res) : 0,
  transmission: vsm?.transmission
    ? vsm.transmission.bytes + vsmTransmissionContextBytes(vsm.transmission)
    : 0,
});

/**
 * Bytes the frame makes beside a set of `layout`: the maps' own buffers beside the set
 * (`ENGINE_VSM_SIDE_BYTES`) and the passes' own state; the projection's mask at the targets' size, a layer per four casting
 * lights; the raster's draw context as large as the replaced set's, and never under the least
 * that draws every caster row (`vsmRenderFloorBytes`); and, while a blended caster casts, the
 * coloured atlas as large as the replaced set's, never under the first one and its least draw
 * context. The lists grow past these only within the room (`vsmChunkRowsWithin`). Without `mask`,
 * all but the mask, which a frame's own size sets (`vsmAskedBytes`).
 */
function bytesBeside(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
  layout: VsmLayout,
  held: HeldBeside,
  mask = true,
) {
  const [width, height] = rt.gpu.allocatedSize;
  const { viewWords, viewMips } = renderViewBound(lights);
  const pages = layout.poolPages;
  const casters = rt.layout.rows,
    used = rt.services.blendCasters.used;
  const raster = vsmRenderFloorBytes(
    device.limits,
    casters.packedCount,
    viewWords,
    viewMips,
    pages,
  );
  const blended = Math.max(0, casters.casterSlots - casters.blendFirst);
  const transmission =
    used > 0
      ? Math.max(
          held.transmission,
          vsmTransmissionBytes(layout) +
            vsmTransmissionFloorBytes(used, blended, viewWords, viewMips, pages),
        )
      : 0;
  const casting = castingCount(lights);
  // The passes' own state a new set makes: its page management, its projection's views and blue
  // noise, the invalidation's first parameters.
  const passes =
    VSM_PM_CONTEXT_BYTES + vsmProjectionBytesToMake(undefined) + VSM_INVALIDATION_PARAMS_BYTES;
  return (
    ENGINE_VSM_SIDE_BYTES +
    passes +
    (mask ? maskBytes(width, height, casting) : 0) +
    Math.max(held.lists, raster) +
    transmission
  );
}

/** The layout of the first set of `lights` (`grantEngineVsm`, from `planVsmFrame`): the maps they
 *  want at every physical page. */
export const vsmFirstSetLayout = (device: GPUDevice, lights: readonly VsmFrameLight[]) =>
  vsmLayout(
    engineVsmOptions(fullMapsFor(lights), directionalCount(lights)),
    device.limits.maxStorageBufferBindingSize,
  );

/** Bytes the first set of `lights` takes as the first lit frame asks it (`grantEngineVsm`, from
 *  `planVsmFrame`) — the maps they want at every physical page — with what the frame makes beside
 *  it but the mask (`bytesBeside`): what the budget reserves for it before the pools. */
export function vsmSetBytes(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  lights: readonly VsmFrameLight[],
) {
  const layout = vsmFirstSetLayout(device, lights);
  return (
    vsmResourceBytes(layout) + bytesBeside(rt, device, lights, layout, heldBeside(undefined), false)
  );
}

/**
 * Replaces the engine's maps by a set of `fullMapCapacity` full maps, at the most physical pages
 * up to `pagesAsked` that the budget's room holds once the frame's other shadow bytes are set
 * aside (`bytesBeside`, `vsmPoolWithin`); the set replaced is freed first, so its bytes count as
 * room. A pool short of the full one is said (`pool-shrunk`, `gpu-out-of-memory`) — or, when it
 * replaces a smaller one (`grownFrom`), its growth (`shadow-pool-regrown`) —, and the shadows'
 * resolution bias is its halvings from the full pool; its fill then raises the resolution bias as
 * the full pool's does (`VsmCacheManager.readPoolFeedback`). When none fits, the lights read no
 * shadow, by name (`pool-refused`), until the room holds the smallest pool or the lights change;
 * when the device refuses the set — undone whole (`constructGpuResources`) —, until they change.
 */
export function grantEngineVsm(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  fullMapCapacity: number,
  pagesAsked = VSM_POOL_PAGES,
  grownFrom = 0,
) {
  const { lights, diag } = rt;
  const held = heldBeside(lights.vsm);
  if (lights.vsm) destroyEngineVsm(lights.vsm);
  lights.vsm = undefined;
  const wanted = fullMapsFor(list),
    directional = directionalCount(list);
  const refused = lights.vsmRefusal;
  const same = refused?.wanted === wanted && refused.directional === directional;
  // The same lights refused an overflow regrow: asked again as it was.
  if (same) fullMapCapacity = Math.max(fullMapCapacity, refused.fullMapCapacity);
  const poolPages = same ? Math.min(pagesAsked, refused.poolPages) : pagesAsked;
  const options = engineVsmOptions(fullMapCapacity, directional, poolPages);
  const binding = device.limits.maxStorageBufferBindingSize;
  const refusal = (retryAt: number) =>
    (lights.vsmRefusal = { retryAt, wanted, directional, fullMapCapacity, poolPages });
  try {
    const asked = vsmLayout(options, binding);
    const room = ledgerRoom(device) - bytesBeside(rt, device, list, asked, held);
    if (same && room < refused.retryAt) return undefined;
    const pool = vsmPoolWithin(room, options, binding);
    if (!pool) {
      const smallest = { ...options, poolPages: poolPages / 8 };
      refusal(vsmResourceBytes(vsmLayout(smallest, binding)));
      lights.shadowReason = `${UNAVAILABLE} refused: no page pool fits the GPU budget`;
      noteShadowPressure(lights.memory, 'pool-refused');
      diag.engineDiagnostic(
        'gpu-out-of-memory',
        'The GPU budget holds no shadow page pool: the lights cast no shadow',
        outOfMemoryContext('shadow', vsmResourceBytes(asked)),
      );
      return undefined;
    }
    const pages = pool.layout.poolPages;
    const vsm = createEngineVsm(device, { ...options, poolPages: pages });
    vsm.regrowFrame = rt.run.frame + VSM_PRESSURE_CALM_FRAMES;
    sayPool(rt, pages, grownFrom, () =>
      outOfMemoryContext('shadow', vsmResourceBytes(asked), pool),
    );
    lights.vsmRefusal = undefined;
    if (lights.shadowReason?.startsWith(UNAVAILABLE)) lights.shadowReason = null;
    return (lights.vsm = vsm);
  } catch (error) {
    // Not the budget's room, which was measured: asked again only for other lights.
    refusal(Infinity);
    lights.shadowReason = `${UNAVAILABLE} unavailable: ${String(error)}`;
    return undefined;
  }
}

/**
 * The held set's tables grown for `list` — `fullMapCapacity` full maps at least, the receiver
 * mask of its suns — when the budget's room holds the new tables beside the old ones
 * (`vsmTableBytes`): the pool, its pages and their cache kept, in the same frame. Past the room,
 * or refused by the device, false: the caller makes the set again (`grantEngineVsm`), its cache
 * restarting.
 */
export function growEngineVsm(
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  vsm: EngineVsm,
  fullMapCapacity: number,
) {
  const { layout } = vsm.res;
  const options = engineVsmOptions(
    Math.max(fullMapCapacity, layout.fullMapCapacity),
    Math.max(vsm.suns, directionalCount(list)),
    layout.poolPages,
  );
  const grown = vsmLayout(options, device.limits.maxStorageBufferBindingSize);
  if (vsmTableBytes(grown) > ledgerRoom(device)) return false;
  try {
    return growEngineVsmTables(device, vsm, options);
  } catch {
    return false;
  }
}

/** The pool made at `pages`: a growth from `grownFrom` pages said as one, a pool short of the
 *  full one said as a shrink; the shadows' resolution bias, its halvings from the full pool. */
function sayPool(
  rt: WebgpuPagesRuntime,
  pages: number,
  grownFrom: number,
  shrunk: () => Record<string, unknown>,
) {
  const { memory } = rt.lights;
  const halvings = Math.log2(VSM_POOL_PAGES / pages);
  memory.bias = halvings;
  if (grownFrom && pages > grownFrom)
    rt.diag.engineDiagnostic(
      'shadow-pool-regrown',
      'The GPU budget holds a larger shadow page pool again: finer shadows',
      { kind: 'info', fromPages: grownFrom, pages },
    );
  else if (!grownFrom && halvings > 0) {
    noteShadowPressure(memory, 'pool-shrunk', halvings);
    rt.diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The GPU budget holds a smaller shadow page pool: coarser shadows',
      shrunk(),
    );
  }
}

/**
 * A pool drawn short of the full one grows back once the budget's room holds a larger one, at
 * most every `VSM_PRESSURE_CALM_FRAMES` frames — the wait before it raises a
 * resolution the budget lowered —, and only by the pages the room holds beside what the frame
 * keeps (`bytesBeside`, the held atlas and lists as large as they are): no frame flips between
 * two pools, as a live set never shrinks. The new set is made while the held one lives when both
 * fit, and replaces it; otherwise the held one is freed first (`grantEngineVsm`), and if the device
 * refuses the larger set, the held size is made again. The cache restarts — every page drawn
 * again —, in the same frame: no frame goes without shadows.
 */
export function regrowEngineVsm(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  vsm: EngineVsm,
): EngineVsm | undefined {
  const { layout } = vsm.res;
  const pages = layout.poolPages;
  if (pages >= VSM_POOL_PAGES || rt.run.frame < vsm.regrowFrame) return vsm;
  vsm.regrowFrame = rt.run.frame + VSM_PRESSURE_CALM_FRAMES;
  const { fullMapCapacity } = layout;
  const options = engineVsmOptions(fullMapCapacity, directionalCount(list));
  const binding = device.limits.maxStorageBufferBindingSize;
  const room = ledgerRoom(device);
  const beside = bytesBeside(rt, device, list, layout, heldBeside(vsm));
  const pool = vsmPoolWithin(room + engineVsmBytes(vsm) - beside, options, binding);
  const grown = pool?.layout.poolPages ?? 0;
  if (grown <= pages) return vsm;
  const { lights } = rt;
  if (pool!.allocatedBytes + ENGINE_VSM_SIDE_BYTES <= room)
    try {
      const made = createEngineVsm(device, { ...options, poolPages: grown });
      made.regrowFrame = vsm.regrowFrame;
      destroyEngineVsm(vsm);
      sayPool(rt, grown, pages, () => ({}));
      return (lights.vsm = made);
    } catch {
      return vsm;
    }
  // Freed first: the larger set, else the held size again, neither held back by a refusal.
  lights.vsmRefusal = undefined;
  let made = grantEngineVsm(rt, device, list, fullMapCapacity, VSM_POOL_PAGES, pages);
  if (!made) {
    lights.vsmRefusal = undefined;
    made = grantEngineVsm(rt, device, list, fullMapCapacity, pages, pages);
  }
  return made;
}

/**
 * Makes what the frame projects with before any other shadow allocation of the frame — the mask
 * array, a layer per four casting lights, the projection's view uniforms and blue noise
 * — when the budget's room holds what they grow by: a larger canvas, more casting lights
 * (`maskGrowth`). The lists the raster then grows within the room cannot take theirs. Past it the
 * lights read no shadow this frame, said once a set, and the next frames ask again.
 */
export function reserveProjection(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  vsm: EngineVsm,
  list: readonly VsmFrameLight[],
) {
  const [width, height] = rt.gpu.allocatedSize;
  const lights = castingCount(list),
    layers = maskLayersFor(lights);
  const growth = maskGrowth(vsm, width, height, lights) + vsmProjectionBytesToMake(vsm.res);
  if (growth <= 0 || growth <= ledgerRoom(device)) {
    ensureMask(device, vsm, width, height, layers, true);
    vsmProjectionReserve(device, vsm.res);
    return true;
  }
  if (!vsm.said.has('mask')) {
    vsm.said.add('mask');
    rt.diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The GPU budget holds no shadow mask at this size: the lights cast no shadow',
      outOfMemoryContext('shadow', growth),
    );
  }
  return false;
}

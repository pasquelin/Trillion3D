import { reflectionLayout } from './layout.ts';
import { createReflectionConePyramid } from './conePyramid.ts';
import { mipLevelCountFor } from '../texture/tiles.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { screenReflects } from './eligible.ts';
import { surfacesOfRows } from '../page/rowSurfaces.ts';
import { createReflectionHistory, type ReflectionHistory } from './historyRuntime.ts';
import type { ReflectionHistoryFrame } from './historyFrame.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';
import { createReflectionSource, type ReflectionSource } from './source.ts';

const reflecting = (surface: PageSurface) => screenReflects(refreshSurface(surface));
const roughReflecting = (surface: PageSurface) => {
  const material = refreshSurface(surface);
  return screenReflects(material) && material.roughness > Number(ROUGHNESS_FLOOR);
};

/** Only opaque receivers own this history. Forward transparents cannot borrow
 * the receiver behind them, and a perfect mirror retains its original resources. */
function wantsRoughReflectionHistory(rt: WebgpuPagesRuntime) {
  if (rt.run.diagnostic !== 'beauty') return false;
  return surfacesOfRows(rt.layout.rows).some(roughReflecting);
}

/**
 * Inspect only resident view rows and forward receivers, never the world's catalogue. Each
 * surface is reread once, however many rows wear it, and the rows are walked only when one was
 * written: a world of instances holds hundreds of thousands of rows over a handful of surfaces,
 * and a reread per row cost its image tens of milliseconds, twice (#410).
 */
export function wantsReflections(rt: WebgpuPagesRuntime) {
  if (rt.run.diagnostic !== 'beauty') return false;
  if (surfacesOfRows(rt.layout.rows).some(reflecting)) return true;
  for (const item of rt.blendState.blendGpu) if (reflecting(item.surface)) return true;
  return false;
}

/** Forward receivers own their footprint; they never sample opaque history. */
function wantsReflectionCone(rt: WebgpuPagesRuntime) {
  return (
    rt.run.diagnostic === 'beauty' &&
    rt.blendState.blendGpu.some(({ surface }) => roughReflecting(surface))
  );
}

/** What the reflection targets hold for `rt`, the one rule the builder, the targets' fit and their
 *  allocation read: a rough history and a cone only under an active reflection, the depth-bounds
 *  pyramid for either and for a water surface's bounded mirror ray (`water`, #1279; a reference
 *  session's walks every pixel and needs none), its radiance levels for a cone alone. */
export function reflectionPlan(rt: WebgpuPagesRuntime) {
  const active = wantsReflections(rt);
  const rough = active && wantsRoughReflectionHistory(rt);
  const cone = active && wantsReflectionCone(rt);
  const water = active && rt.blendState.transmissive > 0 && !rt.context?.unboundedReflections;
  return { active, rough, cone, water, pyramid: rough || cone || water };
}

/** `ReflectionView` (`screenWgsl.ts`): the matrix and `enabled`. */
export const REFLECTION_VIEW_BYTES = 80;

export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  depth: GPUTextureView,
  active: boolean,
  rough = false,
  cone = false,
  water = false,
) {
  const color = device.createTexture({
    label: 'Trillion3D unfogged reflection source',
    size: { width: active ? width : 1, height: active ? height : 1 },
    format: 'rgba16float',
    mipLevelCount: active && cone ? mipLevelCountFor(width, height) : 1,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = color.createView({ baseMipLevel: 0, mipLevelCount: 1 });
  const source = color.createView();
  let uniform: GPUBuffer | undefined;
  let history: ReflectionHistory | undefined;
  let pyramid: ReturnType<typeof createReflectionConePyramid> | undefined;
  let reprojection: ReflectionSource | undefined;
  try {
    // The rough trace and the water's mirror walk the cone's depth bounds; its radiance levels only
    // where a cone reads.
    if (active && (cone || rough || water))
      pyramid = createReflectionConePyramid(device, color, depth, cone);
    uniform = device.createBuffer({
      size: REFLECTION_VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    if (active) reprojection = createReflectionSource(device, width, height, depth);
    // The history reads the last depth and identifiers the source keeps.
    if (reprojection && rough)
      history = createReflectionHistory(device, width, height, reprojection.previous);
    const heldUniform = uniform;
    const packed = new Float32Array(REFLECTION_VIEW_BYTES / 4);
    const packedBits = new Uint32Array(packed.buffer);
    const groups = new WeakMap<GPUTextureView, GPUBindGroup>();
    const groupFor = () => {
      const image = history?.image ?? view;
      let group = groups.get(image);
      if (group) return group;
      group = device.createBindGroup({
        layout: reflectionLayout(device),
        entries: [
          { binding: 0, resource: source },
          { binding: 1, resource: depth },
          { binding: 2, resource: { buffer: heldUniform } },
          { binding: 3, resource: image },
          { binding: 4, resource: pyramid?.view ?? view },
        ],
      });
      groups.set(image, group);
      return group;
    };
    groupFor();
    return {
      active,
      /** The water composite's mirror ray walks the depth bounds (`reflectionPlan`). */
      water,
      view,
      get group() {
        return groupFor();
      },
      history,
      pyramid,
      /** The reprojection of the last image (`source.ts`): its bind group, none before an image
       *  gave its inputs; the lighting's second target, the next image's source
       *  (`sourceOutputWgsl.ts`); `keep`, after their readers, of this image's depth and ids. */
      source: reprojection,
      /** The view, whether it reflects, and the size the image draws in the source (`renderScale.ts`);
       *  `frame`, what the history and the source read (`reflectionFrame.ts`). */
      update(
        matrix: ArrayLike<number>,
        enabled: boolean,
        drawn: readonly number[],
        frame?: ReflectionHistoryFrame,
      ) {
        if (history && frame) history.prepare(frame, matrix, drawn);
        reprojection?.update(matrix, drawn, frame);
        packed.set(matrix);
        packed[16] = active && enabled ? 1 : 0;
        packed[17] = drawn[0];
        packed[18] = drawn[1];
        // The rank alone sets the two low bits, the 2 × 2 phase (`reflectionPhase`): a source
        // epoch that moves each image in step with the rank would otherwise hold one phase.
        // Only a rough trace reads it: without a history, none.
        packedBits[19] = history ? (((frame?.seed ?? 0) << 2) ^ history.rank) >>> 0 : 0;
        device.queue.writeBuffer(heldUniform, 0, packed);
      },
      dispose() {
        color.destroy();
        heldUniform.destroy();
        history?.dispose();
        pyramid?.dispose();
        reprojection?.dispose();
      },
    };
  } catch (error) {
    color.destroy();
    uniform?.destroy();
    reprojection?.dispose();
    history?.dispose();
    pyramid?.dispose();
    throw error;
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>;

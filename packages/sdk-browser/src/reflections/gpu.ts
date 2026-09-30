import { reflectionLayout } from './layout.ts';
import { createReflectionConePyramid } from './conePyramid.ts';
import { mipLevelCountFor } from '../texture/tiles.ts';
import { refreshSurface, type PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { screenReflects } from './eligible.ts';
import { surfacesOfRows } from '../page/rowSurfaces.ts';
import {
  createReflectionHistory,
  type ReflectionHistory,
  type ReflectionHistoryFrame,
} from './historyRuntime.ts';
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts';

const reflecting = (surface: PageSurface) => screenReflects(refreshSurface(surface));
const roughReflecting = (surface: PageSurface) => {
  const material = refreshSurface(surface);
  return screenReflects(material) && material.roughness > Number(ROUGHNESS_FLOOR);
};

/** Only opaque receivers own this history. Forward transparents cannot borrow
 * the receiver behind them, and a perfect mirror retains its original resources. */
export function wantsRoughReflectionHistory(rt: WebgpuPagesRuntime) {
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
export function wantsReflectionCone(rt: WebgpuPagesRuntime) {
  return (
    rt.run.diagnostic === 'beauty' &&
    rt.blendState.blendGpu.some(({ surface }) => roughReflecting(surface))
  );
}

/** `ReflectionView` (`screenWgsl.ts`): the matrix, `enabled` and `unbounded`. */
export const REFLECTION_VIEW_BYTES = 96;

export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  depth: GPUTextureView,
  active: boolean,
  rough = false,
  cone = false,
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
  try {
    if (active && cone) pyramid = createReflectionConePyramid(device, color, depth);
    if (active && rough) history = createReflectionHistory(device, width, height);
    uniform = device.createBuffer({
      size: REFLECTION_VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
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
      view,
      get group() {
        return groupFor();
      },
      history,
      pyramid,
      /** The view, whether it reflects, the size the image draws in the source (`renderScale.ts`),
       *  and whether rough samples walk unbounded, as a reference session draws them (#33). */
      update(
        matrix: ArrayLike<number>,
        enabled: boolean,
        drawn: readonly number[],
        frame?: ReflectionHistoryFrame,
        unbounded = false,
      ) {
        if (history && frame) history.prepare(frame, matrix, drawn);
        packed.set(matrix);
        packed[16] = active && enabled ? 1 : 0;
        packed[17] = drawn[0];
        packed[18] = drawn[1];
        packedBits[19] = ((history?.rank ?? 0) ^ (frame?.seed ?? 0)) >>> 0;
        packed[20] = unbounded ? 1 : 0;
        device.queue.writeBuffer(heldUniform, 0, packed);
      },
      dispose() {
        color.destroy();
        heldUniform.destroy();
        history?.dispose();
        pyramid?.dispose();
      },
    };
  } catch (error) {
    color.destroy();
    uniform?.destroy();
    history?.dispose();
    pyramid?.dispose();
    throw error;
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>;

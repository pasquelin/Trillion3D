import { refreshSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { reflects } from './eligible.ts';

const layouts = new WeakMap<GPUDevice, GPUBindGroupLayout>();
export function reflectionLayout(device: GPUDevice) {
  let layout = layouts.get(device);
  if (!layout) {
    layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    layouts.set(device, layout);
  }
  return layout;
}

/** Inspect only resident view rows and forward receivers, never the world's catalogue. */
export function wantsReflections(rt: WebgpuPagesRuntime) {
  if (rt.run.diagnostic !== 'beauty') return false;
  const rows = rt.layout.rows;
  for (let i = 0; i < rows.packedCount; i++) {
    const rec = rows.packedRecs[i];
    if (rec && reflects(refreshSurface(rec.material))) return true;
  }
  return rt.blendState.blendGpu.some((item) => reflects(refreshSurface(item.surface)));
}

export function createScreenReflection(
  device: GPUDevice,
  width: number,
  height: number,
  depth: GPUTextureView,
  active: boolean,
) {
  const color = device.createTexture({
    label: 'Trillion3D unfogged reflection source',
    size: { width: active ? width : 1, height: active ? height : 1 },
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = color.createView();
  let uniform: GPUBuffer | undefined;
  try {
    uniform = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const heldUniform = uniform;
    const packed = new Float32Array(20);
    const group = device.createBindGroup({
      layout: reflectionLayout(device),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: depth },
        { binding: 2, resource: { buffer: uniform } },
      ],
    });
    return {
      active,
      view,
      group,
      /** The view, whether it reflects, and the size the image draws in the source (`renderScale.ts`). */
      update(
        matrix: ArrayLike<number>,
        enabled: boolean,
        [drawnWidth, drawnHeight]: readonly number[],
      ) {
        packed.set(matrix);
        packed[16] = active && enabled ? 1 : 0;
        packed[17] = drawnWidth;
        packed[18] = drawnHeight;
        device.queue.writeBuffer(heldUniform, 0, packed);
      },
      dispose() {
        color.destroy();
        heldUniform.destroy();
      },
    };
  } catch (error) {
    color.destroy();
    uniform?.destroy();
    throw error;
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>;

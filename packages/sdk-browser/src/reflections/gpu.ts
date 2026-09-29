import { refreshSurface, type PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { reflects } from './eligible.ts';
import { rowsMoved, rowsUnread, type RowsReading } from '../webgpu/row/dirty.ts';

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

/** The distinct surfaces of a row table's packed rows, and the rows and table age they were
 *  read at; held per table, so a runtime that never draws a row keeps nothing. */
type RowSurfaces = { read: RowsReading; epoch: number; surfaces: PageSurface[] };
const rowSurfaces = new WeakMap<object, RowSurfaces>();

/**
 * The surfaces rows `[0, count)` wear, each once: the rows are walked again only once written, or
 * once the table ages — a record takes another surface in place (`wearDeclaration`) under a new
 * age, before its rows are written again.
 */
function surfacesOfRows(rows: WebgpuPagesRuntime['layout']['rows']) {
  let held = rowSurfaces.get(rows);
  if (!held) rowSurfaces.set(rows, (held = { read: rowsUnread(), epoch: -1, surfaces: [] }));
  const moved = rowsMoved(held.read, rows.packedRecs, rows.packedCount, rows.rowWrites);
  if (!moved && held.epoch === rows.tableEpoch) return held.surfaces;
  held.epoch = rows.tableEpoch;
  const seen = new Set<PageSurface>();
  let last: PageSurface | undefined;
  for (let i = 0; i < rows.packedCount; i++) {
    const surface = rows.packedRecs[i]?.material;
    // Rows of one surface run together: the run skips the set.
    if (!surface || surface === last) continue;
    last = surface;
    seen.add(surface);
  }
  held.surfaces = [...seen];
  return held.surfaces;
}

const reflecting = (surface: PageSurface) => reflects(refreshSurface(surface));

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

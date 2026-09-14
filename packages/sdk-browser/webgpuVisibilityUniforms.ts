import { viewProj } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Uploads visibility and material resolve uniforms for the current cut, creating the two uniform
 *  buffers on `rt.vis` the first time. */
export function writeWebgpuVisibilityUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  tableRows: number,
) {
  const { vis, run } = rt,
    { visUniPacked, shadeUniPacked } = vis,
    [width, height] = rt.gpu.targetSize,
    hasGpuSmall = !!vis.gpuSmall,
    { gpuFrameActive, diagnostic } = run,
    maskOffset = run.gpuSelection?.maskOffset ?? 0;
  const visUniform = (vis.visUniform ??= device.createBuffer({
    size: 7 * 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  const visInts = new Uint32Array(visUniPacked.buffer);
  for (let slot = 0; slot < 7; slot++) {
    const base = slot * 64;
    visUniPacked.set(viewProj.elements, base);
    visUniPacked[base + 16] = width;
    visUniPacked[base + 17] = height;
    visUniPacked[base + 18] = hasGpuSmall ? 7 : 0;
    // The compute raster splits the page row over two dispatch dimensions; it needs the live count.
    visInts[base + 19] = tableRows;
    visInts[base + 20] = Math.max(0, slot - 1);
    visInts[base + 21] = slot === 0 ? 0 : 1;
    visInts[base + 22] = gpuFrameActive ? maskOffset : 0;
    visInts[base + 23] = gpuFrameActive ? 1 : 0;
  }
  device.queue.writeBuffer(visUniform, 0, visUniPacked);
  const shadeUniform = (vis.shadeUniform ??= device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  shadeUniPacked.set(viewProj.elements, 0);
  shadeUniPacked[16] = width;
  shadeUniPacked[17] = height;
  const shadeInts = new Uint32Array(shadeUniPacked.buffer);
  shadeInts[20] = tableRows;
  shadeInts[21] =
    diagnostic === 'beauty'
      ? 0
      : diagnostic === 'wireframe'
        ? 1
        : diagnostic === 'clusters'
          ? 2
          : diagnostic === 'pages'
            ? 3
            : diagnostic === 'lod'
              ? 4
              : diagnostic === 'visibility'
                ? 5
                : 6;
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked);
}

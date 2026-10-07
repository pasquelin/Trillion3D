import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { buildComputeStages } from '../../lighting/deferred/fullscreen.ts'
import { DEFAULT_GROUP_WIDTH, groupWidth } from '../../gpu/dag/shader/gridWgsl.ts'
import { SHADE_CACHE_SHADER, SHADE_TRIS_SHADER } from '../../visibility/shader/shadeCacheWgsl.ts'

/** The pipeline constant that turns the cache on in the shade and the triangles passes. */
export const CACHED = { SHADE_CACHE: 1 }

/** The passes' pipelines and layouts, for what the session caches; none on a device with no
 *  compute or that refuses them. */
export async function cachePasses(device: GPUDevice) {
  if (typeof device.createComputePipeline !== 'function') return
  const compute = GPUShaderStage.COMPUTE,
    readOnly: GPUBufferBindingLayout = { type: 'read-only-storage' },
    storage: GPUBufferBindingLayout = { type: 'storage' }
  const span = groupWidth(device.limits)
  return validated(device, async () => {
    const [rowsModule, trisModule] = await Promise.all([
      createCheckedShaderModule(device, SHADE_CACHE_SHADER, 'SHADE_CACHE'),
      createCheckedShaderModule(device, SHADE_TRIS_SHADER, 'SHADE_TRIS'),
    ])
    const rowsLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, buffer: readOnly },
        { binding: 1, visibility: compute, buffer: storage },
        { binding: 2, visibility: compute, texture: { sampleType: 'uint' } },
        { binding: 3, visibility: compute, buffer: storage },
      ],
    })
    const trisLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: compute, buffer: readOnly },
        { binding: 1, visibility: compute, buffer: storage },
        ...[2, 3, 4].map((binding) => ({ binding, visibility: compute, buffer: readOnly })),
        { binding: 5, visibility: compute, buffer: { type: 'uniform' } },
        {
          binding: 6,
          visibility: compute,
          texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
        },
      ] as GPUBindGroupLayoutEntry[],
    })
    const layoutOf = (layout: GPUBindGroupLayout) =>
      device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const [rows, triangles] = await Promise.all([
      buildComputeStages(
        device,
        layoutOf(rowsLayout),
        rowsModule,
        ['shade_clear', 'shade_marks', 'shade_rows'],
        { ...CACHED, ...(span !== DEFAULT_GROUP_WIDTH && { GROUP_WIDTH: span }) },
      ),
      buildComputeStages(device, layoutOf(trisLayout), trisModule, ['shade_tris'], CACHED),
    ])
    const work = device.createBuffer({
      label: 'Trillion3D material cache dispatch',
      size: 12,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    })
    // One deep; x and y, cleared each image, raised by the rows that fit (`openSlice`).
    device.queue.writeBuffer(work, 8, new Uint32Array([1]))
    return { rowsLayout, trisLayout, span, work, ...rows, shade_tris: triangles.shade_tris }
  })
}

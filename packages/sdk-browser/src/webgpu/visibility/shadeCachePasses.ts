import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { validated } from '../../gpu/core/errorScope.ts'
import { buildComputeStages, canCompute } from '../../lighting/deferred/fullscreen.ts'
import { DEFAULT_GROUP_WIDTH, groupWidth } from '../../gpu/dispatch/grid.ts'
import { SHADE_CACHE_SHADER, SHADE_TRIS_SHADER } from '../../visibility/shader/shadeCacheWgsl.ts'
import { computeBufferEntry, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The pipeline constant that turns the cache on in the shade and the triangles passes. */
export const CACHED = { SHADE_CACHE: 1 }

/** The passes' pipelines and layouts, for what the session caches; none on a device with no
 *  compute or that refuses them. */
export async function cachePasses(device: GPUDevice) {
  if (!canCompute(device)) return
  const compute = GPUShaderStage.COMPUTE
  const span = groupWidth(device.limits)
  return validated(device, async () => {
    const [rowsModule, trisModule] = await Promise.all([
      createCheckedShaderModule(device, SHADE_CACHE_SHADER, 'SHADE_CACHE'),
      createCheckedShaderModule(device, SHADE_TRIS_SHADER, 'SHADE_TRIS'),
    ])
    const rowsLayout = device.createBindGroupLayout({
      entries: [
        computeBufferEntry(0, 'read-only-storage', compute),
        computeBufferEntry(1, 'storage', compute),
        computeTextureEntry(2, 'uint', '2d', compute),
        computeBufferEntry(3, 'storage', compute),
      ],
    })
    const trisLayout = device.createBindGroupLayout({
      entries: [
        computeBufferEntry(0, 'read-only-storage', compute),
        computeBufferEntry(1, 'storage', compute),
        ...[2, 3, 4].map((binding) => computeBufferEntry(binding, 'read-only-storage', compute)),
        computeBufferEntry(5, 'uniform', compute),
        computeTextureEntry(6, 'unfilterable-float', '2d-array', compute),
      ] as GPUBindGroupLayoutEntry[],
    })
    const [rows, triangles] = await Promise.all([
      buildComputeStages(
        device,
        [rowsLayout],
        rowsModule,
        ['shade_clear', 'shade_marks', 'shade_rows'],
        { ...CACHED, ...(span !== DEFAULT_GROUP_WIDTH && { GROUP_WIDTH: span }) },
      ),
      buildComputeStages(device, [trisLayout], trisModule, ['shade_tris'], CACHED),
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

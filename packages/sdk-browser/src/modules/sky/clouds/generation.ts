import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { computeStorageTextureEntry, sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'

/**
 * WHAT THE CLOUD TEXTURES' GENERATORS SHARE: the way a generator compiles its kernels over one bind
 * group layout, runs a chain of them in one submission, and writes a table of numbers into its
 * shader. Each generator is a short chain of compute passes over buffers it frees afterwards.
 */

/** One pass of a generator: a kernel, the group it reads and writes, the workgroups it runs. */
interface GeneratorPass {
  readonly pipeline: GPUComputePipeline
  readonly group: GPUBindGroup
  readonly workgroups: readonly [number, number, number]
}

/** The kernels `entryPoints` of `code`, compiled together over the one layout of `entries`, which
 *  every kernel of the module shares (one it does not use is left unbound by its shader). */
export async function compileKernels<E extends string>(
  device: GPUDevice,
  label: string,
  code: string,
  entries: readonly GPUBindGroupLayoutEntry[],
  entryPoints: readonly E[],
) {
  const layout = device.createBindGroupLayout({ label, entries: [...entries] })
  const module = device.createShaderModule({ label, code })
  const pipelines = await buildComputeStages(device, [layout], module, entryPoints)
  return { layout, pipelines }
}

/** A storage buffer of `bytes`, written by the host (`COPY_DST`) before the kernels run. */
export const storageBuffer = (device: GPUDevice, label: string, bytes: number) =>
  device.createBuffer({
    label,
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** `passes`, each a compute pass of its own so that the next reads what the last wrote, in one
 *  submission; then `temporaries` are freed, the submitted work keeping them until it is done. */
export function runGenerator(
  device: GPUDevice,
  label: string,
  passes: readonly GeneratorPass[],
  temporaries: readonly GPUBuffer[],
) {
  const encoder = device.createCommandEncoder({ label })
  for (const { pipeline, group, workgroups } of passes) {
    const pass = encoder.beginComputePass({ label })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(...workgroups)
    pass.end()
  }
  device.queue.submit([encoder.finish()])
  for (const buffer of temporaries) buffer.destroy()
}

/** `const name=array<f32,n>(...)` of `values`, each its `f32` literal, so that the
 *  shader and the host read the same numbers. */
export const wgslFloats = (name: string, values: readonly number[]) =>
  `const ${name}=array<f32,${values.length}>(${values.map(wgslF32).join(',')});`

/** What a one-kernel generator is made of: its label, shader, entry point, the texels it writes along
 *  each axis (two axes make a 2D texture, three a volume), the texels a thread group covers along an
 *  axis, and what it binds beside the texture: layout entries and resources in binding order from 1,
 *  and the buffers to free once it is submitted. */
interface TextureGenerator<E extends string> {
  readonly label: string
  readonly code: string
  readonly entryPoint: E
  readonly size: readonly [number, number] | readonly [number, number, number]
  readonly groupTexels: number
  readonly extra?: {
    readonly entries: readonly GPUBindGroupLayoutEntry[]
    readonly resources: readonly GPUBindingResource[]
    readonly temporaries: readonly GPUBuffer[]
  }
}

/** The `rgba16float` texture a one-kernel generator writes, its kernel run once, a thread to a
 *  texel, over every texel (`TextureGenerator`). */
export async function generateTexture<E extends string>(
  device: GPUDevice,
  { label, code, entryPoint, size, groupTexels, extra }: TextureGenerator<E>,
) {
  const volume = size.length === 3
  const { layout, pipelines } = await compileKernels(
    device,
    label,
    code,
    [
      computeStorageTextureEntry(0, 'rgba16float', 'write-only', volume ? '3d' : '2d'),
      ...(extra?.entries ?? []),
    ],
    [entryPoint],
  )
  const texture = device.createTexture({
    label,
    dimension: volume ? '3d' : '2d',
    size: [...size],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const group = device.createBindGroup({
    label,
    layout,
    entries: sequentialEntries([texture.createView(), ...(extra?.resources ?? [])]),
  })
  const [x, y, z] = size
  const workgroups = [x / groupTexels, y / groupTexels, volume ? z! / groupTexels : 1] as const
  runGenerator(
    device,
    label,
    [{ pipeline: pipelines[entryPoint], group, workgroups }],
    extra?.temporaries ?? [],
  )
  return texture
}

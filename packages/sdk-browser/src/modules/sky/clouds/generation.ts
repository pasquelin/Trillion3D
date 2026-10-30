import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { computeStorageTextureEntry, sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { cloudMipKernels, mipLevelsOf, mipPasses } from './mips.ts'
import type { MipFilter } from './mipsWgsl.ts'

/**
 * WHAT THE CLOUD TEXTURES' GENERATORS SHARE: the way a generator compiles its kernels over one bind
 * group layout, runs a chain of them in one submission, and writes a table of numbers into its
 * shader. Each generator is a short chain of compute passes.
 */

/** One pass of a generator: a kernel, the group it reads and writes, the workgroups it runs. */
export interface GeneratorPass {
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

/** `passes`, each a compute pass of its own so that the next reads what the last wrote, in one
 *  submission. */
export function runGenerator(
  device: GPUDevice,
  label: string,
  passes: readonly GeneratorPass[],
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
}

/** `const name=array<f32,n>(...)` of `values`, each its `f32` literal, so that the
 *  shader and the host read the same numbers. */
export const wgslFloats = (name: string, values: readonly number[]) =>
  `const ${name}=array<f32,${values.length}>(${values.map(wgslF32).join(',')});`

/** What a one-kernel generator is made of: its label, shader, entry point, the texels it writes along
 *  each axis, the texels a thread group covers along an axis, and the filter of the mip chain it is
 *  given (`mips.ts`), none for a texture of its level 0 alone. */
interface TextureGenerator<E extends string> {
  readonly label: string
  readonly code: string
  readonly entryPoint: E
  readonly size: readonly [number, number]
  readonly groupTexels: number
  readonly mips?: MipFilter
}

/** The 2D `rgba16float` texture a one-kernel generator writes, its kernel run once, a thread to a
 *  texel, over every texel (`TextureGenerator`). */
export async function generateTexture<E extends string>(
  device: GPUDevice,
  { label, code, entryPoint, size, groupTexels, mips }: TextureGenerator<E>,
) {
  const { layout, pipelines } = await compileKernels(
    device,
    label,
    code,
    [computeStorageTextureEntry(0, 'rgba16float')],
    [entryPoint],
  )
  const texture = device.createTexture({
    label,
    size: [...size],
    format: 'rgba16float',
    mipLevelCount: mips ? mipLevelsOf(size[0]) : 1,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const group = device.createBindGroup({
    label,
    layout,
    entries: sequentialEntries([texture.createView({ baseMipLevel: 0, mipLevelCount: 1 })]),
  })
  const [x, y] = size
  const workgroups = [x / groupTexels, y / groupTexels, 1] as const
  const chain = mips ? mipPasses(device, await cloudMipKernels(device), texture, mips) : []
  runGenerator(device, label, [{ pipeline: pipelines[entryPoint], group, workgroups }, ...chain])
  return texture
}

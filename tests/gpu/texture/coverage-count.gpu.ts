// The coverage count reads each workgroup's alphas once, into workgroup memory: on the GPU,
// its bins equal, word for word, those of the same kernel reading each texel's four alphas
// directly — on random, flat transparent and flat opaque alphas, from 1×1 to odd and wide sizes,
// on level 0 and on reduced levels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../packages/math/src/wgsl/assemble.ts'
import { LEVEL_BIN_BYTES } from '../../../packages/sdk-browser/src/texture/coverageMips.ts'
import { COVERAGE_COUNT_WGSL } from '../../../packages/sdk-browser/src/texture/mipsWgsl.ts'
import { levelSize } from '../../../packages/sdk-browser/src/texture/tiles.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** The shipped count's read through the workgroup's alphas, and the direct read it replaces. */
const SHARED = `  for(var j=i;j<81u;j+=64u){alphas[j]=alphaAt(o+vec2u(j%9u,j/9u));}
  workgroupBarrier();
  if(all(id.xy<sizeOf(k))){
   let j=(id.y-o.y)*9u+id.x-o.x;
   let a=vec4u(alphas[j],alphas[j+1u],alphas[j+9u],alphas[j+10u]);`
const DIRECT = `  if(all(id.xy<sizeOf(k))){
   let q=id.xy;
   let a=vec4u(alphaAt(q),alphaAt(q+vec2u(1u,0u)),alphaAt(q+vec2u(0u,1u)),alphaAt(q+vec2u(1u,1u)));`

interface CountCase {
  /** The source level's size, its RGBA8 texels, the count's uniform block, the bins' bytes, and
   *  the level's size the count dispatches over. */
  w: number
  h: number
  texels: Uint8Array<ArrayBuffer>
  uniform: Uint32Array<ArrayBuffer>
  bytes: number
  dispatch: [number, number]
}

function countCases() {
  const next = random(961)
  // Width, height and level: 1×1, odd, wide and tall, level 0 and reduced; then random ones.
  // prettier-ignore
  const sizes = [[1, 1, 0], [3, 5, 0], [9, 17, 0], [769, 33, 0], [64, 64, 1], [65, 7, 1], [2049, 3, 1]]
  for (let n = 0; n < 12; n++)
    sizes.push([1 + Math.floor(next() * 300), 1 + Math.floor(next() * 300), Math.floor(next() * 3)])
  return sizes.map(([width, height, level], n): CountCase & { name: string } => {
    const [w, h] = levelSize(width, height, Math.max(0, level - 1))
    // Flat transparent, flat opaque, or random alphas.
    const flat = [-1, 0, 255][n % 3]
    const texels = Uint8Array.from({ length: w * h * 4 }, () =>
      flat < 0 ? Math.floor(next() * 256) : flat,
    )
    const uniform = Uint32Array.of(w, h, 1 + Math.floor(next() * 255), 0, width, height, level, 0)
    return {
      name: `${width}×${height} level ${level}`,
      w,
      h,
      texels,
      uniform,
      bytes: (level + 1) * LEVEL_BIN_BYTES,
      dispatch: levelSize(width, height, level),
    }
  })
}

/** Each case counted by each text: the bins per case, per text. */
async function countBins({ texts, cases }: { texts: string[]; cases: CountCase[] }) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const pipelines = await Promise.all(
    texts.map(async (code) => {
      const { module, compilation } = await gpu.compile(code)
      if (compilation.length) throw new Error(compilation.join('\n'))
      return device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'count' },
      })
    }),
  )
  const bins: Uint32Array[][] = []
  for (const { w, h, texels, uniform, bytes, dispatch } of cases) {
    const source = device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture({ texture: source }, texels, { bytesPerRow: w * 4 }, [w, h])
    const level = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(level, 0, uniform)
    const count = async (pipeline: GPUComputePipeline) => {
      const cover = device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      })
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: source.createView() },
          { binding: 1, resource: { buffer: level } },
          { binding: 2, resource: { buffer: cover } },
        ],
      })
      const encoder = device.createCommandEncoder(),
        pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(dispatch[0], 8), ceilDiv(dispatch[1], 8))
      pass.end()
      device.queue.submit([encoder.finish()])
      const words = (await readGpuBuffer(device, cover, bytes))!
      cover.destroy()
      return words
    }
    bins.push(await Promise.all(pipelines.map(count)))
    source.destroy()
    level.destroy()
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, bins, errors: gpu.errors }
}

test('the workgroup-memory count gives the bins of four direct reads a texel', async () => {
  const program = wgslModule(COVERAGE_COUNT_WGSL)
  assert.ok(program.includes(SHARED), 'the shipped count reads its workgroup’s alphas')
  const cases = countCases()
  const { adapter, bins, errors } = await runOnDawn(countBins, {
    texts: [program.replace(SHARED, DIRECT), program],
    cases,
  })
  console.log(JSON.stringify({ adapter, cases: cases.length }))
  assert.deepEqual(errors, [])
  for (const [n, [direct, shipped]] of bins.entries()) {
    assert.ok(direct.some(Boolean), `${cases[n].name}: the direct read counted nothing`)
    assert.deepEqual(shipped, direct, `${cases[n].name}: the bins differ`)
  }
})

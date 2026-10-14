// The reads of proof P3 one by one (`cardTilesPage.ts`): the card's three maps read at the same
// coordinates and levels by the engine's pool reads (`colorBlend`, `dataBlend` of `cardTileWgsl`,
// every tile resident) and by the hardware sampler on the whole chains, as the cards read before
// #1527 — each map's level clamped to its chain as `impLod` clamps it. The values come back as the
// shaders returned them, for `compareReads` (`cardTileTrilinear.ts`) to set beside the exact filter.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import {
  cardTileEntries,
  cardTileWgsl,
  type CardAtlases,
} from '../../../packages/sdk-browser/src/webgpu/tile/cardReads.ts'
import { bufferHolding, groupZero } from '../kit/computeReadback.ts'
import { CARD_MAPS, type Chain } from './cardTileRig.ts'
import { referenceGroup } from './cardTilesReference.ts'

/** Coordinates read at each level: a low-discrepancy set over the whole atlas, its edges and the
 *  discs' rims included. */
export const READ_POINTS = 2048

/** The taps read: each level of `lods`, clamped to a chain of `levels` levels, at every point, as
 *  f32 `(u, v, level, 0)`. */
export function readTaps(lods: readonly number[], levels: number) {
  const taps = new Float32Array(lods.length * READ_POINTS * 4)
  lods.forEach((lod, k) => {
    for (let n = 0; n < READ_POINTS; n++)
      taps.set(
        [(0.5 + n * 0.7548776662) % 1, (0.5 + n * 0.569840291) % 1, Math.min(lod, levels - 1), 0],
        (k * READ_POINTS + n) * 4,
      )
  })
  return taps
}

/** The kernel reading the three maps of the card at every tap with `read(map, uv, level)`. */
const kernel = (read: (map: number) => string) => `
@group(0) @binding(0) var<storage,read> taps:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> reads:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=arrayLength(&taps)){return;}
 let t=taps[i];
 reads[3u*i]=${read(0)};
 reads[3u*i+1u]=${read(1)};
 reads[3u*i+2u]=${read(2)};
}`

const [COLOUR, NORMAL_DEPTH, ORM] = CARD_MAPS(0)
/** The engine's pool reads, at the card's slots. */
const poolKernel = () =>
  wgslProgram(
    kernel((map) =>
      map === 0
        ? `colorBlend(colorSlot(${COLOUR}u),t.xy,t.z,false,false)`
        : `dataBlend(dataSlot(${map === 1 ? NORMAL_DEPTH : ORM}u),t.xy,t.z,false,false)`,
    ),
    [cardTileWgsl()],
  )
/** The hardware's reads of the whole chains, at the reference's bindings. */
const chainKernel = () => `
@group(1) @binding(0) var refColour:texture_2d<f32>;
@group(1) @binding(1) var refNormalDepth:texture_2d<f32>;
@group(1) @binding(2) var refOrm:texture_2d<f32>;
@group(1) @binding(3) var refSampler:sampler;
${kernel((map) => `textureSampleLevel(${['refColour', 'refNormalDepth', 'refOrm'][map]},refSampler,t.xy,t.z)`)}`

/** `code` run over `taps` with `group` as its group 1: the four floats of each map at each tap. */
async function run(
  device: GPUDevice,
  code: string,
  taps: Float32Array<ArrayBuffer>,
  group: (layout: GPUBindGroupLayout) => GPUBindGroup,
) {
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  })
  const bytes = taps.byteLength * 3,
    input = bufferHolding(device, taps, GPUBufferUsage.STORAGE),
    output = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, groupZero(device, pipeline, [{ buffer: input }, { buffer: output }]))
  pass.setBindGroup(1, group(pipeline.getBindGroupLayout(1)))
  pass.dispatchWorkgroups(ceilDiv(taps.length / 4, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = (await readGpuBuffer(device, output, bytes))!
  input.destroy()
  output.destroy()
  return new Float32Array(read.buffer, read.byteOffset, bytes / 4)
}

/** The three maps read at `taps` through the pool (`atlases`) and on the whole chains (`maps`),
 *  the two through `sampler`. */
export async function cardTileReads(
  device: GPUDevice,
  atlases: CardAtlases,
  sampler: GPUSampler,
  maps: { colour: Chain; normalDepth: Chain; orm: Chain },
  taps: Float32Array<ArrayBuffer>,
) {
  const entries = cardTileEntries(
    () => atlases,
    () => sampler,
  )
  const pool = await run(device, poolKernel(), taps, (layout) =>
    device.createBindGroup({ layout, entries }),
  )
  const chains = await run(device, chainKernel(), taps, (layout) =>
    referenceGroup(device, layout, sampler, maps),
  )
  return { pool, chains }
}

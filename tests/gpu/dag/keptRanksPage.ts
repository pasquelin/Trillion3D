// The engine's kept-rank tables (`gpu/dag/keptRanks.ts`) on the device the engine opens: a cut's
// real resources, its two lists written as a cut leaves them, the shipped difference and keep
// kernels run (`encodeDagDifference`), the difference read back. Lists drawn at random, repeats
// included, up to the full cap — the table's load one half —, then the readout grown, its kept
// lists carried and ranked again in tables of the new size (`growDagList`).
import { createDagResources } from '../../../packages/sdk-browser/src/gpu/dag/resources.ts'
import { encodeDagDifference } from '../../../packages/sdk-browser/src/gpu/dag/encodeDifference.ts'
import { growDagList } from '../../../packages/sdk-browser/src/gpu/dag/listCap.ts'
import { writeDagUniforms } from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts'
import {
  SELECTION_HEADER_WORDS as HEAD,
  differenceWord,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { dagWorkLayout } from '../../../packages/sdk-browser/src/gpu/dag/shader/floorWgsl.ts'
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { sceneView } from './cutScene.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { mulberry32 } from '../../../packages/math/src/sequence/random.ts'

/** A list of `count` pages of `pages`, a few repeated, from `seed`. */
function drawList(count: number, pages: number, seed: number) {
  const random = mulberry32(seed)
  const below = (bound: number) => Math.floor(random() * bound)
  const list = Array.from({ length: count }, () => below(pages))
  for (let k = 0; k < count >>> 4; k++) list[below(count)] = list[below(count)]
  return list
}

type Resources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** `lists` written where a cut leaves its two lists, their groups armed, the difference and keep
 *  run, and the two differences read back. */
async function differ(
  device: GPUDevice,
  r: Resources,
  lists: [number[], number[]],
  uniforms: never,
) {
  const cap = r.listCap,
    block = new Float32Array(DAG_UNIFORM_BYTES / 4)
  writeDagUniforms(block, r.packed, uniforms, cap)
  device.queue.writeBuffer(r.uniforms, 0, block)
  const [asked, drawn] = lists
  device.queue.writeBuffer(r.output, 0, Uint32Array.of(asked.length))
  device.queue.writeBuffer(r.output, HEAD * 4, Uint32Array.from(asked))
  device.queue.writeBuffer(r.output, (HEAD + cap) * 4, Uint32Array.of(drawn.length))
  device.queue.writeBuffer(r.output, (2 * HEAD + cap) * 4, Uint32Array.from(drawn))
  const groups = lists.flatMap((list) => [ceilDiv(Math.max(1, list.length), 64), 1])
  device.queue.writeBuffer(
    r.work,
    dagWorkLayout(r.blockCount).listGroups * 4,
    Uint32Array.from(groups),
  )
  const encoder = device.createCommandEncoder()
  encodeDagDifference(encoder, r)
  device.queue.submit([encoder.finish()])
  const words = await readBuffer(device, r.output, differenceWord(cap) * 4, 8 * cap)
  return [0, 1].map((l) => Array.from(words.subarray(l * cap, l * cap + lists[l].length)))
}

/** Each snapshot's two lists and the differences the GPU took of them, on a list of 64 ranks,
 *  then of 256 once grown. */
export async function keptRankDifferences() {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, errors } = gpu
  const { packed, uniforms } = sceneView(64, 3)
  const r = await createDagResources(device, packed, null, 64)
  if (!r) throw new Error('the cut does not mount')
  const pages = packed.pageCount
  const snapshots: { lists: [number[], number[]]; got: number[][] }[] = []
  const take = async (lists: [number[], number[]]) =>
    snapshots.push({ lists, got: await differ(device, r, lists, uniforms as never) })
  await take([drawList(40, pages, 1), drawList(64, pages, 2)])
  await take([drawList(64, pages, 3), drawList(17, pages, 4)])
  await take([drawList(0, pages, 5), drawList(64, pages, 6)])
  const grown = await growDagList(r, 256, 0, () => false)
  await take([drawList(256, pages, 7), drawList(200, pages, 8)])
  await take([drawList(256, pages, 9), drawList(256, pages, 10)])
  const rankBytes = r.ranks.map((buffer) => buffer.size)
  for (const buffer of r.buffers) buffer.destroy()
  const info = await gpu.fermer()
  return { adapter: info.court, errors, pages, grown, rankBytes, snapshots }
}

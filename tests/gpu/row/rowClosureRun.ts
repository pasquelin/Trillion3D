// The rows' closure and their victim sort run on Dawn after the shipped cut (`row-closure.gpu.ts`):
// `copies` placements of the cut-rule DAG, the strip camera seeing the first, three pages in four
// holding a row; the cut's own lists the seeds, the engine's hosts dispatching the shipped kernels
// (`webgpu/row/rowClosure.ts`, `webgpu/row/rowEvictSort.ts`), the use words and two queues read back.
import { ruleDag } from '../../../packages/sdk-browser/src/page/cut/cutRule.fixture.ts'
import {
  placements,
  stripCamera,
} from '../../../packages/sdk-browser/src/page/cut/cutRuleBackends.fixture.ts'
import {
  postPackedBases,
  rootOfPacked,
} from '../../../packages/sdk-browser/src/page/selection/placements.ts'
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts'
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { createSparseInts } from '../../../packages/sdk-browser/src/page/cut/sparseInts.ts'
import { mixWord, workgroupCount } from '../../../packages/math/src/scalar/integers.ts'
import { WORKGROUP_THREADS } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import {
  createRowMapGpu,
  createRowMapJournal,
} from '../../../packages/sdk-browser/src/webgpu/row/rowMapGpu.ts'
import { createRowClosure } from '../../../packages/sdk-browser/src/webgpu/row/rowClosure.ts'
import { createRowEvictSort } from '../../../packages/sdk-browser/src/webgpu/row/rowEvictSort.ts'
import { ROW_PAGE, ROW_USE_WORDS } from '../../../packages/sdk-browser/src/webgpu/row/rowWords.ts'
import { structuresOf } from '../../../packages/sdk-browser/src/gpu/dag/structureTable.ts'
import {
  DAG_ARGS_INITIAL,
  DAG_ARGS,
} from '../../../packages/sdk-browser/src/gpu/dag/shader/armWgsl.ts'
import {
  SELECTION_HEADER_WORDS,
  rowBurst,
  rowQueueWord,
} from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { openSelectionKernel } from '../dag/selectionKernel.ts'
import { runOnDawn } from '../kit/onDawn.ts'

/** The frame the cut runs at: the clock its seeds stamp. */
export const CUT_FRAME = 9

/** `copies` placements of the DAG, apart along -x, the strip camera on the first; each packed page
 *  whose hash says so holds the next row. */
export function closureScene(copies: number) {
  const dag = ruleDag(64)
  const roots = placements(dag, copies, 1e4)
  const index = postPackedBases(roots)
  const packed = packDagSelection(roots),
    cam = stripCamera(dag)
  packedWorldsToRenderOrigin(packed, roots, cam.eye)
  const uniforms = { ...cameraSelectionUniforms(cam, 1, [1280, 720]), frame: CUT_FRAME }
  const journal = createRowMapJournal(),
    rows = createSparseInts(journal)
  let count = 0
  for (let page = 0; page < packed.pageCount; page++) if (mixWord(page) & 3) rows.set(page, ++count)
  // The words as the host writes them: each row's page, never used, never walked.
  const initial: Uint32Array<ArrayBuffer> = new Uint32Array(count * ROW_USE_WORDS)
  rows.forEach((page, value) => void (initial[(value - 1) * ROW_USE_WORDS + ROW_PAGE] = page))
  const placementsOf = roots.map((root, w) => ({
    pageBase: index.baseOfRoot[w],
    structure: root.structure,
  }))
  return {
    ...{ packed, uniforms, rows, journal, count, initial, placements: placementsOf },
    placementOf: (page: number) => rootOfPacked(index, page),
    rowOf: (page: number) => rows.get(page) - 1,
  }
}

/** Retries `encode` on a fresh pass until the pipelines it needs are compiled. */
async function encodeWhenReady(
  device: GPUDevice,
  group: GPUBindGroup,
  encode: (pass: GPUComputePassEncoder) => boolean,
) {
  for (let tries = 0; tries < 1000; tries++) {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setBindGroup(0, group)
    const ran = encode(pass)
    pass.end()
    device.queue.submit([encoder.finish()])
    if (ran) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('the rows’ pipelines never compiled')
}

/**
 * The cut of `scene` on Dawn, then the rows' closure on its seeds, then the victim sort twice over
 * its use words at `clock`: the cut's lists, the use words and the two queues — count, ranked,
 * clock, then pages —, read back.
 */
export function runRowClosure(scene: ReturnType<typeof closureScene>, clock: number) {
  return runOnDawn(async () => {
    const kernel = await openSelectionKernel()
    const { device } = kernel
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    let use: Uint32Array = new Uint32Array(0),
      burst = 0
    const queues: Uint32Array[] = []
    // What the engine's hosts make, the proof's own: freed once read.
    const made: GPUBuffer[] = [],
      textures: GPUTexture[] = []
    const buffer = (d: GPUBufferDescriptor) => {
      const next = device.createBuffer(d)
      made.push(next)
      return next
    }
    const texture = (d: GPUTextureDescriptor) => {
      const next = device.createTexture(d)
      textures.push(next)
      return next
    }
    const selection = { name: 'rows', packed: scene.packed, uniforms: scene.uniforms }
    const reading = await kernel.cut(selection, async (bound) => {
      const groups = workgroupCount(scene.packed.pageCount, WORKGROUP_THREADS)
      const args = DAG_ARGS_INITIAL.slice()
      for (const at of [DAG_ARGS.cand, DAG_ARGS.live]) args.set([groups, 1, 1], at / 4)
      const argsBuffer = device.createBuffer({
        size: args.byteLength,
        usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(argsBuffer, 0, args)
      const useBuffer = device.createBuffer({ size: scene.count * ROW_USE_WORDS * 4, usage })
      device.queue.writeBuffer(useBuffer, 0, scene.initial)
      const map = createRowMapGpu(device, scene.rows, scene.journal, buffer)
      map.upload()
      const closure = createRowClosure(device, kernel, texture)
      const rows = { map: map.buffer!, use: useBuffer }
      await encodeWhenReady(device, bound.group, (pass) =>
        closure.encode(pass, argsBuffer, rows, structuresOf(scene.packed)),
      )
      use = (await readGpuBuffer(device, useBuffer, useBuffer.size))!
      const sort = createRowEvictSort(device, buffer),
        out = bound.buffers.out.buffer,
        queueAt = rowQueueWord(bound.at.listCap)
      burst = rowBurst(bound.at.listCap)
      for (let run = 0; run < 2; run++) {
        const at = { use: useBuffer, out, queueAt, clock, slots: scene.count, burst }
        await encodeWhenReady(device, bound.group, (pass) => sort.encode(pass, at))
        const words = SELECTION_HEADER_WORDS + burst
        queues.push((await readGpuBuffer(device, out, words * 4, queueAt * 4))!)
      }
      for (const held of textures) held.destroy()
      for (const held of [argsBuffer, useBuffer, ...made]) held.destroy()
    })
    await kernel.close()
    return { reading, use, queues, burst }
  }, undefined)
}

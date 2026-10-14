// Page of the R3 proof (`row-cost.gpu.ts`, M-R1): what the rows' closure and their victim sort cost
// a cut on the machine's device, at tables of 2¹⁸ to 2²² live rows. The cut-rule DAG placed until
// its instances pass the rows, every page resident, every instance holding a row, the table full —
// so every cut ranks a queue —; the same cut with and without the row pass
// (`webgpu/row/rowEviction.ts`), each frame cut again and copied back, timed from its encode to the
// queue's end. Published, never asserted: a timing is the machine's.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { createGpuDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { pageResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import type { GpuSelection } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { createRowEviction } from '../../../packages/sdk-browser/src/webgpu/row/rowEviction.ts'
import { createRowUseWords } from '../../../packages/sdk-browser/src/webgpu/row/rowWords.ts'
import { quantileOf } from '../../../packages/math/src/scalar/quantile.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { closureScene } from './rowClosureRun.ts'
import { hostStretches } from '../../../packages/sdk-browser/src/gpu/dag/hostStretches.fixture.ts'

interface Sweep {
  /** Live rows of each table measured. */
  rows: number[]
  frames: number
  rounds: number
}

/** A scene whose instances hold `rows` rows at least — three in four hold one
 *  (`closureScene`) —, a full table of them, each row's words its page's. */
function rowScene(rows: number) {
  const scene = closureScene(ceilDiv(rows, 90) + 1)
  const words = createRowUseWords()
  words.fit(scene.count)
  scene.rows.forEach((page, value) => words.assign(value - 1, page, 0))
  const clock = { frame: 10 }
  const host = {
    ...{ map: { tables: scene.rows, journal: scene.journal }, words },
    table: { blendFirst: scene.count, packedCount: scene.count },
    frame: () => clock.frame,
    order: () => {},
  }
  return { scene, host, clock, live: scene.count }
}

/** `selection` cut again and copied back each frame, `count` frames: the mean wall time a frame. */
async function timed(
  device: GPUDevice,
  selection: GpuSelection,
  uniforms: ReturnType<typeof closureScene>['uniforms'],
  clock: { frame: number },
  count: number,
) {
  const start = performance.now()
  for (let i = 0; i < count; i++) {
    clock.frame++
    selection.askEvictions()
    const encoder = device.createCommandEncoder()
    const settle = selection.dispatch({ ...uniforms, frame: clock.frame }, encoder)
    device.queue.submit([encoder.finish()])
    settle?.(true)
    await device.queue.onSubmittedWorkDone()
  }
  return (performance.now() - start) / count
}

export async function measureRowCost({ rows, frames, rounds }: Sweep) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const sizes = []
  for (const count of rows) {
    const { scene, host, clock, live } = rowScene(count)
    const all = pageResidency(new Uint8Array(scene.packed.pageCount).fill(1))
    const [plain, withRows] = await Promise.all([
      createGpuDagSelection(device, scene.packed, { roots: hostStretches(scene.packed) }),
      createGpuDagSelection(device, scene.packed, {
        roots: hostStretches(scene.packed),
        rowPass: createRowEviction(host),
      }),
    ])
    if (!plain || !withRows) {
      sizes.push({ rows: count, refused: true })
      break
    }
    const variants = [
      { name: 'cut alone', selection: plain },
      { name: 'cut and rows', selection: withRows },
    ]
    for (const { selection } of variants) selection.updateResidency(all)
    // The rows' pipelines compile off the frame: frames run until they surely have.
    const warm = performance.now() + 3000
    while (performance.now() < warm)
      for (const { selection } of variants) await timed(device, selection, scene.uniforms, clock, 4)
    const times: number[][] = variants.map(() => [])
    for (let round = 0; round < rounds; round++)
      for (const [v, { selection }] of variants.entries())
        times[v].push(await timed(device, selection, scene.uniforms, clock, frames))
    for (const { selection } of variants) selection.dispose()
    const ms = times.map((t) => quantileOf(t, 0.5) as number)
    sizes.push({
      rows: live,
      pages: scene.packed.pageCount,
      variants: variants.map(({ name }, v) => ({ name, ms: Number(ms[v].toFixed(4)) })),
      rowsMs: Number((ms[1] - ms[0]).toFixed(4)),
    })
  }
  const { court: adapter } = await gpu.fermer()
  return { adapter, errors: gpu.errors, sizes }
}

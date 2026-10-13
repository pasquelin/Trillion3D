import { ROW_WORDS } from '../../visibility/types.ts'
import { createPresentClasses } from './materialPasses.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { RenderBundles } from '../../gpu/core/renderBundles.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { commandArgs, type FakePass } from '../../../../../tests/kit/gpu/fakeRenderPass.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'

/** The pipelines `pass` set, in order. */
export const pipelinesOf = (pass: FakePass) =>
  commandArgs(pass.commands, 'setPipeline').map(([pipeline]) => pipeline)
/** How many draws `pass` made, its bundles' among them. */
export const drawsOf = (pass: FakePass) => commandArgs(pass.commands, 'draw').length

/** A runtime reduced to what the resolve reads, on the kit's device and one of its encoders: its
 *  render passes and compute passes are the device's records. Its class set holds
 *  `compiled`; `made` names each class a pipeline's `get` had to compile — one nothing asked
 *  (`PreparedPipeline.get`). */
export function resolveFixture(classes: number[], compiled: number[], single: number[] = []) {
  const ints = new Uint32Array(ROW_WORDS * classes.length)
  classes.forEach((key, row) => (ints[row * ROW_WORDS + PAGE_INFO.at.materialClass] = key))
  const made: number[] = []
  const tiles = { assigned: [] as number[][], classified: 0, slots: [] as number[] }
  const pipeline = (key: number) => ({ key }),
    ordinary = new Map(compiled.map((key) => [key, pipeline(key)])),
    direct = new Map(single.map((key) => [key, pipeline(key)]))
  const rt = {
    gpu: {
      surfaces: { views: () => ['a', 'b', 'c', 'd'] },
      targetSize: [8, 4],
      feedbackView: 'feedback',
    },
    run: { feedbackWritten: false, gpuDrawCalls: 0 },
    layout: { rows: { pageTableInts: ints, packedCount: classes.length } },
    vis: {
      writesFeedback: true,
      shadeBindGroup: 'bind group',
      shadeBundles: new RenderBundles(2),
      shadeClasses: {
        of: (key: number) => ({
          get: () => {
            if (!ordinary.has(key)) ordinary.set(key, (made.push(key), pipeline(key)))
            return ordinary.get(key)
          },
        }),
        keys: () => ordinary.keys(),
        single: (key: number) =>
          direct.has(key) ? { ready: true, get: () => direct.get(key) } : undefined,
      },
      presentClasses: createPresentClasses(),
      visView: 'ids',
      pageTable: 'pages',
      shadeUniform: 'uniform',
      materialTiles: {
        assign: (keys: number[]) => tiles.assigned.push([...keys]),
        layFor: () => 'tile group',
        // A classification dispatches: it opens the frame's pass.
        encode: (open: { pass: unknown }) => void (open.pass, tiles.classified++),
        draw: (pass: { draw(): void }, at: number) => (tiles.slots.push(at), pass.draw()),
      },
    },
  } as unknown as WebgpuPagesRuntime
  const { device, bundles, passes, computePasses } = fakeDevice()
  const encoder = device.createCommandEncoder()
  return { rt, device, bundles, encoder, passes, computePasses, made, ordinary, direct, tiles }
}

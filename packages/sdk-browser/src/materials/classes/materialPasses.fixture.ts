import { ROW_WORDS } from '../../visibility/types.ts'
import { createPresentClasses } from './materialPasses.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  commandArgs,
  type PassCommands,
} from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'

/** The pipelines a pass set, in order. */
export const pipelinesOf = (pass: { commands: PassCommands }) =>
  commandArgs(pass.commands, 'setPipeline').map(([pipeline]) => pipeline)
/** How many draws a pass made. */
export const drawsOf = (pass: { commands: PassCommands }) =>
  commandArgs(pass.commands, 'draw').length

/** A runtime reduced to what the resolve reads, on the kit's device and one of its encoders: its
 *  render passes and compute passes are the device's records. Its class set holds `compiled`;
 *  `made` names each class a pipeline's `get` had to compile — one nothing asked
 *  (`PreparedPipeline.get`). Its bins record what the resolve asks of them (`bins`): the keys
 *  assigned, the images laid, binned and the classes dispatched, by their rank among the keys. */
export function resolveFixture(classes: number[], compiled: number[]) {
  const ints = new Uint32Array(ROW_WORDS * classes.length)
  classes.forEach((key, row) => (ints[row * ROW_WORDS + PAGE_INFO.at.materialClass] = key))
  const made: number[] = []
  const bins = {
    assigned: [] as number[][],
    laid: [] as number[][],
    binned: 0,
    shaded: [] as number[],
  }
  const pipeline = (key: number) => ({ key }),
    ordinary = new Map(compiled.map((key) => [key, pipeline(key)]))
  const rt = {
    gpu: {
      surfaces: { views: () => ['a', 'b', 'c', 'd'] },
      targetSize: [8, 4],
      feedbackView: 'feedback',
    },
    run: { feedbackWritten: false, gpuComputeDispatches: 0 },
    // The shading's settings at their defaults (`shadingOptions.ts`).
    context: {},
    layout: { rows: { pageTableInts: ints, packedCount: classes.length } },
    vis: {
      // No displaced surface: no class shades through the displaced pipelines.
      materialTable: { displaced: { count: 0 } },
      writesFeedback: true,
      shadeBindGroup: 'bind group',
      shadeClasses: {
        of: (key: number) => ({
          get: () => {
            if (!ordinary.has(key)) ordinary.set(key, (made.push(key), pipeline(key)))
            return ordinary.get(key)
          },
        }),
        keys: () => ordinary.keys(),
      },
      presentClasses: createPresentClasses(),
      visView: 'ids',
      pageTable: 'pages',
      shadeUniform: 'uniform',
      shadeBins: {
        assign: (keys: number[]) => bins.assigned.push([...keys]),
        layFor: (width: number, height: number) => bins.laid.push([width, height]),
        // The binning dispatches: it opens the frame's pass, four kernels.
        encode: (open: { pass: unknown }) => (open.pass, bins.binned++, 4),
        outputs: () => 'output group',
        dispatch: (_: unknown, at: number) => bins.shaded.push(at),
      },
    },
  } as unknown as WebgpuPagesRuntime
  const { device, passes, computePasses, writes } = fakeDevice()
  const encoder = device.createCommandEncoder()
  return { rt, device, writes, encoder, passes, computePasses, made, ordinary, bins }
}

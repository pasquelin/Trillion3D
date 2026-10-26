// The visibility passes' kernels a fake device runs, on the bytes their dispatch binds: the decode of
// the visible clusters, its plans and the bins of a pass, each the CPU mirror of the kernel
// (`visibility/decode/cpu.fixture.ts`, `visibility/bins/cpu.fixture.ts`). The bins run at their last
// kernel, the finalizing, when every table they read is there; their count, reservation and scatter
// are part of that run.
import {
  replayDecode,
  replayDecodePlan,
  replayDeformPlan,
  type DecodeBytes,
} from '../../../packages/sdk-browser/src/visibility/decode/cpu.fixture.ts'
import { replayBins } from '../../../packages/sdk-browser/src/visibility/bins/cpu.fixture.ts'
import {
  decodePlanSource,
  decodeSource,
} from '../../../packages/sdk-browser/src/visibility/decode/decodeWgsl.ts'
import { binsSource } from '../../../packages/sdk-browser/src/visibility/bins/binsWgsl.ts'
import { wgslBindings } from '../../../packages/sdk-browser/src/visibility/wgslBindings.fixture.ts'
import { boundResource } from './fakeBuffers.ts'
import type { ComputeBind } from './fakeCompute.ts'

type Constants = Record<string, number>

/** Where each kernel's group 0 binds its tables, read off the shipped texts. */
const PLAN_BINDING = wgslBindings(decodePlanSource())
const DECODE_BINDING = wgslBindings(decodeSource())
const BIN_BINDING: Record<string, number> = (() => {
  const { params, ...tables } = wgslBindings(binsSource(1))
  return { ...tables, uniform: params }
})()

/** The bytes the dispatch binds at `binding`. */
const bytesAt = (bind: ComputeBind, binding: number) =>
  boundResource(bind.entries, binding).buffer.data

/** The decode's buffers: the plan's group binds three of them, the decode's seven. */
function decodeBytes(bind: ComputeBind, plan: boolean): DecodeBytes {
  const empty = new Uint8Array(0)
  if (plan)
    return {
      visible: bytesAt(bind, PLAN_BINDING.visible),
      work: bytesAt(bind, PLAN_BINDING.work),
      args: bytesAt(bind, PLAN_BINDING.args),
      info: empty,
      rootWorlds: empty,
      placements: empty,
      outputs: empty,
      pages: empty,
    }
  return {
    visible: bytesAt(bind, DECODE_BINDING.visible),
    info: bytesAt(bind, DECODE_BINDING.info),
    rootWorlds: bytesAt(bind, DECODE_BINDING.rootWorlds),
    placements: bytesAt(bind, DECODE_BINDING.placements),
    outputs: bytesAt(bind, DECODE_BINDING.outputs),
    pages: bytesAt(bind, DECODE_BINDING.pages),
    work: bytesAt(bind, DECODE_BINDING.work),
    args: empty,
  }
}

/** The replay of the kernel its entry point names: the plan, the decode, the deformation's plan,
 *  the bins' finalizing — each told the pass of its pipeline (`PASS`) and the device's dispatch
 *  width (`GROUP_WIDTH`). */
export const VISIBILITY_STAGES: Record<string, (bind: ComputeBind, constants: Constants) => void> =
  {
    decodePlan: (bind, { PASS = 0, GROUP_WIDTH }) =>
      replayDecodePlan(decodeBytes(bind, true), PASS, GROUP_WIDTH),
    deformPlan: (bind, { GROUP_WIDTH }) =>
      replayDeformPlan(bytesAt(bind, PLAN_BINDING.work), GROUP_WIDTH),
    decode: (bind, { PASS = 0 }) => replayDecode(decodeBytes(bind, false), PASS),
    binFinalize: (bind, { PASS = 0, GROUP_WIDTH }) =>
      replayBins(
        {
          pages: bytesAt(bind, BIN_BINDING.pages),
          visible: bytesAt(bind, BIN_BINDING.visible),
          work: bytesAt(bind, BIN_BINDING.work),
          instances: bytesAt(bind, BIN_BINDING.instances),
          indirect: bytesAt(bind, BIN_BINDING.indirect),
          slotOffsets: bytesAt(bind, BIN_BINDING.slotOffsets),
          lists: bytesAt(bind, BIN_BINDING.lists),
          uniform: bytesAt(bind, BIN_BINDING.uniform),
        },
        PASS,
        GROUP_WIDTH,
      ),
  }

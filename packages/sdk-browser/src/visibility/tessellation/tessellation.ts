import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import type { GpuRasterInput } from '../raster/types.ts'
import { MODE_DEPTH, type RasterPass } from '../raster/contract.ts'
import { DISPATCH_DICE, DISPATCH_SPLIT, MAX_SPLIT_LEVELS, PASS_DISPATCH_WORDS } from './contract.ts'
import { createTessellationGroups } from './groups.ts'
import { createTessellationPrograms } from './programs.ts'
import { createDisplacementBuffer, createTessellationResources } from './resources.ts'
import { TESS_UNIFORM, writeTessellationUniform, type TessellationCapacity } from './uniform.ts'

/** Dispatches a pass's levels encode: the seeding, then a plan and a split for each level, then the
 *  dicing's arguments. */
export const TESSELLATION_DISPATCHES = 2 + 2 * MAX_SPLIT_LEVELS

/**
 * THE TESSELLATION OF A FRAME'S DISPLACED SURFACES (`./`): the rows whose surface names a displacement
 * are left to it by the raster's split, and each pass of the cut turns their triangles into the
 * patches its displaced micro-triangles are written from.
 * - `begin` (before the pass's binning): the pass's uniform written, its state cleared;
 * - `encodeLevels` (inside the binning's compute pass): the seeding, the six levels of splitting, and
 *   the dicing's arguments;
 * - `encodeDice` (inside a raster mode's compute pass): the dicing of the pass's visible patches into
 *   the visibility buffer, in the mode's rule.
 * `asked` is the capacity the settings name; a held instance is made again when it moves
 * (`../raster/raster.ts`). Everything it holds is given back by `dispose`.
 */
export function createTessellation(
  device: GPUDevice,
  work: GPUBuffer,
  asked: TessellationCapacity,
) {
  const resources = createTessellationResources(device, asked)
  const named = { candidate: asked.candidate, visible: asked.visible }
  const programs = createTessellationPrograms(device)
  const displacement = createDisplacementBuffer(device)
  const groups = createTessellationGroups(device, programs.layouts, {
    work,
    resources,
    displacement,
  })
  const floats = new Float32Array(TESS_UNIFORM.words),
    ints = new Uint32Array(floats.buffer)
  const { layout, capacity } = resources
  /** The frame's input, held from `begin` for the dicing of the same image. */
  let current: GpuRasterInput
  return {
    /** The capacity the settings named when it was made: a held instance is kept while they say it. */
    asked: named,
    ask: () => programs.ask(),
    begin(encoder: GPUCommandEncoder, input: GpuRasterInput, pass: RasterPass) {
      current = input
      const { displaced, view, settings } = input.tessellation!
      displacement.follow(displaced)
      writeTessellationUniform(floats, ints, view, settings, capacity, {
        args: layout.args[pass]!,
        queue: layout.queue,
        visible: layout.visible[pass]!,
        dispatch: pass * PASS_DISPATCH_WORDS,
      })
      device.queue.writeBuffer(resources.uniforms[pass]!, 0, floats)
      const [offset, size] = resources.argsRange(pass)
      encoder.clearBuffer(resources.tess, offset, size)
    },
    encodeLevels(compute: GPUComputePassEncoder, pass: RasterPass) {
      const split = (pass * PASS_DISPATCH_WORDS + DISPATCH_SPLIT) * 4
      compute.setBindGroup(0, groups.of('seed', pass, current))
      compute.setPipeline(programs.seed.get())
      dispatchRows(compute, Math.max(1, current.pageRows))
      for (let level = 0; level < MAX_SPLIT_LEVELS; level++) {
        compute.setBindGroup(0, groups.of('plan', pass, current))
        compute.setPipeline(programs.plan.get())
        compute.dispatchWorkgroups(1)
        compute.setBindGroup(0, groups.of('split', pass, current))
        compute.setPipeline(programs.split.get())
        compute.dispatchWorkgroupsIndirect(resources.dispatch, split)
      }
      compute.setBindGroup(0, groups.of('plan', pass, current))
      compute.setPipeline(programs.visibleArgs.get())
      compute.dispatchWorkgroups(1)
    },
    encodeDice(compute: GPUComputePassEncoder, pass: RasterPass, mode: number) {
      compute.setBindGroup(0, groups.of('dice', pass, current))
      compute.setPipeline(programs.dice[mode === MODE_DEPTH ? 0 : 1]!.get())
      compute.dispatchWorkgroupsIndirect(
        resources.dispatch,
        (pass * PASS_DISPATCH_WORDS + DISPATCH_DICE) * 4,
      )
    },
    dispose() {
      resources.dispose()
      displacement.dispose()
    },
  }
}
export type Tessellation = ReturnType<typeof createTessellation>

import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import type { GpuRasterInput } from '../raster/types.ts'
import { MODE_DEPTH, RASTER_PASSES, RASTER_PASS_MAIN, type RasterPass } from '../raster/contract.ts'
import {
  DISPATCH_DICE,
  DISPATCH_RESUME,
  DISPATCH_SPLIT,
  MAX_SPLIT_LEVELS,
  OCCLUSION_MAIN,
  OCCLUSION_NONE,
  OCCLUSION_POST,
  PASS_DISPATCH_WORDS,
} from './contract.ts'
import { createTessellationGroups, type PassPyramid } from './groups.ts'
import { createTessellationPrograms } from './programs.ts'
import { createTessellationResources } from './resources.ts'
import type { TessellationOcclusion } from './input.ts'
import type { TessellationResources } from './resources.ts'
import {
  TESS_CHAIN_SHADOW,
  TESS_UNIFORM,
  writeTessellationUniform,
  type TessellationCapacity,
  type TessellationSettings,
  type TessellationSight,
  type TessellationView,
} from './uniform.ts'
import type { DisplacementRecords } from '../../materials/table/displacementRecord.ts'

/** Dispatches a pass's levels encode: the seeding, then a plan and a split for each level, then the
 *  dicing's arguments — and the two that take up what the main pass's occlusion test hid, in the
 *  post pass that tests one (`RESUME_DISPATCHES`). */
const TESSELLATION_DISPATCHES = 2 + 2 * MAX_SPLIT_LEVELS
const RESUME_DISPATCHES = 2

/** What a pass that tests no previous pyramid writes for its matrix. */
const ZERO_MATRIX = new Float32Array(16)
const NO_VIEW = [0, 0]
/** The shadow maps' chain tests no pyramid: each map judges a patch by its own page. */
const NO_SIGHT = {
  mode: OCCLUSION_NONE,
  prevViewProj: ZERO_MATRIX,
  depthMap: NO_VIEW,
  prevDepthMap: NO_VIEW,
  prevSize: NO_VIEW,
  maxOccluded: 0,
  mainArgs: 0,
}

type Programs = ReturnType<typeof createTessellationPrograms>
type Groups = ReturnType<typeof createTessellationGroups>

/** The seeding of `pass`, what the main pass's occlusion test hid taken up again when `resume`, the
 *  six levels of splitting each a plan and a split launched from the `dispatch` buffer, then the
 *  dicing's arguments, in `compute`, over `input`. */
function encodeLevels(
  compute: GPUComputePassEncoder,
  programs: Programs,
  groups: Groups,
  dispatch: GPUBuffer,
  input: GpuRasterInput,
  pass: RasterPass,
  resume: boolean,
) {
  const split = (pass * PASS_DISPATCH_WORDS + DISPATCH_SPLIT) * 4
  const run = (program: 'plan' | 'split', stage: { get(): GPUComputePipeline }) => {
    compute.setBindGroup(0, groups.of(program, pass, input))
    compute.setPipeline(stage.get())
  }
  compute.setBindGroup(0, groups.of('seed', pass, input))
  compute.setPipeline(programs.seed.get())
  dispatchRows(compute, Math.max(1, input.pageRows))
  if (resume) {
    run('plan', programs.resumeArgs)
    compute.dispatchWorkgroups(1)
    compute.setBindGroup(0, groups.of('seed', pass, input))
    compute.setPipeline(programs.resume.get())
    compute.dispatchWorkgroupsIndirect(dispatch, (pass * PASS_DISPATCH_WORDS + DISPATCH_RESUME) * 4)
  }
  for (let level = 0; level < MAX_SPLIT_LEVELS; level++) {
    run('plan', programs.plan)
    compute.dispatchWorkgroups(1)
    run('split', programs.split)
    compute.dispatchWorkgroupsIndirect(dispatch, split)
  }
  run('plan', programs.visibleArgs)
  compute.dispatchWorkgroups(1)
}

/** What writes the uniform of a chain (`TESS_CHAIN_SHADOW`, or a pass of the cut): its regions of the
 *  `tess` buffer from the layout, the words laid in one scratch and sent. */
function uniformWriter(device: GPUDevice, resources: TessellationResources) {
  const floats = new Float32Array(TESS_UNIFORM.words),
    ints = new Uint32Array(floats.buffer)
  const { layout, capacity } = resources
  return (
    chain: number,
    view: TessellationView,
    settings: TessellationSettings,
    sight: TessellationSight,
  ) => {
    const regions = {
      args: layout.args[chain]!,
      queue: layout.queue,
      visible: layout.visible[chain]!,
      dispatch: chain * PASS_DISPATCH_WORDS,
      disp: layout.disp,
    }
    writeTessellationUniform(floats, ints, view, settings, capacity, regions, sight)
    device.queue.writeBuffer(resources.uniforms[chain]!, 0, floats)
  }
}

/** The pyramid `pass` tests its patches against and what its test reads of the views: the main
 *  pass's the previous image's, the post pass's this image's, once the main pass's depth built it;
 *  none where the cut runs in one pass. Sets `pyramid` to it (the stand-in where there is none). */
function passSight(
  pass: RasterPass,
  occlusion: TessellationOcclusion,
  resources: TessellationResources,
  pyramid: PassPyramid,
): TessellationSight {
  const main = pass === RASTER_PASS_MAIN
  const source = occlusion.previous && (main ? occlusion.previous : occlusion.current())
  if (source) resources.keepOccluded()
  pyramid.view = source?.view ?? resources.standIn.pyramid
  pyramid.levels = source?.levels ?? resources.standIn.levels
  const { uniforms } = occlusion
  return {
    mode: !source ? OCCLUSION_NONE : main ? OCCLUSION_MAIN : OCCLUSION_POST,
    prevViewProj: uniforms.prevViewProj ?? ZERO_MATRIX,
    depthMap: uniforms.depthMap,
    prevDepthMap: uniforms.prevDepthMap ?? NO_VIEW,
    prevSize: uniforms.prevSize ?? NO_VIEW,
    maxOccluded: resources.maxOccluded,
    mainArgs: resources.layout.args[RASTER_PASS_MAIN]!,
  }
}

/**
 * What the shadow maps' chain shares with the cut's (`../../lighting/shadows/vsm/tessellation/`): the
 * buffers it runs in. Its uniform is written once an image, with the displaced surfaces' records
 * (`prepare`: the image's threshold, the settings), and its state cleared before each chunk of
 * casters (`clear`); the cut's passes have dealt with their lists by then.
 */
function shadowSide(resources: TessellationResources, write: ReturnType<typeof uniformWriter>) {
  return {
    resources,
    prepare(
      displaced: Pick<DisplacementRecords, 'ints' | 'version'>,
      settings: TessellationSettings,
      threshold: number,
    ) {
      resources.follow(displaced)
      write(TESS_CHAIN_SHADOW, { projection: 0, height: 0, threshold }, settings, NO_SIGHT)
    },
    clear(encoder: GPUCommandEncoder) {
      const [offset, size] = resources.argsRange(TESS_CHAIN_SHADOW)
      encoder.clearBuffer(resources.tess, offset, size)
    },
  }
}

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
  const programs = createTessellationPrograms(device)
  /** The pyramid each pass tests against, and whether it takes up what the main pass hid: set as the
   *  pass begins; the stand-in where it tests none. */
  const pyramids: PassPyramid[] = RASTER_PASSES.map(() => ({
    view: resources.standIn.pyramid,
    levels: resources.standIn.levels,
  }))
  const resumes = RASTER_PASSES.map(() => false)
  const groups = createTessellationGroups(device, programs.layouts, { work, resources, pyramids })
  const write = uniformWriter(device, resources)
  /** The frame's input, held from `begin` for the dicing of the same image. */
  let current: GpuRasterInput
  return {
    /** The capacity the settings named when it was made: a held instance is kept while they say it. */
    asked: { candidate: asked.candidate, visible: asked.visible, records: asked.records },
    ask: () => programs.ask(),
    begin(encoder: GPUCommandEncoder, input: GpuRasterInput, pass: RasterPass) {
      current = input
      const { displaced, view, settings, occlusion } = input.tessellation!
      resources.follow(displaced)
      const sight = passSight(pass, occlusion, resources, pyramids[pass]!)
      resumes[pass] = pass !== RASTER_PASS_MAIN && sight.mode !== OCCLUSION_NONE
      write(pass, view, settings, sight)
      const [offset, size] = resources.argsRange(pass)
      encoder.clearBuffer(resources.tess, offset, size)
    },
    encodeLevels: (compute: GPUComputePassEncoder, pass: RasterPass) =>
      encodeLevels(compute, programs, groups, resources.dispatch, current, pass, resumes[pass]!),
    /** The dispatches `encodeLevels` makes for `pass`. */
    levelDispatches: (pass: RasterPass) =>
      TESSELLATION_DISPATCHES + (resumes[pass] ? RESUME_DISPATCHES : 0),
    encodeDice(compute: GPUComputePassEncoder, pass: RasterPass, mode: number) {
      compute.setBindGroup(0, groups.of('dice', pass, current))
      compute.setPipeline(programs.dice[mode === MODE_DEPTH ? 0 : 1]!.get())
      compute.dispatchWorkgroupsIndirect(
        resources.dispatch,
        (pass * PASS_DISPATCH_WORDS + DISPATCH_DICE) * 4,
      )
    },
    shadow: shadowSide(resources, write),
    dispose() {
      resources.dispose()
    },
  }
}
export type Tessellation = ReturnType<typeof createTessellation>

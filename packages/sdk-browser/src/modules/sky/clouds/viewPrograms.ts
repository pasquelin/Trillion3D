import {
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../../../lighting/deferred/fullscreen.ts'
import { entryOf } from '../../../../../math/src/sequence/counts.ts'
import { airShapeKey, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import type { CloudSetup } from './cloudModes.ts'
import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { describeCompose, type ComposeKind } from './compose.ts'
import { describeDepthRange } from './depthRange.ts'
import type { DepthRangePass } from './depthRangeWgsl.ts'
import { describeReconstruct } from './reconstruct.ts'
import { createCloudHazePass } from './traceHaze.ts'
import { createCloudTracePass } from './trace.ts'
import { createCloudEmptySpacePass } from './emptySpace.ts'
import { cloudTraceKeyText, type CloudTraceKey } from './traceExtraLayout.ts'
import type { CloudFramePlan } from './reconstruct.ts'

/**
 * THE VIEW'S CLOUD PROGRAMS, made once for a device and a shape of the air and kept: the scene's
 * depth range passes, the tracing (one pipeline for each key of its options) with the pass that
 * builds its empty-space table, the haze pass, the
 * reconstruction (which lays the fog on the image for the translucent surfaces where the setup asks)
 * and the composition. Each is asked when first wanted,
 * off the frame, and a frame that finds it not compiled draws no cloud and is held on it. The
 * description of each is its module's (`depthRange.ts`, `trace.ts`, `traceHaze.ts`,
 * `reconstruct.ts`, `compose.ts`); nothing is decided here.
 */

/** A fullscreen pass: its layout and its pipeline. */
interface DrawnPass {
  readonly layout: GPUBindGroupLayout
  readonly pipeline: PreparedPipeline<GPURenderPipeline>
}

/** A pass of the air's family: the air's layout besides the cloud images'. */
interface ComposePass extends DrawnPass {
  readonly air: GPUBindGroupLayout
}

/** The reconstruction's pass: of the air's family where it lays the fog on its image. */
interface ReconstructPass extends DrawnPass {
  readonly air?: GPUBindGroupLayout
}

/** What a fullscreen pass is made of; `air` its first group's entries, where it has one. */
interface DrawnDescription {
  readonly code: string
  readonly fragmentEntry: string
  readonly entries: GPUBindGroupLayoutEntry[]
  readonly targets: GPUColorTargetState[]
  readonly air?: GPUBindGroupLayoutEntry[]
}

/** Placeholder sizes for the descriptions, whose programs do not depend on them. */
const SIZE = { width: 1, height: 1 }
const NOMINAL_PLAN = (setup: CloudSetup, history: boolean) =>
  ({
    setup,
    sizes: {
      reconstructed: { texture: SIZE, view: SIZE },
      traced: { texture: SIZE, view: SIZE },
    },
    history: history ? { texture: SIZE, view: SIZE } : null,
  }) as unknown as CloudFramePlan

function drawnPass(device: GPUDevice, label: string, d: DrawnDescription): ReconstructPass {
  const layout = device.createBindGroupLayout({ label, entries: d.entries })
  const air = d.air && device.createBindGroupLayout({ entries: d.air })
  const module = device.createShaderModule({ label, code: d.code })
  return {
    air,
    layout,
    pipeline: preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        air ? [air, layout] : layout,
        d.fragmentEntry,
        d.targets,
        label,
      ),
    ).ask(),
  }
}

/** The kinds of image, as a key: what makes one reconstruction or composition program. */
const reconstructKey = (s: CloudSetup, history: boolean) =>
  `${history}|${s.mode.index}|${s.minMaxDepth}|${s.boxConstraint}|${s.lateFogOnTranslucent}`
const composeKey = (s: CloudSetup, kind: ComposeKind) =>
  `${s.direct}|${s.upsampling}|${s.minMaxDepth}|${kind}`

/** The pass of the scene's depth range that writes `pass`'s texture. */
function depthRangePass(device: GPUDevice, pass: DepthRangePass) {
  const d = describeDepthRange(pass, SIZE, SIZE)
  return drawnPass(device, `Trillion3D cloud depth ${pass}`, {
    code: d.code,
    fragmentEntry: d.fragmentEntry,
    entries: d.entries,
    targets: [{ format: d.target }],
  })
}

/** The reconstruction of an image of `setup`, with or without a history, over the air's `localFog`; none
 *  for a setup that does not reconstruct. */
function reconstructPass(
  device: GPUDevice,
  setup: CloudSetup,
  history: boolean,
  localFog: boolean,
) {
  const d = describeReconstruct(NOMINAL_PLAN(setup, history), localFog)
  if (!d) return undefined
  return drawnPass(device, 'Trillion3D cloud reconstruction', {
    code: d.code,
    fragmentEntry: d.fragmentEntry,
    entries: d.entries,
    targets: d.targets.map((format) => ({ format })),
    air: d.air,
  })
}

/** The composition of an image of `setup` over the lit image: group 0 the air's, group 1 the cloud
 *  images'. */
function composePass(
  device: GPUDevice,
  setup: CloudSetup,
  localFog: boolean,
  kind: ComposeKind,
): ComposePass {
  const label = 'Trillion3D cloud composition'
  const d = describeCompose(SIZE, setup, localFog, kind)
  const [air, layout] = d.groups.map((entries) => device.createBindGroupLayout({ entries }))
  const module = device.createShaderModule({ label, code: d.code })
  return {
    air,
    layout,
    pipeline: preparedPipeline(
      device,
      fullscreenDescriptor(device, module, [air, layout], d.fragmentEntry, [d.target]),
    ).ask(),
  }
}

function createCloudViewPrograms(
  device: GPUDevice,
  shape: AirShape,
  failed: (error: unknown) => void,
) {
  const ranges = new Map<string, DrawnPass>()
  const traces = new Map<string, ReturnType<typeof createCloudTracePass>>()
  const emptySpaces = new Map<string, ReturnType<typeof createCloudEmptySpacePass>>()
  const reconstructions = new Map<string, ReconstructPass | undefined>()
  const compositions = new Map<string, ComposePass>()
  let haze: ReturnType<typeof createCloudHazePass> | undefined
  return {
    shape,
    /** The linear, clamped sampler the reconstruction and the composition read the images through. */
    sampler: postSamplers(device).clamped,
    depthRange: (pass: DepthRangePass) => entryOf(ranges, pass, () => depthRangePass(device, pass)),
    /** The tracing of the options `key`. */
    trace: (key: CloudTraceKey) =>
      entryOf(traces, cloudTraceKeyText(key), () =>
        createCloudTracePass(device, failed, key, shape),
      ),
    /** The pass that builds the empty-space table, with the corners option `corners`. */
    emptySpace: (corners: boolean) =>
      entryOf(emptySpaces, String(corners), () =>
        createCloudEmptySpacePass(device, failed, corners, shape),
      ),
    /** The haze pass. */
    get haze() {
      return (haze ??= createCloudHazePass(device, failed, shape))
    },
    reconstruct: (setup: CloudSetup, history: boolean) =>
      entryOf(reconstructions, reconstructKey(setup, history), () =>
        reconstructPass(device, setup, history, shape.localFog),
      ),
    compose: (setup: CloudSetup, kind: ComposeKind = 'over') =>
      entryOf(compositions, composeKey(setup, kind), () =>
        composePass(device, setup, shape.localFog, kind),
      ),
  }
}

export type CloudViewPrograms = ReturnType<typeof createCloudViewPrograms>

const byDevice = new WeakMap<GPUDevice, Map<string, CloudViewPrograms>>()

/** The programs of `device` for `shape`, made on the first ask. */
export function cloudViewProgramsOf(
  device: GPUDevice,
  shape: AirShape,
  failed: (error: unknown) => void,
) {
  let shapes = byDevice.get(device)
  if (!shapes) byDevice.set(device, (shapes = new Map()))
  const key = airShapeKey(shape)
  let made = shapes.get(key)
  if (!made) shapes.set(key, (made = createCloudViewPrograms(device, shape, failed)))
  return made
}

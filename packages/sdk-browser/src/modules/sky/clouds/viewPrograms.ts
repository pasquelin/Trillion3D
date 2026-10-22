import {
  fullscreenDescriptor,
  preparedPipeline,
  type PreparedPipeline,
} from '../../../lighting/deferred/fullscreen.ts'
import { airShapeKey, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import type { CloudSetup } from './cloudModes.ts'
import { RECONSTRUCT_SAMPLER } from './reconstructLayout.ts'
import { describeCompose } from './compose.ts'
import { describeDepthRange } from './depthRange.ts'
import type { DepthRangePass } from './depthRangeWgsl.ts'
import { describeReconstruct } from './reconstruct.ts'
import { createCloudHazePass } from './traceHaze.ts'
import { createCloudTracePass } from './trace.ts'
import { cloudTraceKeyText, type CloudTraceKey } from './traceExtraLayout.ts'
import type { CloudFramePlan } from './reconstruct.ts'

/**
 * THE VIEW'S CLOUD PROGRAMS, made once for a device and a shape of the air and kept: the scene's
 * depth range passes, the tracing (one pipeline for each key of its options), the haze pass, the
 * reconstruction and the composition (one for each kind of image). Each is asked when first wanted,
 * off the frame, and a frame that finds it not compiled draws no cloud and is held on it. The
 * description of each is its module's (`depthRange.ts`, `trace.ts`, `traceHaze.ts`,
 * `reconstruct.ts`, `compose.ts`); nothing is decided here.
 */

/** A fullscreen pass: its layout and its pipeline. */
interface DrawnPass {
  readonly layout: GPUBindGroupLayout
  readonly pipeline: PreparedPipeline<GPURenderPipeline>
}

/** The composition's pass: the air's layout besides the cloud images'. */
interface ComposePass extends DrawnPass {
  readonly air: GPUBindGroupLayout
}

/** What a fullscreen pass is made of. */
interface DrawnDescription {
  readonly code: string
  readonly fragmentEntry: string
  readonly entries: GPUBindGroupLayoutEntry[]
  readonly targets: GPUColorTargetState[]
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

function drawnPass(device: GPUDevice, label: string, d: DrawnDescription): DrawnPass {
  const layout = device.createBindGroupLayout({ label, entries: d.entries })
  const module = device.createShaderModule({ label, code: d.code })
  return {
    layout,
    pipeline: preparedPipeline(
      device,
      fullscreenDescriptor(device, module, layout, d.fragmentEntry, d.targets, label),
    ).ask(),
  }
}

/** The kinds of image, as a key: what makes one reconstruction or composition program. */
const reconstructKey = (s: CloudSetup, history: boolean) =>
  `${history}|${s.mode.index}|${s.minMaxDepth}|${s.boxConstraint}`
const composeKey = (s: CloudSetup) => `${s.direct}|${s.upsampling}|${s.minMaxDepth}`

/** The value `make` makes for `key`, made on the first ask and kept in `held`. */
function memo<V>(held: Map<string, V>, key: string, make: () => V) {
  let value = held.get(key)
  if (value === undefined) held.set(key, (value = make()))
  return value
}

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

/** The reconstruction of an image of `setup`, with or without a history; none for a setup that does
 *  not reconstruct. */
function reconstructPass(device: GPUDevice, setup: CloudSetup, history: boolean) {
  const d = describeReconstruct(NOMINAL_PLAN(setup, history))
  if (!d) return undefined
  return drawnPass(device, 'Trillion3D cloud reconstruction', {
    code: d.code,
    fragmentEntry: d.fragmentEntry,
    entries: d.entries,
    targets: d.targets.map((format) => ({ format })),
  })
}

/** The composition of an image of `setup` over the lit image: group 0 the air's, group 1 the cloud
 *  images'. */
function composePass(device: GPUDevice, setup: CloudSetup): ComposePass {
  const d = describeCompose(SIZE, setup)
  const [air, layout] = d.groups.map((entries) => device.createBindGroupLayout({ entries }))
  const module = device.createShaderModule({ label: 'Trillion3D cloud composition', code: d.code })
  return {
    air,
    layout,
    pipeline: preparedPipeline(
      device,
      fullscreenDescriptor(device, module, [air, layout], d.fragmentEntry, [d.target]),
    ).ask(),
  }
}

export function createCloudViewPrograms(
  device: GPUDevice,
  shape: AirShape,
  failed: (error: unknown) => void,
) {
  const ranges = new Map<string, DrawnPass>()
  const traces = new Map<string, ReturnType<typeof createCloudTracePass>>()
  const reconstructions = new Map<string, DrawnPass | undefined>()
  const compositions = new Map<string, ComposePass>()
  let haze: ReturnType<typeof createCloudHazePass> | undefined
  return {
    shape,
    /** The linear, clamped sampler the reconstruction and the composition read the images through. */
    sampler: device.createSampler(RECONSTRUCT_SAMPLER),
    depthRange: (pass: DepthRangePass) => memo(ranges, pass, () => depthRangePass(device, pass)),
    /** The tracing of the options `key`. */
    trace: (key: CloudTraceKey) =>
      memo(traces, cloudTraceKeyText(key), () => createCloudTracePass(device, failed, key, shape)),
    /** The haze pass. */
    get haze() {
      return (haze ??= createCloudHazePass(device, failed, shape))
    },
    reconstruct: (setup: CloudSetup, history: boolean) =>
      memo(reconstructions, reconstructKey(setup, history), () =>
        reconstructPass(device, setup, history),
      ),
    compose: (setup: CloudSetup) =>
      memo(compositions, composeKey(setup), () => composePass(device, setup)),
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

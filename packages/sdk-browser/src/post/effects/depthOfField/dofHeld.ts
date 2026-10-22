import type { DepthOfField } from '../../../../../sdk-core/src/world/effect/depthOfField.ts'
import {
  DEPTH_OF_FIELD_RULES,
  type DepthOfFieldValues,
} from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { settingsDiffer } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { ResolveFrame } from '../webgpuKinds.ts'
import { dofSteps, type DofSteps } from './dofEncode.ts'
import { makeGroups, type DofGroups } from './dofGroups.ts'
import { DOF_PARAMS_BYTES, DOF_STEP_BYTES } from './dofLayout.ts'
import {
  dilateStep,
  reduceStep,
  writeDofParams,
  writeDofStep,
  type DofStepInput,
} from './dofParams.ts'
import { planDepthOfField, reducePasses, type DofPlan } from './dofPlan.ts'
import type { DofPrograms } from './dofPrograms.ts'
import type { DofTargets } from './dofTargets.ts'

/**
 * WHAT ONE DEPTH OF FIELD OF THE CHAIN HOLDS between frames, and how it is kept up to date: its
 * uniforms, its plan — made again only when what it is made from moves —, and the groups and steps
 * made for the resources they name.
 */

/** A uniform and the words it is written from. */
type Uniform = { buffer: GPUBuffer; words: ReturnType<typeof wordViews> }

/** A uniform of `bytes` bytes. */
const uniformOf = (device: GPUDevice, bytes: number): Uniform => ({
  buffer: device.createBuffer({
    label: `${DEPTH_OF_FIELD_PASS} uniform`,
    size: bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }),
  words: wordViews(new ArrayBuffer(bytes)),
})

/** What one depth of field of the chain holds: its uniforms, the plan it last drew, what that plan was
 *  made from — the pass's settings, the view's, and seven numbers: the image's size and its textures',
 *  the camera's field and nearest depth —, the steps' inputs of the plan, and the groups and steps made for
 *  the resources they name. */
export type Held = {
  params: Uniform
  steps: Uniform[]
  plan?: DofPlan
  volume?: unknown
  settings?: DepthOfFieldValues
  from: Float64Array
  inputs: DofStepInput[]
  /** What the groups were made for: the targets' generation, the image, its depth and the output. */
  named: unknown[]
  groups?: DofGroups
  made?: DofSteps
  madeStale: boolean
}

/** The numbers a plan is made from, refilled by each ask: an image allocates none. */
const NOW = new Float64Array(7)

/** The plan of the image for `held`, kept while what it is made from holds. */
export function planOf(held: Held, pass: DepthOfField, frame: ResolveFrame) {
  const { size, extent, camera } = frame
  const volume = pass.values
  NOW[0] = size[0]
  NOW[1] = size[1]
  NOW[2] = extent[0]
  NOW[3] = extent[1]
  NOW[4] = camera.projection[0]
  NOW[5] = camera.projection[5]
  NOW[6] = camera.near
  if (
    held.plan &&
    held.volume === volume &&
    held.settings &&
    !settingsDiffer(DEPTH_OF_FIELD_RULES, held.settings, frame.depthOfField) &&
    NOW.every((value, at) => value === held.from[at])
  )
    return held.plan
  const plan = planDepthOfField({
    volume,
    settings: frame.depthOfField,
    image: [size[0], size[1]],
    extent: [extent[0], extent[1]],
    cotHorizontal: NOW[4],
    cotVertical: NOW[5],
    near: camera.near,
  })
  held.plan = plan
  held.volume = volume
  held.settings = { ...frame.depthOfField }
  held.from.set(NOW)
  held.inputs = [
    ...plan.dilations.map((d) => dilateStep(d.multiplier)),
    ...reducePasses(plan.mips).map(({ from }) => reduceStep(plan, from)),
  ]
  held.groups = held.made = undefined
  return plan
}

/** A new `Held`: its uniform, and none of the rest. */
export const newHeld = (device: GPUDevice): Held => ({
  params: uniformOf(device, DOF_PARAMS_BYTES),
  steps: [],
  from: new Float64Array(NOW.length),
  inputs: [],
  named: [],
  madeStale: false,
})

/** Bytes of the uniforms `held` keeps. */
export const heldBytes = (held: Held) => DOF_PARAMS_BYTES + held.steps.length * DOF_STEP_BYTES

/** Frees the uniforms of `held`, once the frame that may name them is submitted. */
export function dropHeld(device: GPUDevice, held: Held) {
  retire(device, held.params.buffer)
  for (const { buffer } of held.steps) retire(device, buffer)
}

/** What the groups and steps are made over: the programs and the targets of the kind. */
export interface DofKit {
  readonly device: GPUDevice
  readonly programs: DofPrograms
  readonly targets: DofTargets
}

/** The groups and steps of `mine` over the targets, made again where what they name moved. */
export function stepsOf(
  kit: DofKit,
  mine: Held,
  frame: ResolveFrame,
  input: GPUTextureView,
  output: GPUTextureView,
) {
  const { device, programs, targets } = kit
  const plan = mine.plan!
  const stale = targets.tablesStale(plan.bokeh)
  const { named } = mine
  if (
    !mine.groups ||
    named[0] !== targets.generation ||
    named[1] !== input ||
    named[2] !== frame.depth ||
    named[3] !== output
  ) {
    mine.groups = makeGroups({
      device,
      programs,
      plan,
      images: targets.images,
      luts: targets.luts,
      buffers: targets.buffers,
      params: mine.params.buffer,
      steps: mine.steps.map(({ buffer }) => buffer),
      input,
      depth: frame.depth,
      output,
    })
    named.splice(0, 4, targets.generation, input, frame.depth, output)
    mine.made = undefined
  }
  if (!mine.made || mine.madeStale !== stale) {
    mine.made = dofSteps(plan, mine.groups, targets.images, programs, stale)
    mine.madeStale = stale
  }
  return mine.made
}

/** Writes `mine`'s uniform, and the steps' of its dilations then its reductions; `rank` is the
 *  image's rank among eight. */
export function writeUniforms(
  device: GPUDevice,
  mine: Held,
  frame: ResolveFrame,
  pass: DepthOfField,
  rank: number,
) {
  const { params } = mine
  writeDofParams(params.words.f, params.words.u, {
    plan: mine.plan!,
    settings: frame.depthOfField,
    volume: pass.values,
    render: frame.render,
    extent: frame.extent,
    projection: frame.camera.projection,
    perspective: frame.camera.perspective,
    exposure: frame.camera.exposure,
    frame: rank,
  })
  writeChanged(device, params.buffer, params.words.u, 0, params.words.u.length)
  while (mine.steps.length < mine.inputs.length) mine.steps.push(uniformOf(device, DOF_STEP_BYTES))
  mine.inputs.forEach((step, at) => {
    const { words, buffer } = mine.steps[at]
    writeDofStep(words.f, words.u, step)
    writeChanged(device, buffer, words.u, 0, words.u.length)
  })
}

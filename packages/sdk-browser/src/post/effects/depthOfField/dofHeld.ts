import type { DepthOfField } from '../../../../../sdk-core/src/world/effect/depthOfField.ts'
import {
  DEPTH_OF_FIELD_RULES,
  type DepthOfFieldValues,
} from '../../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { settingsDiffer } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { ResolveFrame } from '../webgpuKinds.ts'
import { dofSteps, type DofSteps } from './dofEncode.ts'
import { makeGroups, type DofGroups } from './dofGroups.ts'
import type { SetupImages } from './dofImages.ts'
import { dropHistory, historyBytes } from './dofHistory.ts'
import { DOF_PARAMS_BYTES, DOF_STEP_BYTES } from './dofLayout.ts'
import {
  dilateStep,
  reduceStep,
  writeDofParams,
  writeDofStep,
  type DofParamsInput,
  type DofStepInput,
} from './dofParams.ts'
import { planDepthOfField, reducePasses, type DofPlan } from './dofPlan.ts'
import type { DofPrograms } from './dofPrograms.ts'
import { createDofTargets, type DofTargets } from './dofTargets.ts'

/**
 * WHAT ONE DEPTH OF FIELD OF THE CHAIN HOLDS between frames, and how it is kept up to date: its
 * uniforms, its plan — made again only when what it is made from moves —, its images (`dofTargets.ts`) and
 * its setup's history (`dofHistory.ts`), and the groups and steps made for the resources they name — the
 * groups kept while the lens alone moves —, two sets where the accumulated setup's two images take turns.
 */

/** A uniform of `bytes` bytes. */
const uniformOf = (device: GPUDevice, bytes: number) =>
  uniformBlock(device, `${DEPTH_OF_FIELD_PASS} uniform`, bytes)

/** The groups and steps made for one identity of what they name. */
interface Made {
  groups?: DofGroups
  steps?: DofSteps
  /** Whether the bokeh tables were to be built when the steps were made. */
  stale: boolean
  /** Whether the steps' recombine reads layers drawn smaller than the image. */
  reduced?: boolean
}

/** What one depth of field of the chain holds: its uniforms, the plan it last drew and what that plan
 *  was made from — the pass's lens, the view's settings and ten numbers: the image's size and its
 *  textures', the camera's field and nearest depth, whether the image is accumulated in time, the
 *  display's size —, the steps' inputs of the plan, the groups and steps made for the resources they
 *  name, its images, buffers and tables, and the setup it accumulated in time. */
export type Held = {
  params: UniformBlock
  /** The images, buffers and tables of its plan: its own, so that two depths of field with another
   *  plan do not remake them by turns. */
  targets: DofTargets
  dilations: UniformBlock[]
  reductions: UniformBlock[]
  plan?: DofPlan
  volume?: unknown
  settings?: DepthOfFieldValues
  from: Float64Array
  inputs: { dilate: DofStepInput[]; reduce: DofStepInput[] }
  /** What the groups name — the targets' generation, the image, its depth, the motion, the output,
   *  which accumulated setup this image writes and the pair of them —, two held, one for each of those. */
  identity: ReturnType<typeof createWebgpuBindIdentity>
  made: Made[]
  /** What the groups were made for (`DofPlan.groups`). */
  groups: string
  /** The two images the setup is accumulated in, where the plan accumulates it, and the size they were
   *  made for; each image writes one (`parity`, 0 or 1) and reads the other as history. */
  stable?: readonly [SetupImages, SetupImages]
  stableKey: string
  parity: number
  /** Whether the last image wrote the accumulated setup the next reads as history, and the display's
   *  size it was drawn for: the history lies in a rectangle of that size of its images. */
  history: boolean
  historyDisplay: [number, number]
}

/** The numbers a plan is made from, refilled by each ask: an image allocates none. */
const NOW = new Float64Array(10)

/** The plan of the image for `held`, kept while what it is made from holds. */
export function planOf(
  held: Held,
  pass: DepthOfField,
  frame: ResolveFrame,
  settings: DepthOfFieldValues,
) {
  const { size, extent, camera, display } = frame
  const temporal = frame.temporal.active
  const volume = pass.values
  NOW[0] = size[0]
  NOW[1] = size[1]
  NOW[2] = extent[0]
  NOW[3] = extent[1]
  NOW[4] = camera.projection[0]
  NOW[5] = camera.projection[5]
  NOW[6] = camera.near
  NOW[7] = temporal ? 1 : 0
  NOW[8] = temporal ? display[0] : 0
  NOW[9] = temporal ? display[1] : 0
  if (
    held.plan &&
    held.volume === volume &&
    held.settings &&
    !settingsDiffer(DEPTH_OF_FIELD_RULES, held.settings, settings) &&
    sameValues(NOW, held.from)
  )
    return held.plan
  const plan = planDepthOfField({
    volume,
    settings,
    image: [size[0], size[1]],
    extent: [extent[0], extent[1]],
    display: [display[0], display[1]],
    cotHorizontal: NOW[4],
    cotVertical: NOW[5],
    near: camera.near,
    temporal,
  })
  held.plan = plan
  held.volume = volume
  held.settings = { ...settings }
  held.from.set(NOW)
  held.inputs = {
    dilate: plan.dilations.map((d) => dilateStep(d.multiplier)),
    reduce: reducePasses(plan.mips).map(({ from }) => reduceStep(plan, from)),
  }
  // The groups name what the plan's key and the dilations, tables and shapes say: a lens animated image
  // by image keeps them, and remakes the steps (their sizes and constants) alone.
  if (held.groups === plan.groups) for (const made of held.made) made.steps = undefined
  else {
    held.identity.clear()
    held.made.length = 0
    held.groups = plan.groups
  }
  return plan
}

/** A new `Held`: its uniform, and none of the rest. */
export const newHeld = (device: GPUDevice): Held => ({
  params: uniformOf(device, DOF_PARAMS_BYTES),
  targets: createDofTargets(device),
  dilations: [],
  reductions: [],
  from: new Float64Array(NOW.length),
  inputs: { dilate: [], reduce: [] },
  identity: createWebgpuBindIdentity(2),
  made: [],
  groups: '',
  stableKey: '',
  parity: 0,
  history: false,
  historyDisplay: [0, 0],
})

/** Bytes of the uniforms, the images and the history `held` keeps. */
export const heldBytes = (held: Held) =>
  DOF_PARAMS_BYTES +
  (held.dilations.length + held.reductions.length) * DOF_STEP_BYTES +
  held.targets.bytes +
  historyBytes(held)

/** Frees the uniforms and the history of `held`, once the frame that may name them is submitted. */
export function dropHeld(device: GPUDevice, held: Held) {
  retire(device, held.params.buffer)
  for (const { buffer } of [...held.dilations, ...held.reductions]) retire(device, buffer)
  held.targets.release()
  dropHistory(device, held)
}

/** What the groups and steps are made over: the programs of the kind. */
interface DofKit {
  readonly device: GPUDevice
  readonly programs: DofPrograms
}

/** The groups and steps of `mine` over the targets, made again where what they name moved. */
export function stepsOf(
  kit: DofKit,
  mine: Held,
  frame: ResolveFrame,
  input: GPUTextureView,
  output: GPUTextureView,
  reduced: boolean,
) {
  const { device, programs } = kit
  const { targets } = mine
  const plan = mine.plan!
  const stale = targets.tablesStale(plan.bokeh)
  const { next } = mine.identity
  next[0] = targets.generation
  next[1] = input
  next[2] = frame.depth
  next[3] = plan.temporal ? frame.vectors : undefined
  next[4] = output
  next[5] = mine.parity
  next[6] = mine.stable
  const moved = mine.identity.moved()
  const made = (mine.made[mine.identity.slot] ??= { stale })
  if (moved || !made.groups) {
    made.groups = makeGroups({
      device,
      programs,
      plan,
      images: targets.images,
      stable: mine.stable,
      luts: targets.luts,
      buffers: targets.buffers,
      params: mine.params.buffer,
      dilations: mine.dilations.map(({ buffer }) => buffer),
      reductions: mine.reductions.map(({ buffer }) => buffer),
      input,
      depth: frame.depth,
      vectors: next[3] as GPUTextureView | undefined,
      output,
      parity: mine.parity,
    })
    made.steps = undefined
  }
  if (!made.steps || made.stale !== stale || !!made.reduced !== reduced) {
    made.steps = dofSteps(plan, made.groups, targets.images, programs, stale, reduced)
    made.stale = stale
    made.reduced = reduced
  }
  return made as Made & { steps: DofSteps }
}

/** Brings `uniforms` to at least `count` step uniforms. */
function grow(device: GPUDevice, uniforms: UniformBlock[], count: number) {
  while (uniforms.length < count) uniforms.push(uniformOf(device, DOF_STEP_BYTES))
}

/** Writes `uniform` the step `step` holds. */
function writeStep(uniform: UniformBlock, step: DofStepInput) {
  writeDofStep(uniform.words.f, uniform.words.u, step)
  uniform.send()
}

/** What the uniform is written from, refilled by each image: an image allocates none. */
const INPUT = {} as { -readonly [K in keyof DofParamsInput]: DofParamsInput[K] }

/** Writes `mine`'s uniform, and the steps' of its dilations then its reductions; `cut` says whether the
 *  setup's history describes nothing. */
export function writeUniforms(
  device: GPUDevice,
  mine: Held,
  frame: ResolveFrame,
  pass: DepthOfField,
  settings: DepthOfFieldValues,
  cut: boolean,
) {
  const { params } = mine
  const { temporal } = frame
  INPUT.plan = mine.plan!
  INPUT.settings = settings
  INPUT.volume = pass.values
  INPUT.render = frame.render
  INPUT.extent = frame.extent
  INPUT.display = frame.display
  INPUT.historyDisplay = mine.historyDisplay
  INPUT.projection = frame.camera.projection
  INPUT.perspective = frame.camera.perspective
  INPUT.exposure = frame.camera.exposure
  INPUT.frame = temporal.slot
  INPUT.jitter = temporal.jitter
  INPUT.cut = cut
  writeDofParams(params.words.f, params.words.u, INPUT)
  params.send()
  const { dilate, reduce } = mine.inputs
  grow(device, mine.dilations, dilate.length)
  grow(device, mine.reductions, reduce.length)
  for (let at = 0; at < dilate.length; at++) writeStep(mine.dilations[at], dilate[at])
  for (let at = 0; at < reduce.length; at++) writeStep(mine.reductions[at], reduce[at])
}

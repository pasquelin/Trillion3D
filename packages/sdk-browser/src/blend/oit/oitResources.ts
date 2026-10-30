import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { grantPending, startGrant, type DeviceGrant } from '../../gpu/core/errorScope.ts'
import { ledgerReplacing } from '../../gpu/core/deviceLedger.ts'
import { grantedPool } from '../../geometry/residency/poolGrants.ts'
import { createUniformPool } from '../../gpu/core/encoderUniforms.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { grantsStageStorage } from '../../gpu/core/stageStorage.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { ownedReadbacks } from '../../gpu/core/ownedReadback.ts'
import { dualSource } from '../stagePipelines.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { COLOUR_ONLY } from '../../materials/surface/materialBlending.ts'
import { OIT_COMBINE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { OIT_COMBINE_DUAL_WGSL, OIT_COMBINE_WGSL } from './oitWgsl.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  OIT_GLOBAL_DEMAND,
  OIT_PARAMS,
  OIT_POOL_FLOOR,
  oitHeadWords,
  oitParams,
  oitPoolDrawer,
  oitRefusalHolds,
  type OitPoolDraw,
  type OitRefusal,
  oitNodesFitting,
  oitPoolCeiling,
  oitPoolMinimum,
  oitPoolWords,
  oitSamplesFitting,
  oitSplit,
} from './oitLayout.ts'

/**
 * WHAT THE SORTED TRANSLUCENCY NEEDS OF THE DEVICE: the fragment stage of the blend programs binds eight storage buffers (the engine's
 * guarantee), and the two buffers the fragments are collected in (the head and the pool, `oitLayout.ts`) are a ninth and a tenth. A device that
 * grants fewer keeps every layer blended in the order it is drawn, and the programs are made without the stage that collects.
 */
const OIT_STORAGE_BUFFERS = 10
export const grantsOit = (device: Pick<GPUDevice, 'limits'>) =>
  grantsStageStorage(device, 'fragment', OIT_STORAGE_BUFFERS)

/** Whether the programs of a session hold the stage that collects the layers a pixel sorts: `wanted` (the project switch `oitSortedPixels`, and no diagnostic variant where the caller has one), on a device that grants the buffer. The one answer the programs, their layouts and the groups drawn on them ask. */
export const oitProgramsWanted = (wanted: boolean, device: Pick<GPUDevice, 'limits'> | undefined) =>
  wanted && !!device && grantsOit(device)

/** The parameters are read from a uniform buffer of the pass's own (`createUniformPool`: one per pass of an encoder, given back when the encoder is submitted or dropped). */
const PARAMS_BINDING = { minBindingSize: OIT_PARAMS.words * 4 }

/** The layouts of the buffer: written by the fragments that collect (with the parameters and the depth they test against), written by the pass that combines them (the figures of a pixel). */
export const oitLayouts = oncePerDevice((device: GPUDevice) => {
  const combine = device.createBindGroupLayout({
    label: 'Trillion3D sorted translucency combine',
    entries: [
      computeBufferEntry(0, 'storage', GPUShaderStage.FRAGMENT),
      computeUniformEntry(1, PARAMS_BINDING, GPUShaderStage.FRAGMENT),
      computeBufferEntry(3, 'storage', GPUShaderStage.FRAGMENT),
    ],
  })
  return {
    collect: device.createBindGroupLayout({
      label: 'Trillion3D sorted translucency collect',
      entries: [
        computeBufferEntry(0, 'storage', GPUShaderStage.FRAGMENT),
        computeUniformEntry(1, PARAMS_BINDING, GPUShaderStage.FRAGMENT),
        computeTextureEntry(2, 'depth', '2d', GPUShaderStage.FRAGMENT),
        computeBufferEntry(3, 'storage', GPUShaderStage.FRAGMENT),
      ],
    }),
    combine,
    /** The collect group's layout of a device that folds the depth into the packed table (`ObjectShadowAtlasRead` `'foldedDepth'`, `foldOitDepth`): the head buffer, the parameters and the pool buffer, no depth texture, which are the combination's three bindings. */
    foldedCollect: combine,
  }
})

/** The alpha the combination writes replaces the target's: the reference's separate pass writes its mean transmittance in place of the alpha. */
const ALPHA_REPLACED: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'zero', operation: 'add' }
/** The dual-source draw: the light plus the target multiplied, per channel, by the second source (the transmittance). */
const LIGHT_AND_SCALE: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'src1', operation: 'add' }
/** The first of the two draws without dual-source blending: the target's colour multiplied by the transmittance per channel, its alpha left. */
const SCALED: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }
/** The second: the light added, the alpha replaced. */
const ADDED: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one', operation: 'add' }

/**
 * The combination's pipelines, once a device, in the order they are drawn: on a device granted dual-source blending one draw (the light added to what
 * the target holds multiplied per channel by the transmittance, the alpha replaced), else two (`oitScale`, then `oitLight`).
 */
export const oitCombinePipelines = oncePerDevice((device: GPUDevice) => {
  const made = (module: GPUShaderModule, entry: string, blend: GPUBlendState, writeMask?: number) =>
    preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        oitLayouts(device).combine,
        entry,
        [{ format: HDR_FORMAT, blend, ...(writeMask !== undefined && { writeMask }) }],
        OIT_COMBINE_PASS,
      ),
    )
  if (dualSource(device)) {
    const module = device.createShaderModule({
      label: OIT_COMBINE_PASS,
      code: OIT_COMBINE_DUAL_WGSL,
    })
    return [made(module, 'oitCombine', { color: LIGHT_AND_SCALE, alpha: ALPHA_REPLACED })]
  }
  const module = device.createShaderModule({ label: OIT_COMBINE_PASS, code: OIT_COMBINE_WGSL })
  return [
    made(module, 'oitScale', { color: SCALED, alpha: ALPHA_REPLACED }, COLOUR_ONLY),
    made(module, 'oitLight', { color: ADDED, alpha: ALPHA_REPLACED }),
  ]
})

/** Whether every combination pipeline is compiled: none while any of them compiles. */
export const oitCombineCompiled = (device: GPUDevice) =>
  oitCombinePipelines(device).every((pipeline) => pipeline.get() !== undefined)

/**
 * WHAT THE VIEW KEEPS ACROSS A REGROWTH OF ITS BUFFERS: the nodes the images before asked of the pool, counted by the fragments and read back a
 * few images late, and the uniform pool of the parameters. An image draws the layers in as many passes as it needs on the same encoder, each counting its
 * nodes from zero: the combination of a pass keeps the largest count in a word of the head buffer (`OIT_GLOBAL_DEMAND`), which each pass copies to the
 * staging buffer, so that the demand is the largest of the passes' and not the last one's, however many they are. The count of a pass stops at the pool
 * it was drawn on (a fragment takes a node only while the count is under the pool), so a demand that reaches the pool means "at least this much".
 */
interface OitOwn {
  /** The parameters' uniform buffers, one for each pass of an encoder: given back when the encoder is submitted or dropped. */
  uniforms: ReturnType<typeof createUniformPool>
  /** The words of the parameters, written to the pass's buffer. */
  words: ReturnType<typeof wordViews>
  /** The encoder whose passes are being prepared, and how many of them have copied their demand: a new encoder is a new image, whether the last one was submitted or not. */
  encoder: WeakRef<GPUCommandEncoder> | undefined
  passes: number
  /** The images prepared: the clock the refusals are timed by. */
  frame: number
  /** The nodes the images before asked of the pool at most (read back). */
  nodes: number
  /** The frames in a row the demand stayed under a quarter of the pool. */
  quiet: number
  /** The frames in a row the pool was spent (the count of nodes reached it: the sorting wants more than it holds, `oitRefusalHolds`). */
  saturated: number
  /** What the device refused last (`oitRefusalHolds`), and the limits it sets while it holds: the nodes the pool may hold at most, the most samples. */
  refusal: OitRefusal | undefined
  cap: number
  maxSamples: number
  /** What the device granted, adopted at the start of the next image. */
  granted: Grant | undefined
}
/** What the device granted: a pool, with the head buffer where the buffers are made whole, for the shape named; no pool where the device grants none larger than the one held (a growth). */
interface Grant {
  readonly head: GPUBuffer | undefined
  readonly pool: GPUBuffer | undefined
  readonly pixels: number
  readonly asked: number
  readonly samples: number
  readonly low: number
  readonly nodes: number
  readonly fitting: number
  destroy(): void
}
/** The ask of a view in flight, one at a time: `dead` once the view was given back (`disposeOit`), the grant landing is then destroyed and counts for nothing; `grant` the frames wait for where the view holds no buffers. */
interface Flight {
  dead: boolean
  grant: DeviceGrant | undefined
}
const asks = new WeakMap<object, Flight>()
const DEMAND_READBACKS = 2
/** The frames the demand must stay under a quarter of the pool before the pool is made smaller. */
const SHRINK_FRAMES = 60
const demands = ownedReadbacks<OitOwn>(
  { label: 'oit.demand', bytes: 4, count: DEMAND_READBACKS },
  () => ({
    uniforms: createUniformPool('Trillion3D sorted translucency parameters', OIT_PARAMS.words * 4),
    words: wordViews(new ArrayBuffer(OIT_PARAMS.words * 4)),
    encoder: undefined,
    passes: 0,
    frame: 0,
    nodes: 0,
    quiet: 0,
    saturated: 0,
    refusal: undefined,
    cap: Infinity,
    maxSamples: Infinity,
    granted: undefined,
  }),
  (own, mapped) => {
    own.nodes = new Uint32Array(mapped, 0, 1)[0]!
  },
)
type OwnedOit = ReturnType<typeof demands.of>

/** The buffers of an image and what binds them: laid out for `pixels` pixels (the targets' extent, whatever size an image draws at) keeping `samples` fragments, `low` of their slots in the head buffer, with a pool of `nodes` nodes. */
export interface OitBuffers {
  /** The head buffer: the globals, the headers, the first `low` slots. */
  readonly buffer: GPUBuffer
  /** The pool buffer: the other slots, the pool, the figures of a pixel; made again when the pool grows or shrinks. */
  pool: GPUBuffer
  /** The groups of the passes, by the parameters' buffer each reads; forgotten when the pool or the depth changes. */
  groups: WeakMap<GPUBuffer, OitGroups>
  /** The depth view the collect groups bind, none where the depth is folded into the packed table. */
  depth: GPUTextureView | undefined
  readonly pixels: number
  /** The samples asked, which the buffers were made for. */
  readonly asked: number
  /** The samples the pixels keep: the asked ones, or fewer where the device cannot allocate the buffers for them. */
  readonly samples: number
  /** The slots of a pixel the head buffer holds. */
  readonly low: number
  nodes: number
  /** The nodes the pool could hold at most on this device for these pixels and samples. */
  readonly fitting: number
  readonly own: OwnedOit
}
/** The groups of a pass: collecting and combining. */
interface OitGroups {
  readonly collect: GPUBindGroup
  readonly combine: GPUBindGroup
}

const held = new WeakMap<object, OitBuffers>()

const groupsOf = (device: GPUDevice, buffers: OitBuffers, params: GPUBuffer): OitGroups => {
  const entry = (binding: number, buffer: GPUBuffer, size?: number) => ({
    binding,
    resource: { buffer, ...(size && { size }) },
  })
  const { depth } = buffers
  return {
    collect: device.createBindGroup({
      layout: depth ? oitLayouts(device).collect : oitLayouts(device).foldedCollect,
      entries: [
        entry(0, buffers.buffer),
        entry(1, params, OIT_PARAMS.words * 4),
        ...(depth ? [{ binding: 2, resource: depth }] : []),
        entry(3, buffers.pool),
      ],
    }),
    combine: device.createBindGroup({
      layout: oitLayouts(device).combine,
      entries: [
        entry(0, buffers.buffer),
        entry(1, params, OIT_PARAMS.words * 4),
        entry(3, buffers.pool),
      ],
    }),
  }
}

/**
 * The parameters of the next pass of the image `encoder` carries, written to a uniform buffer of that pass (`createUniformPool`: each pass of each
 * open encoder its own, given back when the encoder is submitted or dropped, so nothing counts the passes), and the groups that read it, made once
 * for the buffer and kept while the pool and the depth view are.
 */
export function oitPassGroups(
  device: GPUDevice,
  buffers: OitBuffers,
  encoder: GPUCommandEncoder,
  depth: GPUTextureView | undefined,
  width: number,
  threshold: number,
  cursor: number,
) {
  const { own } = buffers
  if (buffers.depth !== depth) {
    buffers.depth = depth
    buffers.groups = new WeakMap()
  }
  const { buffer } = own.uniforms.next(device, encoder)
  oitParams(
    own.words,
    width,
    buffers.pixels,
    buffers.samples,
    buffers.low,
    buffers.nodes,
    threshold,
    cursor,
  )
  device.queue.writeBuffer(buffer, 0, own.words.u)
  let groups = buffers.groups.get(buffer)
  if (!groups) buffers.groups.set(buffer, (groups = groupsOf(device, buffers, buffer)))
  return groups
}

type Diagnose = Parameters<typeof grantedPool>[0]['diagnose']

/** The warnings of a device, each said once. */
const said = { samples: new WeakSet<GPUDevice>(), memory: new WeakSet<GPUDevice>() }
function sayOnce(device: GPUDevice, kind: keyof typeof said, text: string) {
  if (said[kind].has(device)) return
  said[kind].add(device)
  console.warn(`[trillion3d] sorted translucency: ${text}`)
}

const bufferUsage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
const poolBuffer = (
  device: GPUDevice,
  pixels: number,
  samples: number,
  low: number,
  nodes: number,
) =>
  device.createBuffer({
    label: 'Trillion3D sorted translucency pool',
    size: oitPoolWords(pixels, samples, low, nodes) * 4,
    usage: bufferUsage(),
  })
const headBuffer = (device: GPUDevice, pixels: number, low: number) =>
  device.createBuffer({
    label: 'Trillion3D sorted translucency head',
    size: oitHeadWords(pixels, low) * 4,
    usage: bufferUsage(),
  })

/** The largest square under `samples`, 0 under one. */
const squareBelow = (samples: number) => Math.floor(Math.sqrt(samples - 1)) ** 2

/** The shape of the buffers asked for, and the nodes the pool is asked at. */
interface Ask {
  readonly pixels: number
  readonly asked: number
  readonly samples: number
  readonly low: number
  readonly fitting: number
  /** The fewest nodes the pool is drawn at after refusals (`OIT_POOL_FLOOR`, or what fits). */
  readonly floor: number
  /** The buffers the view holds whose head buffer is kept: only the pool is made again. None where the buffers are made whole. */
  readonly current: OitBuffers | undefined
  /** The buffers the view holds that the whole new ones replace (more samples, once a refusal is lifted); the old ones stay in use until the new are adopted. */
  readonly upgrading: OitBuffers | undefined
  readonly wanted: number
  /** A pool made smaller is asked once, never made smaller again by a refusal. */
  readonly shrinking: boolean
}

/**
 * What one halving of the engine's pool grant (`grantedPool`) allocates: the head buffer too where the view holds none, then the pool of `draw`. A growth
 * is asked of the device only for a pool larger than the one held (none otherwise: the device is not asked, and the grant says "none larger"). The
 * pool is the replacement of the one it replaces on the budget (`ledgerReplacing`); whatever was made is destroyed if the pool is not (a refusal of the
 * budget or any other error is thrown after).
 */
function madeBuffers(device: GPUDevice, shape: Ask, draw: OitPoolDraw): Grant {
  const { pixels, asked, samples, low, fitting, current, upgrading } = shape
  const grant = { pixels, asked, samples, low, fitting }
  if (current && !shape.shrinking && draw.nodes <= current.nodes)
    return { ...grant, head: undefined, pool: undefined, nodes: current.nodes, destroy() {} }
  const head = current ? undefined : headBuffer(device, pixels, low)
  try {
    const replaced = current
      ? current.pool.size
      : upgrading
        ? upgrading.buffer.size + upgrading.pool.size
        : 0
    const pool = ledgerReplacing(device, replaced, () =>
      poolBuffer(device, pixels, samples, low, draw.nodes),
    )
    return {
      ...grant,
      head,
      pool,
      nodes: draw.nodes,
      destroy() {
        head?.destroy()
        pool.destroy()
      },
    }
  } catch (error) {
    head?.destroy()
    throw error
  }
}

/**
 * The buffers of the view `owner` for `pixels` pixels (the extent of the translucency targets: an image drawn smaller uses the first of them, with
 * a pitch of its own width, and moves nothing) keeping `samples` fragments each, made again when either changes. `encoder` is the image's: the first
 * pass prepared on an encoder starts the image. Every buffer comes from the engine's budget API: asked of the device apart from the frame, under its
 * out-of-memory scope and tentatively on the memory budget, and adopted at the start of an image once granted, never used before; until the first
 * buffers are granted the layers are blended in drawing order. The pool, sized by the demand the last images counted, is bounded to what a pixel's
 * list can ask (`oitPoolCeiling`) and to the device's binding limit; it grows when the demand reaches it and shrinks to twice the demand once the demand
 * has stayed under a quarter of it for 60 frames. A refusal is absorbed: the pool is asked at half the bytes again down to the floor (`oitPoolDraws`,
 * the rule of the other pools), the pool in place is kept where no larger one is granted, the cap lowered to what was granted, and the samples are
 * lowered (to the square below) only when not even the floor pool, with the head buffer and the slots a pixel owns, is granted. A refusal lasts until
 * the extent or the device changes, or 60 images later where the demand has grown (`oitRefusalHolds`): none is permanent. It is said once per device.
 * The slots are split over the head and the pool buffer (`oitSplit`) so that the samples asked fit a device's binding limit when the two together do;
 * where they do not, the pixels keep the most samples that fit (a square, as they are asked) with a warning once per device: the reference has no such
 * case, as it makes its sample textures of the size it asks (the texture creation in `CreateOITData`); none only where not even one sample fits.
 */
export function oitBuffersOf(
  device: GPUDevice,
  owner: object,
  encoder: GPUCommandEncoder,
  pixels: number,
  asked: number,
  diagnose: Diagnose,
): OitBuffers | undefined {
  const own = demands.of(device, owner)
  const first = own.encoder?.deref() !== encoder
  let current = held.get(owner)
  if (first) {
    own.encoder = new WeakRef(encoder)
    own.passes = 0
    own.frame++
    own.saturated = current && own.nodes >= current.nodes ? own.saturated + 1 : 0
  }
  if (
    first &&
    own.refusal &&
    !oitRefusalHolds(own.refusal, pixels, own.frame, own.saturated, !!current)
  ) {
    own.refusal = undefined
    own.cap = own.maxSamples = Infinity
  }
  if (current && (current.pixels !== pixels || current.asked !== asked)) {
    releaseBuffers(device, owner)
    current = undefined
  }
  // Buffers granted since are adopted at the start of an image, never between the passes of one (the demand of the image's passes lies in the head buffer, the pool in use is named by encoded passes).
  const grant = own.granted
  if (grant && first) {
    own.granted = undefined
    if (grant.pixels !== pixels || grant.asked !== asked) grant.destroy()
    else if (grant.head && !current) {
      current = adopted(own, owner, grant)
    } else if (grant.head && current && grant.samples > current.samples) {
      releaseBuffers(device, owner)
      current = adopted(own, owner, grant)
    } else if (!grant.head && grant.pool && current && grant.samples === current.samples) {
      retire(device, current.pool)
      current.pool = grant.pool
      current.nodes = grant.nodes
      current.groups = new WeakMap()
      own.quiet = 0
    } else grant.destroy()
  }
  if (!current) {
    askFirstBuffers(device, owner, own, pixels, asked, diagnose)
    return undefined
  }
  if (first) {
    const quiet = own.nodes * 4 < current.nodes && current.nodes > oitPoolMinimum(pixels)
    own.quiet = quiet ? own.quiet + 1 : 0
    if (!moreSamples(device, owner, own, current, diagnose))
      growth(device, owner, own, current, diagnose)
  }
  return current
}

/** Asks the device for the first buffers of `owner`, which holds none: the samples that fit, one ask at a time. */
function askFirstBuffers(
  device: GPUDevice,
  owner: object,
  own: OwnedOit,
  pixels: number,
  asked: number,
  diagnose: Diagnose,
) {
  const bind = storageBufferCap(device.limits)
  const samples = oitSamplesFitting(pixels, Math.min(asked, own.maxSamples), bind)
  if (samples === 0) return
  if (samples < asked) sayFewSamples(device, bind, asked, pixels, samples)
  if (asks.has(owner) || own.granted) return
  ask(device, owner, own, wholeShape(own, pixels, asked, samples, bind, undefined), diagnose)
}

/**
 * The first buffers asked at a frame's entry, before the frames' wait for the device is read (`oitBuffersAwaited`, `deviceAnswer`): the frame that finds the layers to sort is held as the
 * others are, not drawn unsorted. Asked as `oitBuffersOf` asks them (the same extent and samples), once, where the view holds none, none is asked or granted and no refusal is in force
 * (the draw's own ask handles a refusal's retry).
 */
export function askOitBuffers(
  device: GPUDevice,
  owner: object,
  pixels: number,
  asked: number,
  diagnose: Diagnose,
) {
  if (held.get(owner) || asks.has(owner)) return
  const own = demands.of(device, owner)
  if (own.granted || own.refusal) return
  askFirstBuffers(device, owner, own, pixels, asked, diagnose)
}

const sayFewSamples = (
  device: GPUDevice,
  bind: number,
  asked: number,
  pixels: number,
  samples: number,
) =>
  sayOnce(
    device,
    'samples',
    `the device binds ${bind} bytes of storage, too few for ${asked} samples of ${pixels} pixels; the pixels keep ${samples}`,
  )

/** The buffers made whole for `samples`, the pool at the demand the last images counted. */
function wholeShape(
  own: OwnedOit,
  pixels: number,
  asked: number,
  samples: number,
  bind: number,
  upgrading: OitBuffers | undefined,
): Ask {
  const low = oitSplit(pixels, samples, bind)
  const fitting = Math.min(
    oitNodesFitting(pixels, samples, low, bind),
    oitPoolCeiling(pixels, samples),
  )
  const minimum = Math.min(oitPoolMinimum(pixels), fitting)
  return {
    pixels,
    asked,
    samples,
    low,
    fitting,
    floor: Math.min(OIT_POOL_FLOOR, minimum),
    current: undefined,
    upgrading,
    wanted: Math.min(own.cap, clampLowWins(own.nodes, minimum, fitting)),
    shrinking: false,
  }
}

/**
 * Samples lowered by a refusal, asked again once the refusal is lifted: the buffers the view holds keep fewer samples than the project asks while the
 * device could now bind more (`own.maxSamples` back to unbounded). The larger buffers are made whole beside the held ones, which draw until the
 * grant is adopted. True when such an ask was made or is in flight.
 */
function moreSamples(
  device: GPUDevice,
  owner: object,
  own: OwnedOit,
  current: OitBuffers,
  diagnose: Diagnose,
) {
  if (own.refusal || current.samples >= current.asked) return false
  const bind = storageBufferCap(device.limits)
  const samples = oitSamplesFitting(current.pixels, Math.min(current.asked, own.maxSamples), bind)
  if (samples <= current.samples) return false
  if (asks.has(owner) || own.granted) return true
  ask(
    device,
    owner,
    own,
    wholeShape(own, current.pixels, current.asked, samples, bind, current),
    diagnose,
  )
  return true
}

/** The buffers of a grant made whole, held for the view. */
function adopted(own: OwnedOit, owner: object, grant: Grant) {
  const made: OitBuffers = {
    buffer: grant.head!,
    pool: grant.pool!,
    groups: new WeakMap(),
    depth: undefined,
    pixels: grant.pixels,
    asked: grant.asked,
    samples: grant.samples,
    low: grant.low,
    nodes: grant.nodes,
    fitting: grant.fitting,
    own,
  }
  held.set(owner, made)
  return made
}

/** The pool made larger or smaller than the one held, asked at the start of an image once the last ask is answered. */
function growth(
  device: GPUDevice,
  owner: object,
  own: OwnedOit,
  current: OitBuffers,
  diagnose: Diagnose,
) {
  if (asks.has(owner) || own.granted) return
  const { pixels, samples, low, fitting } = current
  const minimum = Math.min(oitPoolMinimum(pixels), fitting)
  const shrinks = own.quiet >= SHRINK_FRAMES
  // The count of a pass stops at the pool: a demand that reaches it asks for more than it holds.
  const demand = own.nodes >= current.nodes ? own.nodes + 1 : own.nodes
  const wanted = Math.min(own.cap, clampLowWins(demand, minimum, fitting))
  const target = shrinks
    ? clampLowWins(own.nodes * 2, minimum, own.cap)
    : grownLength(current.nodes, wanted)
  const nodes = Math.min(fitting, own.cap, target)
  if ((wanted > current.nodes && nodes > current.nodes) || (shrinks && nodes < current.nodes))
    ask(
      device,
      owner,
      own,
      {
        pixels,
        asked: current.asked,
        samples,
        low,
        fitting,
        floor: Math.min(OIT_POOL_FLOOR, minimum),
        current,
        upgrading: undefined,
        wanted: nodes,
        shrinking: nodes < current.nodes,
      },
      diagnose,
    )
}

/**
 * Asks the device for the buffers `shape` names, apart from the frame, through the engine's pool grant (`grantedPool`: the halving rule, the device's
 * out-of-memory scope, the budget's tentative admission, the `gpu-out-of-memory` diagnostic). The answer lands in `own.granted`; a refusal lowers what
 * the view may ask for (`own.cap`, `own.maxSamples`), starts the clock of its retry (`own.refusal`) and is said once per device; a failure of the ask itself is a
 * refusal too. One ask at a time for a view; the grant of a view given back meanwhile (`disposeOit`) is destroyed and counts for nothing. Where the view holds
 * no buffers the frames wait for the answer (`oitBuffersAwaited`).
 */
function ask(device: GPUDevice, owner: object, own: OwnedOit, shape: Ask, diagnose: Diagnose) {
  if (asks.has(owner)) return
  const flight: Flight = { dead: false, grant: undefined }
  asks.set(owner, flight)
  const refuse = (nodes: number | undefined) => {
    own.refusal = { pixels: shape.pixels, frame: own.frame }
    if (shape.current) {
      if (shape.shrinking) own.quiet = 0
      else own.cap = nodes ?? shape.current.nodes
    } else if (nodes === undefined) own.maxSamples = squareBelow(shape.samples)
    else own.cap = nodes
    const holds = shape.current ?? shape.upgrading
    sayOnce(
      device,
      'memory',
      nodes === undefined
        ? `the device refused ${shape.current ? 'a pool' : 'the buffers'} of ${shape.pixels} pixels and ${shape.samples} samples, down to the floor; ${holds ? `the ${shape.current ? 'pool stays at' : 'buffers stay at'} ${shape.current ? `${shape.current.nodes} nodes` : `${holds.samples} samples`}, the fragments past it are summed` : 'the pixels keep fewer samples, or none'}`
        : `the device granted a pool of ${nodes} nodes of the ${shape.wanted} asked; the fragments past it are summed`,
    )
  }
  const floor = shape.shrinking ? shape.wanted : (shape.current?.nodes ?? shape.floor)
  const { draw, bytes } = oitPoolDrawer(shape.pixels, shape.samples, shape.low, shape.wanted, floor)
  /** Ends the flight; true when the view was given back meanwhile. */
  const over = () => {
    if (asks.get(owner) === flight) asks.delete(owner)
    return flight.dead
  }
  const work = grantedPool({
    device,
    name: 'oit',
    budgetBytes: bytes,
    draw,
    make: (pool) => madeBuffers(device, shape, pool),
    diagnose,
  }).then(
    (granted) => {
      const grant = granted?.made
      let adoptable = false
      try {
        if (over()) return
        if (!grant) return refuse(undefined)
        if (grant.pool) {
          own.granted = grant
          adoptable = true
        }
        if (!shape.shrinking && grant.nodes < shape.wanted) refuse(grant.nodes)
      } finally {
        if (grant && !adoptable) grant.destroy()
      }
    },
    () => {
      if (!over()) refuse(undefined)
    },
  )
  // The frames wait for buffers that are made whole where none is held: the unsorted image would be shown meanwhile.
  if (!shape.current && !shape.upgrading) flight.grant = startGrant(work)
}

/** The sorted translucency's buffers `owner` waits for the device to grant while it holds none, for the frame loop to hold the frame on (`deviceAnswer`). */
export const oitBuffersAwaited = (owner: object) => {
  const flight = asks.get(owner)
  return flight && !flight.dead ? grantPending(flight.grant) : undefined
}

/**
 * After the image's fragments are composed: the largest count of nodes the passes asked of the pool, kept in the head buffer by the combination, is
 * copied to be read a few images late (each pass copies it, the last copy being the largest), then the pass's own count is cleared for the next pass.
 */
export function copyOitDemand(encoder: GPUCommandEncoder, { buffer, own }: OitBuffers) {
  own.passes++
  const staging = own.ring.take()
  if (staging) encoder.copyBufferToBuffer(buffer, OIT_GLOBAL_DEMAND * 4, staging, 0, 4)
}

/** Before an image's first pass collects: the largest count of the image's passes starts from zero. */
export function clearOitDemand(encoder: GPUCommandEncoder, { buffer, own }: OitBuffers) {
  if (own.passes === 0) encoder.clearBuffer(buffer, OIT_GLOBAL_DEMAND * 4, 4)
}

/** After the frame's submit: the copy of the demand maps. The passes and the parameters belong to the encoder, which counts a submit and an abandon alike. */
export function oitSubmitted(owner: object) {
  demands.peek(owner)?.ring.submitted()
}

function releaseBuffers(device: GPUDevice, owner: object) {
  const current = held.get(owner)
  if (current) {
    retire(device, current.buffer)
    retire(device, current.pool)
  }
  held.delete(owner)
}

/** Gives the view `owner`'s buffers, the demand it counted and its parameters back. */
export function disposeOit(device: GPUDevice, owner: object) {
  releaseBuffers(device, owner)
  const flight = asks.get(owner)
  if (flight) flight.dead = true
  const own = demands.dispose(owner)
  if (own) {
    own.granted?.destroy()
    own.uniforms.release(device)
  }
}

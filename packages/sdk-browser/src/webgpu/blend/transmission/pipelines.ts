import { feedbackConstants } from '../../tile/requestWgsl.ts'
import { preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import {
  DISTORTION_BINDINGS,
  reflectedGroups,
  stageDescriptors,
  type TransmitPipelines,
} from '../stagePipelines.ts'
import { cullOf, refractsRank, transmitsRank } from '../planCull.ts'
import { displayMaskLayout, displayTargets } from '../displayFilter.ts'
import { companionTargets, type ShareTargets } from '../blendTargets.ts'
import { ADD_ONE, OVER } from '../equations.ts'
import { GIVEN_UP_TARGET, REACTIVE_TARGET } from '../../../lighting/deferred/asIsShare.ts'
import { DISTORTION_FORMAT, FEEDBACK_FORMAT, HDR_FORMAT } from '../../../scene/targetFormats.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { heldGroup } from '../../core/bindIdentity.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'

/** The dual blend: the first source added, the destination multiplied by the second; the alpha
 *  the first source's coverage laid over the target's, as the fallback's (`OVER_BLEND`). */
const DUAL_BLEND: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'src1' }, alpha: OVER }
/** The fallback without dual-source blending: premultiplied colour over, its grey coverage laid over the target's. */
const OVER_BLEND: GPUBlendState = { color: OVER, alpha: OVER }
/** The distortion accumulation: every refracting layer's offset added. */
const ACCUMULATE: GPUBlendState = { color: ADD_ONE, alpha: ADD_ONE }
/** The offsets' target, every accumulation's. */
const DISTORTION_TARGET: GPUColorTargetState = { format: DISTORTION_FORMAT, blend: ACCUMULATE }

/** A stage's three culls, compiled at their first use or by `precompile`. */
type Culls = ReturnType<typeof preparedPipeline>[]

/** The pipelines a plan rank of a transmissive item picks of `culls` of the frame's share: its
 *  cull's; every rank `drawn` refuses is skipped (\`transmitsRank\` unless given). */
const ranked = (
  culls: (share: ShareTargets) => Culls,
  drawn: (rank: number) => boolean = transmitsRank,
): TransmitPipelines['coverage'] => ({
  at: (rank, _filtered, share = 0) => culls(share)[cullOf(rank)].get(),
  skips: (rank) => !drawn(rank),
})

/** The targets of the fallback, as the blend pass lays them (`blendTargets`): the HDR target, the
 *  request, the reactive value where the frame has a share — green alone, as a particle's —, the
 *  display layers of a normal layer where it is `filtered`, the history given up at `share` 2
 *  (`ShareTargets`). */
export const overTargets = (
  feedback: boolean,
  filtered: boolean,
  share: ShareTargets,
): (GPUColorTargetState | null)[] => [
  { format: HDR_FORMAT, blend: OVER_BLEND },
  feedback ? { format: FEEDBACK_FORMAT } : null,
  share ? REACTIVE_TARGET : null,
  ...(filtered ? displayTargets('normal') : [null, null]),
  share === 2 ? GIVEN_UP_TARGET : null,
]

/** The distortion's accumulation group: the deferred view, the opaque depth. */
const distortionLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D distortion accumulation',
    entries: [
      computeUniformEntry(DISTORTION_BINDINGS.view, {}, GPUShaderStage.FRAGMENT),
      computeTextureEntry(DISTORTION_BINDINGS.depth, 'depth', '2d', GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The distortion's application group: the deferred view, the offsets, the scene copy — read
 *  bilinear by the sampler, rgba16float filtering — and the sampler. */
const applyLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D distortion apply',
    entries: [
      computeUniformEntry(DISTORTION_BINDINGS.view, {}, GPUShaderStage.FRAGMENT),
      computeTextureEntry(
        DISTORTION_BINDINGS.offsets,
        'unfilterable-float',
        '2d',
        GPUShaderStage.FRAGMENT,
      ),
      computeTextureEntry(DISTORTION_BINDINGS.scene, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeSamplerEntry(DISTORTION_BINDINGS.sampler, 'filtering', GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The application's bilinear sampler, its edges clamped (the defaults). */
const applySampler = oncePerDevice((device: GPUDevice) =>
  device.createSampler({
    label: 'Trillion3D distortion apply',
    magFilter: 'linear',
    minFilter: 'linear',
  }),
)

/** The full-screen application's group 0, which it reads nothing of: an empty layout and group. */
const emptyLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({ label: 'Trillion3D empty', entries: [] }),
)
const emptyGroup = oncePerDevice((device: GPUDevice) =>
  device.createBindGroup({ label: 'Trillion3D empty', layout: emptyLayout(device), entries: [] }),
)

/** The engine's held group (`heldGroup`) of `layout` over a uniform buffer and one or two texture
 *  views at `bindings`, in that order, with the fixed entries `fixed` beside them: made again only
 *  when one of them moved, a frame that names the same resources allocating nothing. */
function viewsGroup(
  device: GPUDevice,
  label: string,
  layout: () => GPUBindGroupLayout,
  bindings: readonly number[],
  fixed: readonly GPUBindGroupEntry[] = [],
) {
  const held = heldGroup()
  return (buffer: GPUBuffer, first: GPUTextureView, second?: GPUTextureView) => {
    const { identity } = held,
      { next } = identity
    next[0] = buffer
    next[1] = first
    next[2] = second
    if (identity.moved() || !held.group) {
      const resources = [{ buffer }, first, second]
      held.group = device.createBindGroup({
        label,
        layout: layout(),
        entries: [
          ...bindings.map((binding, at) => ({ binding, resource: resources[at]! })),
          ...fixed,
        ],
      })
    }
    return held.group
  }
}

/**
 * The transmissive pipelines of one blend program (`TransmitPipelines`), on its `module` — the
 * blend module, its transmissive stages in it (`transmitWgsl.ts`) — and the blend group's
 * `layout`, each made at its first use or by `precompile`; `dual`, the device grants
 * `dual-source-blending` and the module holds `fsTransmitDual`. The groups a frame binds are made
 * again only when what they name moved (`createWebgpuBindIdentity`).
 *
 * Only the layer's colour lights: the companion pass and the distortion's passes read no light,
 * so the programs of other lights take them from `shared`, the first program's of their lobes
 * (`../pipelines.ts`) — made once, not once per program.
 */
export function createTransmitPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  dual: boolean,
  shared?: TransmitPipelines,
): TransmitPipelines {
  const constants = feedbackConstants(feedback)
  const culls = (
    entryPoint: string,
    targets: (GPUColorTargetState | null)[],
    groups: { mask?: GPUBindGroupLayout; own?: GPUBindGroupLayout[]; route?: boolean } = {},
  ): Culls =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint,
        targets,
        constants: groups.route ? { ...constants, DISPLAY_ROUTE: 1 } : constants,
      },
      false,
      groups.own ?? reflectedGroups(device, groups.mask),
    ).map((descriptor) => preparedPipeline(device, descriptor))
  // The fallback by display layers then share-target key (`+filtered + 2 * share`), the companion
  // pass by share-target key.
  const overs: Culls[] = [],
    coverage: Culls[] = []
  const distortionCoverage: Culls[] = []
  let dualCulls: Culls | undefined, distortionCulls: Culls | undefined
  const overOf = (filtered: boolean, share: ShareTargets) =>
    (overs[+filtered + 2 * share] ??= filtered
      ? culls('fsTransmitFiltered', overTargets(feedback, true, share), {
          mask: displayMaskLayout(device),
          route: true,
        })
      : culls('fsTransmit', overTargets(feedback, false, share)))
  const dualOf = () =>
    (dualCulls ??= culls('fsTransmitDual', [{ format: HDR_FORMAT, blend: DUAL_BLEND }]))
  const coverageOf = (share: ShareTargets) =>
    (coverage[share] ??= culls(
      'fsTransmitCoverage',
      companionTargets(null, feedback, share, REACTIVE_TARGET),
      { own: [] },
    ))
  const distortionOf = () =>
    (distortionCulls ??= culls('fsDistortion', [DISTORTION_TARGET], {
      own: [distortionLayout(device)],
    }))
  const distortionCoverageOf = (share: ShareTargets) =>
    (distortionCoverage[share] ??= culls(
      'fsDistortionCoverage',
      companionTargets(DISTORTION_TARGET, feedback, share, REACTIVE_TARGET),
      { own: [distortionLayout(device)] },
    ))
  const over: TransmitPipelines['over'] = {
    at: (rank, filtered = false, share = 0) => overOf(filtered, share)[cullOf(rank)].get(),
  }
  /** The colour pass's reached sets — the dual blend where the device has it, the fallback
   *  otherwise and wherever display layers are on —, then with `unlit` the companion pass's. */
  const reachedSets = (
    { shares, filtered }: { shares: ReadonlySet<ShareTargets>; filtered: boolean },
    unlit: boolean,
  ) => {
    const sets: Culls[] = dual ? [dualOf()] : []
    for (const share of shares) {
      if (!dual) sets.push(overOf(false, share))
      else if (unlit) sets.push(coverageOf(share))
      if (filtered) sets.push(overOf(true, share))
    }
    return sets.flat().map((pipeline) => pipeline.prepare())
  }
  if (shared)
    return {
      ...shared,
      over,
      dual: dual ? ranked(dualOf) : undefined,
      /** The colour pass's here, the stages it shares with `shared`. */
      precompile: (reached) =>
        Promise.all([shared.precompile(reached), ...reachedSets(reached, false)]),
    }
  const distortionGroup = viewsGroup(
    device,
    'Trillion3D distortion accumulation',
    () => distortionLayout(device),
    [DISTORTION_BINDINGS.view, DISTORTION_BINDINGS.depth],
  )
  const applyGroup = viewsGroup(
    device,
    'Trillion3D distortion apply',
    () => applyLayout(device),
    [DISTORTION_BINDINGS.view, DISTORTION_BINDINGS.offsets, DISTORTION_BINDINGS.scene],
    [{ binding: DISTORTION_BINDINGS.sampler, resource: applySampler(device) }],
  )
  // The application, full screen: no vertex buffer, no
  // depth, the pixels without an offset dropped by its fragment (\`distortedScene\`).
  const apply = preparedPipeline(device, {
    label: 'Trillion3D distortion apply',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [emptyLayout(device), applyLayout(device)],
    }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: 'fsDistortionApply',
      targets: [{ format: HDR_FORMAT }],
      constants,
    },
    primitive: { topology: 'triangle-list' },
  })
  return {
    over,
    dual: dual ? ranked(dualOf) : undefined,
    coverage: ranked(coverageOf),
    distortion: ranked(distortionOf, refractsRank),
    distortionCoverage: ranked(distortionCoverageOf),
    apply,
    applyEmpty: emptyGroup(device),
    distortionGroup,
    applyGroup,
    /** What the scene reaches compiles off the frame: the colour pass's, the companion pass of
     *  the dual blend — alone, and in the accumulation of a dual image that refracts —, the
     *  distortion's accumulation and application. */
    precompile: (reached) =>
      Promise.all([
        apply.prepare(),
        ...distortionOf().map((pipeline) => pipeline.prepare()),
        ...(dual
          ? [...reached.shares].flatMap((share) =>
              distortionCoverageOf(share).map((pipeline) => pipeline.prepare()),
            )
          : []),
        ...reachedSets(reached, true),
      ]),
  }
}

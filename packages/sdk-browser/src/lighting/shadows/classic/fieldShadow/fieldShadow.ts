import { perspectiveSlope } from '../../../../../../math/src/projection/camera.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { CENTIMETRES_PER_METRE as CM } from '../../../../../../sdk-core/src/page/format.ts'
import { commitOnSubmit } from '../../../../gpu/core/frameRetire.ts'
import { skyLightReadOf } from '../../../../frame/render/skyLightState.ts'
import { askedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { sliceBounds } from '../../../distanceField/shadow/bounds.ts'
import { reflectionGroup, reflectionLightView } from '../../../reflections/group.ts'
import { reflectionLayout } from '../../../reflections/reflectionPipelines.ts'
import { encodeMeshShadow, type ListedSun } from '../../../surfaceCache/lighting/meshShadow.ts'
import { waterWantsField } from './fieldShadowWaterNeed.ts'
import type { VsmFrame } from '../../vsm/frame/vsmProject.ts'
import type { createCachedGroup } from '../../../../gpu/bind/cachedGroup.ts'
import {
  cascadeSuns,
  FIELD_SHADOW_LABEL as LABEL,
  kitOf,
  NO_RAY_BIAS,
  fieldViewOf,
  sameRun,
  tracedImage,
  writeParams,
  type CascadeSun,
  type FieldKit,
  type FieldView,
  type PreparedField,
} from './fieldShadowKit.ts'
import {
  FIELD_SHADOW_BINDINGS as B,
  FIELD_SHADOW_GROUP,
  FIELD_SHADOW_LISTS_GROUP,
  FIELD_SHADOW_TRACE_ENTRY,
  FIELD_SHADOW_UPSAMPLE_ENTRY,
  fieldShadowTraceProgram,
  fieldShadowUpsampleProgram,
} from './fieldShadowWgsl.ts'

/**
 * THE SUNS' DISTANCE-FIELD CASCADE ON THE VIEW, while the shadows are classic (`shadowVirtualEnable` off): for each sun of the frame (the first four) that has one
 * (`fieldCascade`), the meshes are culled to the slice of the view's frustum the cascade spans and listed by tile across the sun (the passes of the cards' lists,
 * `encodeMeshShadow`), a ray from each pixel (at `1 / factor` of the image's size, `distanceFieldShadowFullResolution`) is walked through its tile's meshes
 * (`fieldShadowTrace`), and the traced image is upsampled and laid into the sun's layer of `sunMask` by the minimum (`fieldShadowUpsample`). Nothing where the
 * switches are off, the scene has no mesh with a field, the view is orthographic or a stage is still compiling.
 *
 * `maskHeld`: the image holds the projection's mask (`vsmProject.ts`), so the mask is not written again; the lists and the run the water's kernels trace are made
 * again for the image, while the water asks for them.
 */
export function encodeFieldShadowSuns(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  shadows: ShadowValues,
  suns: number,
  sunMask: GPUTextureView,
  maskHeld = false,
) {
  const { rt, device, cam } = frame
  const kit = kitOf(device)
  // A held mask needs the cascade only for the water, whose need is known now (it does not depend on a view the cascade already made).
  if (maskHeld && !waterWantsField(rt)) return
  const objects = rt.distanceFields?.scene?.meshes
  const hiz = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  const wanted =
    !shadows.shadowVirtualEnable &&
    shadows.distanceFieldShadowing &&
    shadows.distanceFieldShadowQuality > 0 &&
    cam.perspective !== 0 &&
    !!objects &&
    objects.generation > 0 &&
    objects.count > 0
  const tanY = perspectiveSlope(cam.fov)
  const tan: [number, number] = [tanY * cam.aspect, tanY]
  const found = wanted ? cascadeSuns(frame, shadows, suns, tan) : []
  // An image without a cascade keeps the view's lists: `idleFieldShadow` lets them go after its delay.
  if (!found.length || !hiz || !lightView || !rt.gpu.reflection) return
  const mine = fieldViewOf(rt.gpu, device)
  mine.lastRun = rt.run.frame
  const stamp = [
    objects?.generation ?? 0,
    objects?.revision ?? 0,
    ...rt.gpu.targetSize,
    shadows.distanceFieldShadowFullResolution ? 1 : 0,
  ]
  const view = reflectionGroup(rt.gpu.reflection, hiz, lightView, skyLightReadOf(rt))
  // A held image keeps the lists a submitted image made (the view, the suns and the cascade are those of that image) while the fields they were made of are the same: the water's kernels read them again.
  if (maskHeld && mine.prepared?.submitted && sameRun(mine.prepared, stamp, found)) {
    mine.prepared = { ...mine.prepared, frame: rt.run.frame, view }
    return
  }
  const forward = [-cam.world[8]!, -cam.world[9]!, -cam.world[10]!]
  const right = [cam.world[0]!, cam.world[1]!, cam.world[2]!]
  const up = [cam.world[4]!, cam.world[5]!, cam.world[6]!]
  const listed: ListedSun[] = found.map(({ cascade, toLight }) => ({
    toLight,
    bounds: sliceBounds(
      {
        forward,
        right,
        up,
        tan,
        near: cascade.near / CM,
        far: cascade.far / CM,
        centre: cascade.centre / CM,
        radius: cascade.radius / CM,
      },
      toLight,
    ),
  }))
  const lists = encodeMeshShadow(mine.state, rt, device, encoder, NO_RAY_BIAS, {
    eye: cam.eye,
    reach: 0,
    suns: listed,
  })
  if (!lists) return
  const failed = (error: unknown) =>
    rt.diag.engineDiagnostic('field-shadow-cascade', String(error), {})
  kit.trace ??= askedComputeStage(
    device,
    [kit.traceGroup, reflectionLayout(device), kit.lists],
    fieldShadowTraceProgram(),
    FIELD_SHADOW_TRACE_ENTRY,
    `${LABEL} trace`,
    failed,
  )
  kit.upsample ??= askedComputeStage(
    device,
    [kit.upsampleGroup, reflectionLayout(device)],
    fieldShadowUpsampleProgram(),
    FIELD_SHADOW_UPSAMPLE_ENTRY,
    `${LABEL} upsample`,
    failed,
  )
  const trace = kit.trace.get(),
    upsample = kit.upsample.get()
  if (!trace || !upsample) return
  const window = rt.gpu.targetSize as [number, number]
  const factor = shadows.distanceFieldShadowFullResolution ? 1 : 2
  const low: [number, number] = [ceilDiv(window[0], factor), ceilDiv(window[1], factor)]
  const factors = tracedImage(mine, low)
  const listsGroup = mine.runs.groups.lists.over(
    device,
    kit.lists,
    lists.entries(),
    `${LABEL} lists`,
  )
  const run = { factor, low, window, forward }
  const blocks = found.map((entry, block) => ({ ...entry, block }))
  // The water's kernels, later in this image, trace the same lists on the water's depth.
  const prepared: PreparedField = {
    frame: rt.run.frame,
    stamp,
    submitted: false,
    suns: blocks,
    ...run,
    view,
    lists: listsGroup,
  }
  mine.prepared = prepared
  commitOnSubmit(encoder, () => (prepared.submitted = true))
  if (maskHeld) return
  for (const entry of blocks) {
    const params = encodeTrace(kit, mine, encoder, trace, entry, run, {
      group: kit.traceGroup,
      cache: mine.runs.groups.trace,
      factors,
      view,
      lists: listsGroup,
    })
    const upsampling = encoder.beginComputePass({ label: `${LABEL} upsample` })
    upsampling.setPipeline(upsample)
    upsampling.setBindGroup(
      0,
      mine.runs.groups.upsample(device, kit.upsampleGroup, [params, factors, sunMask], () => [
        { binding: B.params, resource: { buffer: params } },
        { binding: B.factors, resource: factors },
        { binding: B.mask, resource: sunMask },
      ]),
    )
    upsampling.setBindGroup(1, view)
    upsampling.dispatchWorkgroups(
      ceilDiv(window[0], FIELD_SHADOW_GROUP),
      ceilDiv(window[1], FIELD_SHADOW_GROUP),
      1,
    )
    upsampling.end()
  }
}

/** The geometry of a run of the cascade over an image: the traced image's factor and size, the window and the view's forward axis. */
type FieldRun = Pick<PreparedField, 'factor' | 'low' | 'window' | 'forward'>

/**
 * Traces sun `entry` over the image on `encoder`: writes its uniform and dispatches the trace into `factors`, on the group `trace.group` (the uniform and
 * the traced image, and the depth and the list of tiles the trace reads when it is the water's, which it is dispatched over). Returns the uniform, which the upsample binds too.
 */
export function encodeTrace(
  kit: FieldKit,
  mine: FieldView,
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  entry: CascadeSun & { block: number },
  run: FieldRun,
  trace: {
    group: GPUBindGroupLayout
    /** The cache the group is kept in. */
    cache: ReturnType<typeof createCachedGroup>
    factors: GPUTextureView
    view: GPUBindGroup
    lists: GPUBindGroup
    water?: { depth: GPUTextureView; tiles: GPUBuffer; count: GPUBuffer; dispatch: GPUBuffer }
  },
) {
  writeParams(kit, entry, run)
  const { device } = mine
  const params = mine.runs.uniforms.next(device, encoder).buffer
  device.queue.writeBuffer(params, 0, kit.words)
  const pass = encoder.beginComputePass({ label: `${LABEL} trace` })
  pass.setPipeline(pipeline)
  const { water } = trace
  pass.setBindGroup(
    0,
    trace.cache(
      device,
      trace.group,
      [params, trace.factors, water?.depth, water?.tiles, water?.count],
      () => [
        { binding: B.params, resource: { buffer: params } },
        { binding: B.factors, resource: trace.factors },
        ...(water
          ? [
              { binding: B.depth, resource: water.depth },
              { binding: B.tiles, resource: { buffer: water.tiles } },
              { binding: B.count, resource: { buffer: water.count } },
            ]
          : []),
      ],
    ),
  )
  pass.setBindGroup(1, trace.view)
  pass.setBindGroup(FIELD_SHADOW_LISTS_GROUP, trace.lists)
  if (water) pass.dispatchWorkgroupsIndirect(water.dispatch, 0)
  else
    pass.dispatchWorkgroups(
      ceilDiv(run.low[0], FIELD_SHADOW_GROUP),
      ceilDiv(run.low[1], FIELD_SHADOW_GROUP),
      1,
    )
  pass.end()
  return params
}

import { askedComputeStage } from '../../../../gpu/core/computeStages.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { reflectionLayout } from '../../../reflections/reflectionPipelines.ts'
import { encodeTrace } from './fieldShadow.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import {
  FIELD_SHADOW_LABEL as LABEL,
  kitOf,
  peekFieldView,
  tracedImage,
  type FieldView,
} from './fieldShadowKit.ts'
import {
  FIELD_SHADOW_BINDINGS as B,
  FIELD_SHADOW_TRACE_ENTRY,
  FIELD_SHADOW_UPSAMPLE_ENTRY,
  fieldShadowTraceProgram,
  fieldShadowUpsampleProgram,
} from './fieldShadowWgsl.ts'

/** What the water's sun shadow reads: the water's depth, the list of the tiles that hold water, its count (a uniform) and the indirect dispatch over the list (`blend/water/waterTileWgsl.ts`). */
export interface FieldWaterSource {
  depth: GPUTextureView
  tiles: GPUBuffer
  count: GPUBuffer
  dispatch: GPUBuffer
}

/**
 * THE CLASSIC DISTANCE-FIELD SUN SHADOW ON THE SINGLE-LAYER WATER: the cascade the opaque surfaces got this image (`encodeFieldShadowSuns`: the same
 * lists, the same cascade, the same options) traced again from the water's depth over the tiles that hold water, then upsampled over the tiles that hold water alone (the trace and the upsample dispatched indirectly
 * over the list) into a layer a sun of the frame, which the water pass multiplies into its separated sun (`blend/water/waterSunShadow.ts`).
 *
 * The prepared run of this image and its forward sun (`SceneLightStore.forwardDirectionalSlot`) with the water's two programs compiled — they are asked
 * here, off the frame, and none is returned while they compile — or none: no cascade this image (the shadows are virtual, no field, a sun without one).
 */
export function forwardFieldSun(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const kit = kitOf(device),
    mine = peekFieldView(rt.gpu, device),
    prepared = mine?.prepared,
    vsm = rt.lights.vsm
  if (!mine || !prepared || prepared.frame !== rt.run.frame || !vsm?.plan) return undefined
  const { store } = rt.lights
  const slot = store.forwardDirectionalSlot
  const entry = prepared.suns.find(
    ({ layer }) => slot >= 0 && store.slotOf(vsm.plan!.projected[layer]!.id) === slot,
  )
  if (!entry) return undefined
  const failed = (error: unknown) =>
    rt.diag.engineDiagnostic('field-shadow-water', String(error), {})
  kit.traceWater ??= askedComputeStage(
    device,
    [kit.traceWaterGroup, reflectionLayout(device), kit.lists],
    fieldShadowTraceProgram('water'),
    FIELD_SHADOW_TRACE_ENTRY,
    `${LABEL} trace water`,
    failed,
  )
  kit.upsampleWater ??= askedComputeStage(
    device,
    [kit.upsampleWaterGroup, reflectionLayout(device)],
    fieldShadowUpsampleProgram('water'),
    FIELD_SHADOW_UPSAMPLE_ENTRY,
    `${LABEL} upsample water`,
    failed,
  )
  const trace = kit.traceWater.get(),
    upsample = kit.upsampleWater.get()
  return trace && upsample ? { kit, mine, prepared, entry, trace, upsample } : undefined
}

/** The forward sun's field shadow of this image, resolved once (`forwardFieldSun`), its entry's layer the layer of the water's sun mask it is laid in. */
export type ForwardFieldSun = NonNullable<ReturnType<typeof forwardFieldSun>>

/** The water's sun mask of `layers` layers at `size`, made again when the size moved. */
function waterMaskOf(held: FieldView, device: GPUDevice, size: [number, number], layers: number) {
  const { waterMask: mask } = held
  if (
    mask &&
    mask.texture.width === size[0] &&
    mask.texture.height === size[1] &&
    mask.texture.depthOrArrayLayers === layers
  )
    return mask.view
  if (mask) retire(device, mask.texture)
  const texture = device.createTexture({
    label: `${LABEL} water mask`,
    size: [size[0], size[1], layers],
    format: 'r32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const view = texture.createView({ dimension: '2d-array' })
  held.waterMask = { device, texture, view }
  return view
}

/**
 * Traces the forward sun's cascade on the water's depth and upsamples it over the water's tiles on `encoder`, into the layer `layer` of the water's own mask: the layer the water
 * reads its sun at, which is the projection's where that shows the sun too (the two masks are separate textures, so their layers need not agree). Returns the mask, or none
 * where nothing was encoded.
 */
export function encodeFieldWaterSun(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  sun: ForwardFieldSun,
  layer: number,
  source: FieldWaterSource,
) {
  const { kit, mine, prepared } = sun
  const { window, low, view, lists } = prepared
  const entry = { ...sun.entry, layer }
  const factors = tracedImage(mine, low)
  const mask = waterMaskOf(mine, device, window, layer + 1)
  const params = encodeTrace(kit, mine, encoder, sun.trace, entry, prepared, {
    group: kit.traceWaterGroup,
    cache: mine.runs.groups.traceWater,
    factors,
    view,
    lists,
    water: source,
  })
  const pass = encoder.beginComputePass({ label: `${LABEL} upsample water` })
  pass.setPipeline(sun.upsample)
  pass.setBindGroup(
    0,
    mine.runs.groups.upsampleWater(
      device,
      kit.upsampleWaterGroup,
      [params, factors, mask, source.depth, source.tiles, source.count],
      () => [
        { binding: B.params, resource: { buffer: params } },
        { binding: B.factors, resource: factors },
        { binding: B.mask, resource: mask },
        { binding: B.depth, resource: source.depth },
        { binding: B.tiles, resource: { buffer: source.tiles } },
        { binding: B.count, resource: { buffer: source.count } },
      ],
    ),
  )
  pass.setBindGroup(1, view)
  pass.dispatchWorkgroupsIndirect(source.dispatch, 0)
  pass.end()
  return mask
}

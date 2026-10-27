import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { ledgerAdmitted } from '../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { gpuAllocator } from '../../../gpu/core/resourceAllocator.ts'
import { createScreenProbeGroups } from './groups.ts'
import type { PassRanks } from './groupParts.ts'
import type { ScreenProbeKernels } from './kernels.ts'
import { createScreenProbeParams } from './params.ts'
import {
  createScreenProbeResources,
  screenProbeBytes,
  type ScreenProbeResources,
} from './resources.ts'
import {
  atlasFits,
  geometryOfTile,
  screenProbeGeometry,
  type ScreenProbeGeometry,
} from './screenProbeLayout.ts'

/** A view's screen probes: its resources at the size its targets are made at, the bind groups over them, the turn the history
 *  takes and what the last image left. Held on the view's GPU state (`WebgpuGpuState.screenProbes`), counted in its bytes. */
export interface ScreenProbeView {
  /** The settings' key the resources were made for. */
  key: string
  /** The size of the targets they were made at: the largest an image of the view is drawn at. */
  size: readonly [number, number]
  resources: ScreenProbeResources
  /** The kernels the groups were made for, and the groups: made again where the kernels changed. */
  kernels?: ScreenProbeKernels
  groups?: ReturnType<typeof createScreenProbeGroups>
  /** The spatial filter's passes the groups were made for: their parity names the gathered texture the conversion reads. */
  passes?: number
  /** The uniforms of the spatial filter's passes, one each: made with the groups, destroyed with them. */
  ranks?: PassRanks
  write: ReturnType<typeof createScreenProbeParams>
  /** The history's parity this image takes, and the images this view has had. */
  turn: 0 | 1
  frame: number
  /** The view-projection the last image's pixels were lit with: the history is read only where it is the one the last lit
   *  image holds. */
  viewProjection: Float64Array
  /** Whether the last image left a history to read. */
  history: boolean
  /** The inverse of the view-projection the last lit image was drawn with, rewritten each image. */
  previousInverse: Float64Array
  /** The geometry of the image drawn in the targets, at the tile they were made with: remade where the drawn size moved. */
  image?: ScreenProbeGeometry
  /** What the lighting reads this image: the history the temporal pass wrote; none where the image cast no probe. */
  indirect: GPUTextureView | undefined
  /** Bytes the resources hold. */
  readonly bytes: number
  /** Gives the resources back, destroyed once the image that names them is submitted (`retire`). */
  dispose(): void
}

/** What the resources depend on in the settings, once a settings object: exactly what `createScreenProbeResources` and the geometry it is made
 *  at (`geometryOfTile`) read — whether the level casts, the tile, the adaptive probes and their share of the rows, the tracing and gather sides,
 *  the levels of the gather, the irradiance's format, the temporal filter of the probes, the extra ambient occlusion, the occlusion's reduction,
 *  the integration's and the occlusion's bent normal —, so that two views of the same shape agree on it. What only the kernels read (the occlusion's pyramid and power) is
 *  in their own key (`shapeKey`) and does not remake the view. */
const keys = new WeakMap<ScreenProbeSettings, string>()
function settingsKeyOf(settings: ScreenProbeSettings) {
  let key = keys.get(settings)
  if (key === undefined)
    keys.set(
      settings,
      (key = [
        settings.casts,
        settings.downsampleFactor,
        settings.adaptiveProbes,
        settings.values.screenProbeAdaptiveFraction,
        settings.tracingResolution,
        settings.gatherResolution,
        settings.gatherMips,
        settings.irradianceFormat,
        settings.temporalFilterProbes,
        settings.extraAo,
        settings.occlusionDownsample,
        settings.integrateDownsample,
        settings.bentNormal,
      ].join('|')),
    )
  return key
}

/** The geometry of an image drawn at `size` in the targets of `view`: the capacity's tile, remade where the size moved. */
export function imageGeometry(
  view: ScreenProbeView,
  size: readonly [number, number],
  settings: ScreenProbeSettings,
) {
  const held = view.image
  if (held && held.width === size[0] && held.height === size[1]) return held
  return (view.image = geometryOfTile(size[0], size[1], view.resources.geometry.tile, settings))
}

/** A view of probes made for `settings` at `size`: its resources, its parameters' writer and no history. */
function makeView(
  device: GPUDevice,
  size: readonly [number, number],
  settings: ScreenProbeSettings,
  capacity: ScreenProbeGeometry,
): ScreenProbeView {
  const allocator = gpuAllocator(device, 'Trillion3D screen probes')
  const resources = createScreenProbeResources(allocator, capacity, settings)
  device.queue.writeBuffer(resources.listHead, 0, new Uint32Array([0, 0, 1, 0]))
  const bytes = allocator.bytes()
  const view: ScreenProbeView = {
    key: settingsKeyOf(settings),
    size,
    resources,
    write: createScreenProbeParams(device, resources.params),
    turn: 0,
    frame: 0,
    viewProjection: new Float64Array(16),
    history: false,
    previousInverse: new Float64Array(16),
    indirect: undefined,
    bytes,
    dispose() {
      retire(device, allocator)
      if (view.ranks) retire(device, view.ranks)
    },
  }
  return view
}

/**
 * THE VIEW'S SCREEN PROBES at `size`, the size its targets are made at — never the size an image is drawn at in them, which a render
 * scale moves without remaking a thing —: the one it holds while it was made for these settings and this size, else made, the old
 * one given back. Made where the device's budget leaves room (`ledgerAdmitted`, the bytes the old one gives back credited), the tile
 * raised until the atlas fits the device's textures; none where it does not even at the largest tile, and the reason: the pixels then take the sky light's irradiance.
 */
export function ensureScreenProbeView(
  held: ScreenProbeView | undefined,
  device: GPUDevice,
  size: readonly [number, number],
  settings: ScreenProbeSettings,
): { view?: ScreenProbeView; why?: string } {
  if (
    held &&
    held.key === settingsKeyOf(settings) &&
    held.size[0] === size[0] &&
    held.size[1] === size[1]
  )
    return { view: held }
  const side = device.limits?.maxTextureDimension2D ?? Infinity
  const capacity = screenProbeGeometry(size[0], size[1], settings, side)
  if (!atlasFits(capacity, settings, side)) {
    held?.dispose()
    return { why: `the screen probes' atlas is wider than this device's textures (${side} texels)` }
  }
  const { value, why } = ledgerAdmitted(device, {
    held,
    asked: screenProbeBytes(capacity, settings),
    what: 'the screen probes',
    make: () => makeView(device, size, settings, capacity),
  })
  return { view: value, why }
}

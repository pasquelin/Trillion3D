import { constructGpuResources } from '../../gpu/core/errorScope.ts'
import {
  budgetRefused,
  ledgerReplacing,
  ledgerRoom,
  ledgerTentative,
} from '../../gpu/core/deviceLedger.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { AO_PARAMS_BYTES } from './layout.ts'
import { AO_TARGETS, aoPasses, aoTargetExtent, aoTargetsOf, type AoTarget } from './plan.ts'

/** A texture of the occlusion and the view the passes draw and read it through. */
export interface AoTexture {
  readonly texture: GPUTexture
  readonly view: GPUTextureView
}

/**
 * A VIEW'S OCCLUSION, at the extent its targets are made at — never the size an image is drawn at in them, which a
 * render scale moves without remaking a thing —: the textures of the plan of its resolutions (`aoPasses`), and a
 * uniform for each pass, written at each image, a pass drawn from a buffer of its own. Held on the view's GPU state
 * and counted in its bytes; given back when the image needs it no more.
 */
export interface AoView {
  readonly levels: number
  readonly extent: readonly [number, number]
  readonly textures: Readonly<Partial<Record<AoTarget, AoTexture>>>
  /** The uniform of each pass of the plan, in its order. */
  readonly params: readonly GPUBuffer[]
  /** The passes' bind groups, made for the resources they were made over (`frame.ts`). */
  groups: { depth: unknown; normals: unknown; made: GPUBindGroup[] } | undefined
  /** Bytes the textures and the uniforms hold. */
  readonly bytes: number
  /** Gives them back, destroyed once the image that names them is submitted (`retire`). */
  dispose(): void
}

/** The key two views of the same shape agree on. */
export const aoViewKey = (levels: number, extent: readonly [number, number]) =>
  `${levels}|${extent[0]}|${extent[1]}`

/** The bytes a view of `levels` resolutions over `extent` holds: its textures and one uniform a pass. */
export function aoViewBytes(levels: number, extent: readonly [number, number]) {
  let bytes = aoPasses(levels).length * AO_PARAMS_BYTES
  for (const target of aoTargetsOf(levels)) {
    const [width, height] = aoTargetExtent(target, extent)
    bytes += textureBytesOf({ size: [width, height], format: AO_TARGETS[target].format }) ?? 0
  }
  return bytes
}

/** The view of `levels` resolutions over `extent`: its textures, drawn into and read, and a uniform a pass. */
function makeView(
  device: GPUDevice,
  levels: number,
  extent: readonly [number, number],
  bytes: number,
): AoView {
  const made: { destroy(): void }[] = []
  const textures: Partial<Record<AoTarget, AoTexture>> = {}
  for (const target of aoTargetsOf(levels)) {
    const [width, height] = aoTargetExtent(target, extent)
    const texture = device.createTexture({
      label: `${AMBIENT_OCCLUSION_PASS} ${target}`,
      size: [width, height],
      format: AO_TARGETS[target].format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    made.push(texture)
    textures[target] = { texture, view: texture.createView() }
  }
  const params = aoPasses(levels).map((_, at) => {
    const buffer = device.createBuffer({
      label: `${AMBIENT_OCCLUSION_PASS} pass ${at}`,
      size: AO_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    made.push(buffer)
    return buffer
  })
  return {
    levels,
    extent,
    textures,
    params,
    groups: undefined,
    bytes,
    dispose: () =>
      retire(device, { destroy: () => made.forEach((resource) => resource.destroy()) }),
  }
}

/**
 * The view of `levels` resolutions over `extent`: the one `held` while it is that, else made, the old one given
 * back — made where the device's budget leaves room (`ledgerRoom`, the bytes the old one gives back credited);
 * none where it does not, and the reason: the image is then lit without the occlusion.
 */
export function ensureAoView(
  held: AoView | undefined,
  device: GPUDevice,
  levels: number,
  extent: readonly [number, number],
): { view?: AoView; why?: string } {
  if (held && aoViewKey(held.levels, held.extent) === aoViewKey(levels, extent))
    return { view: held }
  const replaced = held?.bytes ?? 0
  const asked = aoViewBytes(levels, extent)
  if (asked - replaced > ledgerRoom(device)) {
    held?.dispose()
    return { why: 'the memory budget leaves no room for the ambient occlusion' }
  }
  try {
    const view = ledgerTentative(device, () =>
      ledgerReplacing(device, replaced, () =>
        constructGpuResources(device, () => makeView(device, levels, extent, asked)),
      ),
    )
    held?.dispose()
    return { view }
  } catch (error) {
    held?.dispose()
    if (budgetRefused(error)) return { why: 'the memory budget refused the ambient occlusion' }
    throw error
  }
}

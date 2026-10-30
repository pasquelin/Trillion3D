import {
  CLOUD_SHADOW_BLOCK,
  writeCloudShadowBlock,
  type CloudShadeSet,
  type CloudShadowSet,
} from '../lighting/atmosphere/cloudShadowRead.ts'
import { cloudShadowStandIn } from '../lighting/atmosphere/cloudShadowStandIn.ts'
import { cloudShadowOf } from '../frame/render/encodeCloudShadow.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { cloudFogStandIn } from '../modules/sky/clouds/cloudFogStandIn.ts'
import {
  CLOUD_FOG_BLOCK,
  writeCloudFogBlock,
  type CloudFogSet,
} from '../modules/sky/clouds/translucentRead.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/**
 * THE CLOUDS ON THE TRANSLUCENT SURFACES, PER VERTEX: what the blend programs that read them
 * (`BlendModePipelines.cloudVertex`) are bound with, made once an image, in one place. Their vertex
 * stage reads two things at each vertex and hands them to the fragment stage (`cloudVertexText.ts`):
 * - the clouds' shade of the forward directional light, where the project switch
 *   `cloudShadowOnTranslucent` is on (`BLEND_CLOUD_SHADE_BINDINGS`): the clouds' shadow map of that
 *   light (`cloudShadeAt`, `../lighting/atmosphere/cloudShadowRead.ts`), the share the clouds let
 *   through given to that light alone. The forward directional light is the light store's
 *   (`SceneLightStore.forwardDirectionalSlot`: of the highest priority, then the greatest declared
 *   colour times intensity), its rank plus one in the header of the light buffer
 *   (`DirectLights.forwardRank`), which the fragment stage finds it by. It is shaded where it is
 *   one of the air's two lights (`SceneLightStore.atmosphereLight`) that has a map this image, with
 *   the strength its light gives the shade on surfaces; otherwise nothing is shaded;
 * - the cloud image, for the surfaces whose material has `cloudFog` (`BLEND_CLOUD_FOG_BINDINGS`):
 *   the image of the clouds the view drew this image (`CloudViewGpu.shown`: the reconstructed image,
 *   or the traced one, with the fog laid on it where the setting asks, and its depth), drawn before
 *   the transparents, with the block that says how to read it.
 * A feature that has nothing this image (the switch off, no map, no cloud drawn) is given its
 * stand-in, bound in its place and neutral (`cloudShadowStandIn`, `cloudFogStandIn`: a strength of
 * 0, a block that says no image is bound): the program is the same either way. A session whose
 * programs read no cloud is given the stand-ins without a write, and makes no buffer.
 */

/** What the programs are bound with: the shade of the forward light and the cloud image, or the
 *  stand-ins. */
export interface CloudVertexSet {
  readonly shade: CloudShadeSet
  readonly fog: CloudFogSet
}

/** What a runtime holds of it: the two blocks and their words, the sampler the cloud image is read
 *  through, and what the last image made. */
interface Held {
  readonly shadeBlock: GPUBuffer
  readonly shadeWords: Float32Array<ArrayBuffer>
  readonly fogBlock: GPUBuffer
  readonly fogWords: Float32Array<ArrayBuffer>
  /** The image the set was made for, and the set: the pass binds the group twice an image. */
  frame: number
  set: CloudVertexSet
}
const held = new WeakMap<WebgpuPagesRuntime, Held>()

/** The stand-ins of a device, one set for as long as it lives. */
export const cloudVertexStandIns = oncePerDevice((device: GPUDevice): CloudVertexSet => {
  const shade = cloudShadowStandIn(device)
  return {
    shade: { block: shade.block, map: shade.maps[0], sampler: shade.sampler },
    fog: cloudFogStandIn(device),
  }
})

function heldOf(rt: WebgpuPagesRuntime, device: GPUDevice): Held {
  let h = held.get(rt)
  if (!h) {
    const block = (label: string, words: number) =>
      device.createBuffer({
        label: `Trillion3D translucent cloud ${label}`,
        size: words * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    held.set(
      rt,
      (h = {
        shadeBlock: block('shade', CLOUD_SHADOW_BLOCK.words),
        shadeWords: new Float32Array(CLOUD_SHADOW_BLOCK.words),
        fogBlock: block('fog', CLOUD_FOG_BLOCK.words),
        fogWords: new Float32Array(CLOUD_FOG_BLOCK.words),
        frame: -1,
        set: cloudVertexStandIns(device),
      }),
    )
  }
  return h
}

/** The shade of the forward directional light from the maps built for this image (`set`), or the
 *  stand-in that casts none where there is no such light or map. */
function shadeOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  h: Held,
  set: CloudShadowSet | undefined,
  none: CloudShadeSet,
): CloudShadeSet {
  const { store } = rt.lights
  const slot = store.forwardDirectionalSlot
  const id = slot >= 0 ? store.ids[slot] : undefined
  const index = id === undefined ? -1 : [0, 1].findIndex((k) => store.atmosphereLight(k)?.id === id)
  const frame = index >= 0 ? set?.frames?.[index] : undefined
  if (!set || !frame) return none
  device.queue.writeBuffer(
    h.shadeBlock,
    0,
    writeCloudShadowBlock(h.shadeWords, [frame, undefined], set.camera ?? [0, 0, 0]),
  )
  return { block: h.shadeBlock, map: set.maps[index], sampler: set.sampler }
}

/** The cloud image the view drew this image, with the block that reads it, or the stand-in. */
function fogOf(rt: WebgpuPagesRuntime, device: GPUDevice, h: Held, none: CloudFogSet): CloudFogSet {
  const shown = rt.gpu.clouds?.shown
  const drawn = shown?.frame === rt.run.frame ? shown : undefined
  if (!drawn) return none
  device.queue.writeBuffer(h.fogBlock, 0, writeCloudFogBlock(h.fogWords, drawn))
  return { block: h.fogBlock, colour: drawn.colour, depth: drawn.depth, sampler: none.sampler }
}

/**
 * What the translucent programs read of the clouds this image, made once an image from the maps
 * built for it (`set`, `cloudShadowOf`) and the clouds the view drew: the shade where the project
 * switch is on, the cloud image where one was drawn, the stand-ins otherwise.
 */
export function translucentCloudVertex(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  set = cloudShadowOf(rt),
): CloudVertexSet {
  const none = cloudVertexStandIns(device)
  if (!rt.vis.blendPipelines?.reads?.clouds) return none
  const h = heldOf(rt, device)
  if (h.frame !== rt.run.frame) {
    h.frame = rt.run.frame
    h.set = {
      shade: rt.blendState.cloudShade ? shadeOf(rt, device, h, set, none.shade) : none.shade,
      fog: fogOf(rt, device, h, none.fog),
    }
  }
  return h.set
}

import {
  cloudShadowSide,
  cloudShadowWanted,
  type CloudShadowLight,
} from '../../../../../sdk-core/src/modules/sky/cloudShadow.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  CLOUD_SHADOW_BLOCK,
  writeCloudShadowBlock,
  type CloudShadowMapFrame,
  type CloudShadowSet,
} from '../../../lighting/atmosphere/cloudShadowRead.ts'
import { createCloudShadowPasses } from './shadow.ts'
import { cloudShadowFrame } from './shadowFrame.ts'
import {
  commitCloudShadowHistory,
  createCloudShadowHistory,
  planCloudShadowTemporal,
} from './shadowHistory.ts'
import { createCloudShadowEncoders, viewOf, type CloudShadowSlot } from './shadowRunPasses.ts'
import {
  CLOUD_SHADOW_FORMAT,
  CLOUD_SHADOW_LAYOUT,
  CLOUD_SHADOW_TEMPORAL_LAYOUT,
  cloudShadowSizes,
  writeCloudShadowTemporal,
  writeCloudShadowTrace,
} from './shadowLayout.ts'
import { RECONSTRUCT_SAMPLER, type Size } from './reconstructLayout.ts'

/**
 * THE CLOUD SHADOW MAPS IN A FRAME: for each of the air's two lights that casts cloud shadows
 * (`cloudShadowWanted`), the trace into a map, the temporal filter into the whole map the view keeps
 * for the next image, then the spatial filters, one pass a halving; the last map is the one the
 * lookups read (`CloudShadowSet`, `lighting/atmosphere/cloudShadowRead.ts`) with the block of its
 * matrices and strengths. A light with no map answers a stand-in of no cloud and a strength of 0.
 *
 * The temporal filter runs where the weight of the current image is under 1 and the view keeps
 * state (`CloudShadowRunInput.keepsState`); a view that keeps none traces the half-size map and
 * filters it spatially. The textures are made again where a side, the passes or the filter change.
 */

/** The air's light, as the clouds know it: its settings, and the unit direction toward it. */
export interface CloudShadowLightInput {
  readonly light: CloudShadowLight
  readonly toward: readonly [number, number, number]
}

/** What an image tells the shadow maps. */
export interface CloudShadowRunInput {
  readonly part: CloudPart
  /** The air's two lights; none for a light the air does not have. */
  readonly lights: readonly [CloudShadowLightInput | undefined, CloudShadowLightInput | undefined]
  /** The camera in the scene, metres, and from the planet's centre, kilometres. */
  readonly eye: ArrayLike<number>
  readonly eyeFromPlanetKm: ArrayLike<number>
  readonly planetRadiusKm: number
  readonly time: number
  readonly frameIndex: number
  /** The material's seven bindings of the trace's group, from `B.material`. */
  readonly material: readonly GPUBindGroupEntry[]
  /** The light buffer and the air's frame buffer, the trace's group 0. */
  readonly air: { readonly buffer: GPUBuffer; readonly frame: GPUBuffer }
  /** The view keeps state from one image to the next. */
  readonly keepsState: boolean
}

/** The usage of a map: written by a compute pass, read by the next and by the lookups. */
const usage = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING

/**
 * The shadow maps' run: `encode` builds the maps of an image on `encoder` and returns what the
 * lookups read; `dispose` releases the textures.
 */
export function createCloudShadowRun(device: GPUDevice, failed: (error: unknown) => void) {
  const made = createCloudShadowPasses(device, failed)
  const lookup = device.createSampler(RECONSTRUCT_SAMPLER)
  const passes = createCloudShadowEncoders(device, made, lookup)
  const uniform = (label: string, floats: number) =>
    device.createBuffer({
      label,
      size: floats * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  const block = uniform('Trillion3D cloud shadow lookups', CLOUD_SHADOW_BLOCK.words)
  const standIn = device.createTexture({
    label: 'Trillion3D cloud shadow none',
    size: { width: 1, height: 1 },
    format: CLOUD_SHADOW_FORMAT,
    usage: usage(),
  })
  const none = standIn.createView()
  const slots: (CloudShadowSlot | undefined)[] = [undefined, undefined]
  const words = new Float32Array(CLOUD_SHADOW_BLOCK.words)
  const trace = new Float32Array(CLOUD_SHADOW_LAYOUT.words)
  const blend = new Float32Array(CLOUD_SHADOW_TEMPORAL_LAYOUT.words)

  function release(k: number) {
    const slot = slots[k]
    if (!slot) return
    for (const t of new Set([...slot.textures, ...slot.whole])) t.destroy()
    slot.trace.destroy()
    slot.blend.destroy()
    slots[k] = undefined
  }

  /** The slot of light `k`, made again when its sizes changed. */
  function slotFor(k: number, sizes: Size[], filtered: boolean) {
    const key = sizes.map((s) => s.width).join(',') + (filtered ? 'f' : '')
    const held = slots[k]
    if (held?.key === key) return held
    release(k)
    const texture = (label: string, size: Size) =>
      device.createTexture({ label, size, format: CLOUD_SHADOW_FORMAT, usage: usage() })
    const textures = sizes.map((size, i) => texture(`Trillion3D cloud shadow ${k}.${i}`, size))
    const whole = filtered
      ? [textures[1], texture(`Trillion3D cloud shadow ${k}.past`, sizes[1])]
      : []
    return (slots[k] = {
      key,
      textures,
      whole,
      current: 0,
      history: createCloudShadowHistory(),
      trace: uniform('Trillion3D cloud shadow trace block', CLOUD_SHADOW_LAYOUT.words),
      blend: uniform('Trillion3D cloud shadow blend block', CLOUD_SHADOW_TEMPORAL_LAYOUT.words),
      views: new Map(),
      groups: new Map(),
      traceGroups: new Map(),
    })
  }

  /** Light `k`'s map of the image, encoded; what the lookups need of it and the map to read. */
  function encodeLight(
    encoder: GPUCommandEncoder,
    k: number,
    input: CloudShadowRunInput,
    light: CloudShadowLightInput,
  ): CloudShadowMapFrame & { final: GPUTextureView } {
    const { quality } = input.part
    const side = cloudShadowSide(light.light, quality.cloudShadowMapResolutionMax)
    const frame = cloudShadowFrame({
      eye: input.eye,
      eyeFromPlanetKm: input.eyeFromPlanetKm,
      planetRadiusKm: input.planetRadiusKm,
      toward: light.toward,
      side,
      light: light.light,
      quality,
    })
    const weight = quality.cloudShadowMapNewFrameWeight
    const spatial = quality.cloudShadowMapSpatialFiltering
    const kept = weight < 1 && input.keepsState
    const temporal = planCloudShadowTemporal(
      frame,
      side,
      weight,
      kept ? (slots[k]?.history ?? createCloudShadowHistory()) : undefined,
      input.frameIndex,
      quality.cloudShadowMapLightRotationCutDegrees,
    )
    const slot = slotFor(k, cloudShadowSizes(side, spatial, temporal), temporal.filtered)
    writeCloudShadowTrace(
      trace,
      { frame, side, temporal, time: input.time },
      light.light,
      input.part,
    )
    device.queue.writeBuffer(slot.trace, 0, trace)
    const pass = encoder.beginComputePass({ label: 'Trillion3D cloud shadow' })
    passes.trace(pass, slot, input, temporal.tracedSide)
    if (temporal.filtered) {
      writeCloudShadowTemporal(blend, frame, side, weight, temporal)
      device.queue.writeBuffer(slot.blend, 0, blend)
      passes.blend(pass, slot, side)
    }
    for (let i = temporal.filtered ? 1 : 0; i < slot.textures.length - 1; i++) {
      const source = i === 1 && temporal.filtered ? slot.whole[slot.current] : slot.textures[i]
      passes.filter(pass, slot, source, i)
    }
    pass.end()
    commitCloudShadowHistory(slot.history, frame, side, temporal.filtered)
    const last =
      temporal.filtered && spatial === 0 ? slot.whole[slot.current] : slot.textures.at(-1)!
    return {
      clipFromCamera: frame.clipFromCamera,
      farDepthKm: frame.farDepthKm,
      surfaceStrength: light.light.cloudShadowOnSurfaceStrength,
      airStrength: light.light.cloudShadowOnAtmosphereStrength,
      final: viewOf(slot, last),
    }
  }

  return {
    /** Whether every pipeline is compiled: until then no map is made. */
    get ready() {
      return made.trace.ready && made.filtering.ready && made.blending.ready
    },
    /** The maps of this image on `encoder`, for the lookups; the stand-in where a light has none. */
    encode(encoder: GPUCommandEncoder, input: CloudShadowRunInput): CloudShadowSet {
      const maps = input.lights.map((light, k) => {
        if (light && cloudShadowWanted(input.part.quality, light.light))
          return encodeLight(encoder, k, input, light)
        release(k)
        return undefined
      })
      const frames = maps as [CloudShadowMapFrame | undefined, CloudShadowMapFrame | undefined]
      device.queue.writeBuffer(block, 0, writeCloudShadowBlock(words, frames, input.eye))
      return {
        maps: [maps[0]?.final ?? none, maps[1]?.final ?? none],
        sampler: lookup,
        block,
      }
    },
    dispose() {
      release(0)
      release(1)
      block.destroy()
      standIn.destroy()
    },
  }
}

/** The shadow maps' run (`createCloudShadowRun`). */
export type CloudShadowRun = ReturnType<typeof createCloudShadowRun>

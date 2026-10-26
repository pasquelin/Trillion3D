import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import type { TemporalAntialiasingOption } from '../../../../sdk-core/src/contracts/materialOptions.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { WorldParts } from './worldParts.ts'
import { joined } from '../../../../sdk-core/src/runtime/joined.ts'

/** The cut's and the raster's settings, each applied from the next frame over the quality preset. */
function rasterSettings({ switches, live }: WorldParts) {
  return {
    /** The DAG cut's screen error, in pixels; the page's value holds over a quality preset. */
    get pixelError() {
      return switches.pixelError
    },
    set pixelError(value: number) {
      live()
      switches.pixelError = value
    },
    /** The software raster (`WorldOptions.softwareRaster`): on, a cluster whose longest edge
     *  projects under `hardwareRasterEdgePixels` and whose box crosses neither clip plane is
     *  rastered in compute; `false` hands every cluster to the hardware rasterizer. Written, it
     *  applies from the next frame over the quality preset; `undefined` gives it back to it. */
    get softwareRaster(): boolean {
      return switches.softwareRaster
    },
    set softwareRaster(option: boolean | null | undefined) {
      live()
      switches.softwareRaster = option
    },
    /** The projected edge in pixels from which a cluster goes to the hardware rasterizer
     *  (`WorldOptions.hardwareRasterEdgePixels`): a finite number above zero, applied from the
     *  next frame over the quality preset; `undefined` gives it back to it. */
    get hardwareRasterEdgePixels(): number {
      return switches.hardwareRasterEdgePixels
    },
    set hardwareRasterEdgePixels(option: number | null | undefined) {
      live()
      switches.hardwareRasterEdgePixels = option
    },
  }
}

/** The software raster's depth buckets, applied from the next frame over the quality preset. */
function bucketSettings({ switches, live }: WorldParts) {
  return {
    /** Whether the software raster's cutout clusters are ordered nearest first by depth bucket
     *  (`WorldOptions.depthBucketing`): on by default, and, as in the reference, ordering only
     *  where the scene holds voxels; applied from the next frame over the quality preset;
     *  `undefined` gives it back to it. */
    get depthBucketing(): boolean {
      return switches.depthBucketing
    },
    set depthBucketing(option: boolean | null | undefined) {
      live()
      switches.depthBucketing = option
    },
    /** The depth in metres the buckets start at (`WorldOptions.depthBucketsMinZ`): a finite number
     *  above zero, applied from the next frame over the quality preset; `undefined` gives it back
     *  to it. */
    get depthBucketsMinZ(): number {
      return switches.depthBucketsMinZ
    },
    set depthBucketsMinZ(option: number | null | undefined) {
      live()
      switches.depthBucketsMinZ = option
    },
    /** The depth in metres the buckets end at (`WorldOptions.depthBucketsMaxZ`): a finite number
     *  above zero, applied from the next frame over the quality preset; `undefined` gives it back
     *  to it. */
    get depthBucketsMaxZ(): number {
      return switches.depthBucketsMaxZ
    },
    set depthBucketsMaxZ(option: number | null | undefined) {
      live()
      switches.depthBucketsMaxZ = option
    },
  }
}

/** The world's drawing settings: screen error, quality, bounce, antialiasing, scale, effects. */
export function worldSettings(parts: WorldParts) {
  const { switches, modules } = parts
  return joined(rasterSettings(parts), bucketSettings(parts), {
    /** The quality: a preset, each group's level over it, and the resolution the image is drawn at. */
    quality: switches.quality,
    /** Light bounced off the surfaces, traced against the resident proxy; on by default. Applied
     *  in place on a path that carries it, taken by the next opening on one that does not. */
    get bounce() {
      return switches.bounce
    },
    set bounce(on: boolean) {
      switches.bounce = on
    },
    /** Temporal antialiasing: sub-pixel jitter accumulated over frames, at a quality level —
     *  `'off'`, `'low'`, `'medium'`, `'high'`, `'max'` (the default) —, `true` the default level
     *  and `false` off. Written, it takes effect at the next frame, no session reopened, over the
     *  quality preset and the scene's level; `undefined` gives it back to them. Read, the level
     *  resolved; whether the image carries it — not while its program compiles, nor on a device
     *  that refuses it — is the `'temporal antialiasing'` capability. */
    get temporalAntialiasing(): TemporalAntialiasingLevel {
      return switches.temporalAntialiasing
    },
    set temporalAntialiasing(option: TemporalAntialiasingOption | null | undefined) {
      switches.temporalAntialiasing = option
    },
    /** The fraction of the display per axis the image is drawn at (`WorldOptions.renderScale`),
     *  from the next frame. Read, the scale of the last image drawn. */
    get renderScale(): number {
      return switches.renderScale
    },
    set renderScale(scale: RenderScale) {
      switches.renderScale = scale
    },
    /** The most frames a second the world draws, even while its scene moves
     *  (`WorldOptions.maxFrameRate`), from the next frame; Infinity, the display's rate. */
    get maxFrameRate(): number {
      return switches.maxFrameRate
    },
    set maxFrameRate(rate: number) {
      switches.maxFrameRate = rate
    },
    /** The engine's modules, whole features that are off until a source switches them on: `sky`
     *  (the air, the sun, the sky light, the height fog and the clouds, each a part) and `stats`
     *  (the profiler overlay). The page's word holds over the scene's (`scene.sky`):
     *  `set(name, value)` takes `true`, `false` or an object of parts, each `true`, `false` or its
     *  settings, and applies at once; `clear(name)` takes the word back; `state(name)` says whether
     *  the module runs, who decided, and its merged parts. A refused value changes nothing. */
    modules: modules.page,
    /** The effect chain: passes drawn over the image (`effect`). */ effects: switches.held.effects,
  })
}

import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import type { TemporalAntialiasingOption } from '../../../../sdk-core/src/contracts/materialOptions.ts'
import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { WorldParts } from './worldParts.ts'

/** The world's drawing settings: screen error, quality, bounce, antialiasing, scale, effects. */
export function worldSettings({ switches, live }: WorldParts) {
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
    /** How the view streams a partitioned scene's cells (`worldStreaming…`) and the warm-up an
     *  HLOD switch waits on (`hlodWarmup…`), each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings
     *  named apply from the next frame over the preset — one `null` gives it back to it, one left
     *  out stays —; one a setting does not take is refused. */
    get worldStreaming() {
      return switches.worldStreaming
    },
    set worldStreaming(options: WorldStreamingOptions & HlodWarmupOptions) {
      live()
      switches.worldStreaming = options
    },
    /** The cut's occlusion in two passes, its culls and how an upscaled image's level of detail
     *  follows the display, each setting by its field (`WorldOptions`), resolved over the page and
     *  the quality preset. Written, the settings named apply from the next frame over the preset —
     *  one `null` gives it back to it, one left out stays —; one a setting does not take is
     *  refused. */
    get cut() {
      return switches.cut
    },
    set cut(options: CutOptions) {
      live()
      switches.cut = options
    },
    /** The screen size under which an instanced skinned object is drawn in its rest pose and how
     *  the scene's animation banks play their tracks, each setting by its field (`WorldOptions`),
     *  resolved over the page and the quality preset. Written, the settings named apply from the
     *  next frame over the preset — one `null` gives it back to it, one left out stays —; one a
     *  setting does not take is refused. */
    get animation() {
      return switches.animation
    },
    set animation(options: AnimationOptions) {
      live()
      switches.animation = options
    },
    /** How the shading bins hold each material class's pixels, each setting by its field
     *  (`WorldOptions`), resolved over the page and the quality preset. Written, the settings named
     *  apply from the next frame over the preset — one `null` gives it back to it, one left out
     *  stays —; one a setting does not take is refused. */
    get shading() {
      return switches.shading
    },
    set shading(options: ShadingOptions) {
      live()
      switches.shading = options
    },
    /** The quality: a preset, each group's level over it, and the resolution the image is drawn at. */
    quality: switches.quality,
    /** Light bounced off the surfaces, traced against the resident proxy; off by default. Applied
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
    /** The effect chain: passes drawn over the image (`effect`). */ effects: switches.held.effects,
  }
}

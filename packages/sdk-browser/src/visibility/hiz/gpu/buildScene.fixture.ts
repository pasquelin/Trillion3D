import { pyramidBytes } from './oracle.ts'
import { HIZ_CULL_FARTHEST, hizRoute } from './pyramidTexture.ts'

// The scene a pyramid build is transcribed over (`buildTranscripts.fixture.ts`): a depth texture, its
// layout in the packed pyramid, and the texel a pyramid reads of it.
export type Scene = {
  texture: Float32Array
  width: number
  height: number
  maxLevels: number
  /** The full build (`HIZ_WITH_TRACE`): the trace layers beside the culling layer. */
  trace?: boolean
  /** The depth the trace layers reduce — the texture with a transparent surface folded in; the
   *  texture itself where absent. */
  folded?: Float32Array
  /** The full build keeps the planes (`HIZ_UNI.at.planes`), and writes the finished depth's
   *  farthest layer beside the nearest: the default; else it writes the nearest layer alone. */
  planes?: boolean
}

export function layout(scene: Scene) {
  const packed = pyramidBytes(scene.width, scene.height)
  const { sizes, offsets, texels: words, first, upper } = packed
  /** The levels' indices in the culling layer's routing, as the passes name them. */
  const routed = offsets.map((offset, level) => hizRoute(offset, level, HIZ_CULL_FARTHEST, packed))
  return { sizes, offsets, routed, first, upper, words }
}

/** The pixel's opaque depth: what the culling layer reduces. */
export const texel = (scene: Scene, x: number, y: number) => scene.texture[y * scene.width + x]

/** The pixel's depth for the trace layers (`hizFrontAt`). */
export const traceTexel = (scene: Scene, x: number, y: number) =>
  (scene.folded ?? scene.texture)[y * scene.width + x]
